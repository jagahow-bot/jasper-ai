"""Opportunistic demo-client performance refresh (website-open, not cron)."""

from __future__ import annotations

import pandas as pd

from app.engine import client_performance_refresh as cpr
from app.engine import data as data_mod
from app.engine.goal_backcast import _load_close_panel


def test_collect_demo_client_universe_skips_cash():
    tickers, earliest, n_clients = cpr.collect_demo_client_universe()
    assert n_clients >= 1
    assert "CASH" not in tickers
    assert "SPY" in tickers
    assert earliest is not None
    assert earliest <= "2021-12-01"


def test_refresh_skips_yahoo_when_todays_panel_is_fresh(tmp_path, monkeypatch):
    cache_dir = tmp_path / "prices"
    cache_dir.mkdir()
    monkeypatch.setattr(data_mod, "PRICE_CACHE_DIR", cache_dir)

    tickers, _, _ = cpr.collect_demo_client_universe()
    idx = pd.bdate_range("2024-01-02", "2026-08-14")
    panel = pd.DataFrame({t: 100.0 + i * 0.01 for i, t in enumerate(tickers)}, index=idx)
    path = cache_dir / data_mod.CLIENT_PERF_LATEST_FILENAME
    panel.to_parquet(path)

    def _boom(*_a, **_k):
        raise AssertionError("yfinance should not run when today's cache is fresh")

    monkeypatch.setattr(cpr, "_download_yfinance_closes", _boom)
    monkeypatch.setattr(cpr, "_load_bundled_prices_panel", lambda: None)

    result = cpr.refresh_all_client_performance(end="2026-08-14")
    assert result["skipped"] is True
    assert result["data_source"] == "cache"
    assert result["as_of"] == "2026-08-14"
    assert result["tickers"] == len(tickers)


def test_refresh_writes_latest_panel(tmp_path, monkeypatch):
    cache_dir = tmp_path / "prices"
    cache_dir.mkdir()
    monkeypatch.setattr(data_mod, "PRICE_CACHE_DIR", cache_dir)

    idx = pd.bdate_range("2024-01-02", "2026-08-14")
    yf = pd.DataFrame({"SPY": 400.0, "QQQ": 350.0}, index=idx)

    monkeypatch.setattr(cpr, "collect_demo_client_universe", lambda: (["SPY", "QQQ"], "2024-01-02", 2))
    monkeypatch.setattr(cpr, "_download_yfinance_closes", lambda *_a, **_k: yf)
    monkeypatch.setattr(cpr, "_load_bundled_prices_panel", lambda: None)

    result = cpr.refresh_all_client_performance(end="2026-08-14")
    assert result["skipped"] is False
    assert result["as_of"] == "2026-08-14"
    assert result["data_source"] == "yfinance"
    saved = pd.read_parquet(cache_dir / data_mod.CLIENT_PERF_LATEST_FILENAME)
    assert list(saved.columns) == ["SPY", "QQQ"]
    assert str(pd.Timestamp(saved.index.max()).date()) == "2026-08-14"


def test_load_close_panel_reuses_latest_without_yahoo(tmp_path, monkeypatch):
    cache_dir = tmp_path / "prices"
    cache_dir.mkdir()
    monkeypatch.setattr(data_mod, "PRICE_CACHE_DIR", cache_dir)

    idx = pd.bdate_range("2024-01-02", "2026-08-14")
    panel = pd.DataFrame({"SPY": 400.0, "QQQ": 350.0, "AGG": 98.0}, index=idx)
    panel.to_parquet(cache_dir / data_mod.CLIENT_PERF_LATEST_FILENAME)

    def _boom(*_a, **_k):
        raise AssertionError("subset daily-nav should slice the warm latest panel")

    monkeypatch.setattr("app.engine.goal_backcast._download_yfinance_closes", _boom)
    monkeypatch.setattr("app.engine.goal_backcast._load_bundled_prices_panel", lambda: None)
    monkeypatch.setattr("app.engine.goal_backcast._load_cached_prices", lambda _p: None)

    closes, source = _load_close_panel(["SPY", "AGG"], "2024-03-01", "2026-08-14")
    assert source == "client_perf_latest"
    assert list(closes.columns) == ["SPY", "AGG"]
    assert str(closes.index.max().date()) == "2026-08-14"
    assert str(closes.index.min().date()) >= "2024-03-01"


def test_refresh_performance_router(monkeypatch):
    from fastapi.testclient import TestClient

    from main import app

    payload = {
        "as_of": "2026-08-14",
        "tickers": 3,
        "clients": 6,
        "skipped": True,
        "data_source": "cache",
        "window": {"start": "2021-11-15", "end": "2026-08-14"},
    }
    monkeypatch.setattr(
        "app.routers.clients.refresh_all_client_performance",
        lambda: payload,
    )
    client = TestClient(app)
    res = client.post("/clients/refresh-performance")
    assert res.status_code == 200
    body = res.json()
    assert body["as_of"] == "2026-08-14"
    assert body["skipped"] is True
    assert body["tickers"] == 3

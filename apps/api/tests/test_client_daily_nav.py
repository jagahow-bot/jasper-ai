"""Unit tests for the client-book daily NAV builder (no network)."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.engine import client_daily_nav as cdn


def _closes(
    tickers: dict[str, tuple[str, float]],
    start="2024-01-01",
    end="2024-12-31",
) -> pd.DataFrame:
    """Deterministic close panel: ticker → (first_valid_date, daily_return)."""
    idx = pd.bdate_range(start, end)
    data = {}
    for t, (first, r) in tickers.items():
        s = pd.Series(np.nan, index=idx)
        mask = idx >= pd.Timestamp(first)
        n = int(mask.sum())
        s.loc[mask] = 100.0 * np.cumprod(np.full(n, 1.0 + r))
        data[t] = s
    return pd.DataFrame(data)


META = {
    "AAA": {"category": "us_broad", "asset_class": "equity"},
    "BBB": {"category": "us_broad", "asset_class": "equity"},
    "GGG": {"category": "gold", "asset_class": "commodity"},
}


def _patch(monkeypatch, closes: pd.DataFrame) -> None:
    monkeypatch.setattr(cdn, "_load_close_panel", lambda t, s, e: (closes, "test"))
    monkeypatch.setattr(cdn, "_universe_meta_by_ticker", lambda: META)


def _nav_map(build) -> dict[str, float]:
    return {p["date"]: p["nav"] for p in build.daily}


def test_daily_nav_rebases_and_tracks_real_closes(monkeypatch):
    closes = _closes({"AAA": ("2024-01-01", 0.001)})
    _patch(monkeypatch, closes)

    build = cdn.build_client_daily_nav(
        [{"ticker": "AAA", "weight": 1.0, "invested_at": "2024-01-01"}],
        end="2024-12-31",
    )
    daily = build.daily
    assert daily[0]["date"] == "2024-01-01"
    assert daily[0]["nav"] == 1.0  # rebased at the first day

    prices = closes["AAA"].dropna()
    nav = _nav_map(build)
    for d, p in prices.items():
        expect = p / prices.iloc[0]
        assert nav[str(d.date())] == pytest.approx(expect, abs=1e-5)

    # Trading-day grid: no weekend points.
    assert len(daily) == len(prices)
    assert build.meta["window"]["days"] == len(daily)
    assert build.meta["data_source"] == "test"


def test_daily_nav_staggered_invested_at_is_capital_adjusted(monkeypatch):
    closes = _closes({"AAA": ("2024-01-01", 0.001), "BBB": ("2024-01-01", 0.0)})
    _patch(monkeypatch, closes)

    build = cdn.build_client_daily_nav(
        [
            {"ticker": "AAA", "weight": 0.1, "invested_at": "2024-01-01"},
            {"ticker": "BBB", "weight": 0.9, "invested_at": "2024-07-01"},
        ],
        end="2024-12-31",
    )
    nav = _nav_map(build)
    g_aaa = closes["AAA"] / closes["AAA"].iloc[0]

    for d in closes.index:
        ds = str(d.date())
        deployed_b = ds >= "2024-07-01"
        v = 0.1 * g_aaa.loc[d] + (0.9 * 1.0 if deployed_b else 0.0)
        c = 0.1 + (0.9 if deployed_b else 0.0)
        assert nav[ds] == pytest.approx(v / c, abs=1e-5)

    # Deployment at cost dilutes (AAA gained), never spikes up.
    dates = list(nav)
    i_add = dates.index("2024-07-01")
    assert nav["2024-07-01"] < nav[dates[i_add - 1]]

    # End matches the book value/capital formula: (0.1·g + 0.9·1) / 1.0.
    g_end = g_aaa.iloc[-1]
    assert build.daily[-1]["nav"] == pytest.approx(0.1 * g_end + 0.9, abs=1e-5)


def test_daily_nav_cash_is_flat_and_dilutes(monkeypatch):
    closes = _closes({"AAA": ("2024-01-01", 0.002)})
    _patch(monkeypatch, closes)

    build = cdn.build_client_daily_nav(
        [
            {"ticker": "AAA", "weight": 0.6, "invested_at": "2024-01-01"},
            {"ticker": "CASH", "weight": 0.4},
        ],
        end="2024-12-31",
    )
    nav = _nav_map(build)
    g_aaa = closes["AAA"] / closes["AAA"].iloc[0]
    for d in closes.index:
        ds = str(d.date())
        assert nav[ds] == pytest.approx(0.6 * g_aaa.loc[d] + 0.4, abs=1e-5)
    assert build.meta["cash_weight"] == pytest.approx(0.4)


def test_daily_nav_all_cash_is_flat_without_price_data(monkeypatch):
    def _boom(t, s, e):  # price plumbing must not run for cash-only books
        raise AssertionError("unexpected price fetch")

    monkeypatch.setattr(cdn, "_load_close_panel", _boom)
    build = cdn.build_client_daily_nav(
        [{"ticker": "CASH", "weight": 1.0, "invested_at": "2024-03-01"}],
        end="2024-04-30",
    )
    assert build.daily
    assert all(p["nav"] == 1.0 for p in build.daily)
    assert build.daily[0]["date"] == "2024-03-01"
    assert build.daily[-1]["date"] == "2024-04-30"
    assert build.meta["data_source"] == "cash_only"


def test_daily_nav_peer_fill_for_late_listing(monkeypatch):
    closes = _closes(
        {"AAA": ("2024-01-01", 0.001), "BBB": ("2024-07-01", 0.0005)}
    )
    _patch(monkeypatch, closes)

    build = cdn.build_client_daily_nav(
        [
            {"ticker": "AAA", "weight": 0.5, "invested_at": "2024-01-01"},
            {"ticker": "BBB", "weight": 0.5, "invested_at": "2024-01-01"},
        ],
        end="2024-12-31",
    )
    fills = build.meta["proxy_fills"]
    assert fills["BBB"]["proxies"] == ["AAA"]
    assert fills["BBB"]["days_filled"] > 0
    assert fills["BBB"]["zero_filled_days"] == 0

    nav = _nav_map(build)
    g_aaa = closes["AAA"] / closes["AAA"].iloc[0]
    # Before BBB lists, its gap compounds AAA's returns → book tracks AAA.
    pre = [d for d in closes.index if str(d.date()) < "2024-07-01"]
    for d in pre:
        ds = str(d.date())
        assert nav[ds] == pytest.approx(g_aaa.loc[d], abs=1e-5)
    # After listing, BBB compounds its own closes from the peer-filled level.
    g_bbb_at_list = g_aaa.loc[pd.Timestamp("2024-07-01")]
    own = closes["BBB"].loc[pd.Timestamp("2024-07-02")] / closes["BBB"].loc[
        pd.Timestamp("2024-07-01")
    ]
    expect = 0.5 * g_aaa.loc[pd.Timestamp("2024-07-02")] + 0.5 * g_bbb_at_list * own
    assert nav["2024-07-02"] == pytest.approx(expect, abs=1e-5)


def test_daily_nav_gap_zero_filled_when_no_peer(monkeypatch):
    closes = _closes(
        {"AAA": ("2024-01-01", 0.001), "GGG": ("2024-07-01", 0.0005)}
    )
    _patch(monkeypatch, closes)

    build = cdn.build_client_daily_nav(
        [
            {"ticker": "AAA", "weight": 0.5, "invested_at": "2024-01-01"},
            {"ticker": "GGG", "weight": 0.5, "invested_at": "2024-01-01"},
        ],
        end="2024-12-31",
    )
    fills = build.meta["proxy_fills"]
    # No gold/commodity peer exists → documented flat 0.0 fill.
    assert fills["GGG"]["proxies"] == []
    assert fills["GGG"]["zero_filled_days"] > 0

    nav = _nav_map(build)
    g_aaa = closes["AAA"] / closes["AAA"].iloc[0]
    pre = [d for d in closes.index if str(d.date()) < "2024-07-01"]
    for d in pre:
        ds = str(d.date())
        assert nav[ds] == pytest.approx(0.5 * g_aaa.loc[d] + 0.5, abs=1e-5)


def test_daily_nav_drops_unpriceable_holding(monkeypatch):
    closes = _closes({"AAA": ("2024-01-01", 0.001)})
    _patch(monkeypatch, closes)

    build = cdn.build_client_daily_nav(
        [
            {"ticker": "AAA", "weight": 0.5, "invested_at": "2024-01-01"},
            {"ticker": "ZZZ", "weight": 0.5, "invested_at": "2024-01-01"},
        ],
        end="2024-12-31",
    )
    assert build.meta["dropped_tickers"] == ["ZZZ"]
    g_aaa = closes["AAA"] / closes["AAA"].iloc[0]
    assert build.daily[-1]["nav"] == pytest.approx(g_aaa.iloc[-1], abs=1e-5)


def test_daily_nav_without_invested_at_anchors_at_window_start(monkeypatch):
    closes = _closes({"AAA": ("2024-01-01", 0.001)})
    _patch(monkeypatch, closes)

    build = cdn.build_client_daily_nav(
        [{"ticker": "AAA", "weight": 1.0}],
        start="2024-03-01",
        end="2024-12-31",
    )
    assert build.daily[0]["date"] == "2024-03-01"
    assert build.daily[0]["nav"] == 1.0
    p0 = closes["AAA"].loc[pd.Timestamp("2024-03-01")]
    p1 = closes["AAA"].iloc[-1]
    assert build.daily[-1]["nav"] == pytest.approx(p1 / p0, abs=1e-5)


def test_daily_nav_rejects_bad_input(monkeypatch):
    with pytest.raises(ValueError):
        cdn.build_client_daily_nav([], end="2024-12-31")
    with pytest.raises(ValueError):
        cdn.build_client_daily_nav(
            [{"ticker": "AAA", "weight": -1.0}], end="2024-12-31"
        )
    with pytest.raises(ValueError):
        cdn.build_client_daily_nav(
            [{"ticker": "AAA", "weight": 1.0, "invested_at": "not-a-date"}],
            end="2024-12-31",
        )
    with pytest.raises(ValueError):
        cdn.build_client_daily_nav(
            [{"ticker": "AAA", "weight": 1.0, "invested_at": "2024-01-01"}],
            start="2024-12-31",
            end="2024-01-01",
        )


def test_daily_nav_per_ticker_close_to_close_cumulative(monkeypatch):
    closes = _closes({"AAA": ("2024-01-01", 0.001)})
    _patch(monkeypatch, closes)

    build = cdn.build_client_daily_nav(
        [{"ticker": "AAA", "weight": 1.0, "invested_at": "2024-01-01"}],
        end="2024-12-31",
    )
    per = build.meta["per_ticker"]
    assert len(per) == 1
    row = per[0]
    assert row["ticker"] == "AAA"
    assert row["invested_at"] == "2024-01-01"
    assert row["first_date"] == "2024-01-01"
    assert row["last_date"] == str(closes.index[-1].date())
    prices = closes["AAA"].dropna()
    assert row["cumulative_return"] == pytest.approx(
        prices.iloc[-1] / prices.iloc[0] - 1, abs=1e-7
    )
    # Single-holding book: chart MAX return equals the table cumulative.
    assert build.daily[-1]["nav"] - 1 == pytest.approx(
        row["cumulative_return"], abs=1e-5
    )


def test_daily_nav_per_ticker_staggered_anchor(monkeypatch):
    closes = _closes({"AAA": ("2024-01-01", 0.001), "BBB": ("2024-01-01", 0.0005)})
    _patch(monkeypatch, closes)

    build = cdn.build_client_daily_nav(
        [
            {"ticker": "AAA", "weight": 0.5, "invested_at": "2024-01-01"},
            {"ticker": "BBB", "weight": 0.5, "invested_at": "2024-07-01"},
        ],
        end="2024-12-31",
    )
    per = {r["ticker"]: r for r in build.meta["per_ticker"]}
    bbb = per["BBB"]
    assert bbb["first_date"] == "2024-07-01"  # anchored at its own invest date
    p = closes["BBB"].dropna()
    assert bbb["cumulative_return"] == pytest.approx(
        p.loc[pd.Timestamp("2024-12-31")] / p.loc[pd.Timestamp("2024-07-01")] - 1,
        abs=1e-7,
    )


def test_daily_nav_per_ticker_includes_peer_filled_gap(monkeypatch):
    closes = _closes({"AAA": ("2024-01-01", 0.001), "BBB": ("2024-07-01", 0.0005)})
    _patch(monkeypatch, closes)

    build = cdn.build_client_daily_nav(
        [
            {"ticker": "AAA", "weight": 0.5, "invested_at": "2024-01-01"},
            {"ticker": "BBB", "weight": 0.5, "invested_at": "2024-01-01"},
        ],
        end="2024-12-31",
    )
    per = {r["ticker"]: r for r in build.meta["per_ticker"]}
    bbb = per["BBB"]
    assert bbb["first_date"] == "2024-01-01"  # peer-covered from invest date
    g_aaa = closes["AAA"] / closes["AAA"].iloc[0]
    own = (
        closes["BBB"].loc[pd.Timestamp("2024-12-31")]
        / closes["BBB"].loc[pd.Timestamp("2024-07-01")]
    )
    expect = g_aaa.loc[pd.Timestamp("2024-07-01")] * own - 1
    assert bbb["cumulative_return"] == pytest.approx(expect, abs=1e-7)


def test_daily_nav_per_ticker_omits_cash_and_dropped(monkeypatch):
    closes = _closes({"AAA": ("2024-01-01", 0.001)})
    _patch(monkeypatch, closes)

    build = cdn.build_client_daily_nav(
        [
            {"ticker": "AAA", "weight": 0.4, "invested_at": "2024-01-01"},
            {"ticker": "ZZZ", "weight": 0.3, "invested_at": "2024-01-01"},
            {"ticker": "CASH", "weight": 0.3},
        ],
        end="2024-12-31",
    )
    tickers = [r["ticker"] for r in build.meta["per_ticker"]]
    assert tickers == ["AAA"]  # cash + dropped tickers are omitted
    assert build.meta["dropped_tickers"] == ["ZZZ"]


def test_daily_nav_all_cash_has_empty_per_ticker(monkeypatch):
    monkeypatch.setattr(cdn, "_universe_meta_by_ticker", lambda: META)
    build = cdn.build_client_daily_nav(
        [{"ticker": "CASH", "weight": 1.0, "invested_at": "2024-03-01"}],
        end="2024-04-30",
    )
    assert build.meta["per_ticker"] == []


def test_daily_nav_router(monkeypatch):
    from fastapi.testclient import TestClient

    from main import app

    closes = _closes({"AAA": ("2024-01-01", 0.001), "BBB": ("2024-07-01", 0.0)})
    _patch(monkeypatch, closes)

    client = TestClient(app)
    res = client.post(
        "/backcast/daily-nav",
        json={
            "holdings": [
                {"ticker": "AAA", "weight": 0.6, "invested_at": "2024-01-01"},
                {"ticker": "BBB", "weight": 0.3, "invested_at": "2024-01-01"},
                {"ticker": "CASH", "weight": 0.1},
            ],
            "end": "2024-12-31",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["daily"][0] == {"date": "2024-01-01", "nav": 1.0}
    assert data["meta"]["proxy_fills"]["BBB"]["proxies"] == ["AAA"]
    assert data["meta"]["cash_weight"] == pytest.approx(0.1)
    assert data["meta"]["window"]["end"] == "2024-12-31"
    per = {r["ticker"]: r for r in data["meta"]["per_ticker"]}
    assert set(per) == {"AAA", "BBB"}  # cash omitted
    assert per["BBB"]["first_date"] == "2024-01-01"  # peer-covered gap


def test_daily_nav_router_all_cash_flat():
    from fastapi.testclient import TestClient

    from main import app

    client = TestClient(app)
    res = client.post(
        "/backcast/daily-nav",
        json={
            "holdings": [{"ticker": "CASH", "weight": 1.0}],
            "start": "2024-03-01",
            "end": "2024-03-31",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert all(p["nav"] == 1.0 for p in data["daily"])
    assert data["meta"]["data_source"] == "cash_only"


def test_daily_nav_router_rejects_bad_requests():
    from fastapi.testclient import TestClient

    from main import app

    client = TestClient(app)
    assert client.post("/backcast/daily-nav", json={"holdings": []}).status_code == 422
    res = client.post(
        "/backcast/daily-nav",
        json={"holdings": [{"ticker": "AAA", "weight": 0.0}]},
    )
    assert res.status_code == 422
    res = client.post(
        "/backcast/daily-nav",
        json={
            "holdings": [
                {"ticker": "AAA", "weight": 1.0, "invested_at": "not-a-date"}
            ]
        },
    )
    assert res.status_code == 422

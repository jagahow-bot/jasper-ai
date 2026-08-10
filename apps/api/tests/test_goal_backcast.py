"""Unit tests for the goal-planning backcast builder (no network)."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.engine import goal_backcast as gb


def _closes(tickers: dict[str, tuple[str, str]], start="2018-01-01", end="2020-12-31"):
    """Synthetic daily close panel: ticker → (first_valid_date, _)."""
    idx = pd.bdate_range(start, end)
    data = {}
    for t, (first, _) in tickers.items():
        s = pd.Series(np.nan, index=idx)
        mask = idx >= pd.Timestamp(first)
        n = int(mask.sum())
        # Deterministic gentle uptrend: +0.1% per trading day.
        s.loc[mask] = 100.0 * np.cumprod(np.full(n, 1.001))
        data[t] = s
    return pd.DataFrame(data)


META = {
    "AAA": {"category": "us_broad", "asset_class": "equity"},
    "BBB": {"category": "us_broad", "asset_class": "equity"},
    "GGG": {"category": "gold", "asset_class": "commodity"},
}


def test_monthly_returns_from_closes_resamples_to_month_end():
    closes = _closes({"AAA": ("2018-01-01", "")})
    rets = gb.monthly_returns_from_closes(closes)
    assert isinstance(rets.index, pd.PeriodIndex)
    assert str(rets.index[0]) == "2018-02"  # first pct_change month is dropped
    assert rets["AAA"].notna().all()
    # ~0.1% per bday, ~21 bdays/month → ≈2.1% monthly.
    assert rets["AAA"].mean() == pytest.approx(0.021, abs=0.004)


def test_peer_fill_prefers_same_category_peer():
    closes = _closes(
        {
            "AAA": ("2018-01-01", ""),
            "BBB": ("2019-06-01", ""),  # late listing, same category as AAA
            "GGG": ("2018-01-01", ""),
        }
    )
    rets = gb.monthly_returns_from_closes(closes)
    assert rets["BBB"].isna().sum() > 0
    filled, fills = gb.peer_fill_missing_months(rets, meta_by_ticker=META)
    assert filled["BBB"].notna().all()
    fill = fills["BBB"]
    assert fill.proxies == ["AAA"]  # not GGG (different category)
    first_filled = min(fill.proxy_by_month)
    last_filled = max(fill.proxy_by_month)
    bbb_first_valid = str(rets["BBB"].dropna().index[0])
    assert first_filled == str(rets.index[0])
    assert last_filled < bbb_first_valid
    # Filled values equal the peer's monthly returns.
    for m in fill.proxy_by_month:
        assert filled.loc[pd.Period(m, freq="M"), "BBB"] == pytest.approx(
            rets.loc[pd.Period(m, freq="M"), "AAA"]
        )


def test_peer_fill_falls_back_to_asset_class_then_zero():
    closes = _closes(
        {
            "AAA": ("2018-01-01", ""),
            "GGG": ("2019-06-01", ""),  # late; no same-category peer exists
        }
    )
    rets = gb.monthly_returns_from_closes(closes)
    filled, fills = gb.peer_fill_missing_months(rets, meta_by_ticker=META)
    fill = fills["GGG"]
    # No "gold" peer → asset-class "commodity" has no peer either → ZERO_FILL.
    assert set(fill.proxy_by_month.values()) == {"ZERO_FILL"}
    assert (filled["GGG"].loc[[pd.Period(m, freq="M") for m in fill.proxy_by_month]] == 0).all()


def test_rebalance_stride_uses_project_convention():
    assert gb.rebalance_stride_months("monthly") == 1
    assert gb.rebalance_stride_months("QE") == 3
    assert gb.rebalance_stride_months("quarterly") == 3
    assert gb.rebalance_stride_months("Y") == 12
    assert gb.rebalance_stride_months("W") == 1  # weekly collapses to monthly


def _monthly_rets(cols: list[str], n: int, val: float = 0.01) -> pd.DataFrame:
    idx = pd.period_range("2020-01", periods=n, freq="M")
    return pd.DataFrame({c: val for c in cols}, index=idx)


def test_simulate_monthly_rebalance_resets_to_target():
    # AAA +2%/mo, BBB 0%/mo; monthly rebalance keeps 50/50 → +1% each month.
    rets = _monthly_rets(["AAA", "BBB"], 6)
    rets["AAA"] = 0.02
    rets["BBB"] = 0.0
    out = gb.simulate_monthly_backcast(
        rets, {"AAA": 0.5, "BBB": 0.5}, rebalance_stride=1, fee_rate=0.0
    )
    assert [p["return"] for p in out] == pytest.approx([0.01] * 6)

    # Without rebalancing (annual), AAA drift raises the weight → returns grow.
    out_yearly = gb.simulate_monthly_backcast(
        rets, {"AAA": 0.5, "BBB": 0.5}, rebalance_stride=12, fee_rate=0.0
    )
    rets_y = [p["return"] for p in out_yearly]
    assert rets_y[1] > rets_y[0]
    # Fee-free + no year boundary inside 6 months → nothing rebalanced.
    assert not any(p["rebalanced"] for p in out_yearly)


def test_simulate_monthly_backcast_charges_fee_on_turnover():
    rets = _monthly_rets(["AAA", "BBB"], 4)
    rets["AAA"] = 0.10
    rets["BBB"] = 0.0
    out = gb.simulate_monthly_backcast(
        rets, {"AAA": 0.5, "BBB": 0.5}, rebalance_stride=1, fee_rate=0.01
    )
    fee_months = [p for p in out if p["rebalanced"]]
    assert len(fee_months) == 3  # all but the final month
    assert all(p["fee"] > 0 for p in fee_months)
    # Fee reduces that month's net return below the gross 5%.
    assert all(p["return"] < 0.05 for p in fee_months)


def test_simulate_monthly_backcast_cash_dilutes_at_zero():
    rets = _monthly_rets(["AAA"], 3, val=0.02)
    out = gb.simulate_monthly_backcast(
        rets, {"AAA": 0.6, "CASH": 0.4}, rebalance_stride=1, fee_rate=0.0
    )
    assert [p["return"] for p in out] == pytest.approx([0.012] * 3)


def test_build_backcast_monthly_returns_end_to_end(monkeypatch):
    closes = _closes(
        {
            "AAA": ("2018-01-01", ""),
            "BBB": ("2019-06-01", ""),
        },
        start="2017-11-01",
        end="2020-12-31",
    )
    monkeypatch.setattr(gb, "_load_close_panel", lambda t, s, e: (closes, "test"))
    monkeypatch.setattr(gb, "_universe_meta_by_ticker", lambda: META)

    build = gb.build_backcast_monthly_returns(
        {"AAA": 0.5, "BBB": 0.4, "CASH": 0.1},
        years=3,
        rebalance_rule="QE",
        fee_bps=10.0,
        end="2020-12-31",
    )
    assert build.monthly
    months = [p["month"] for p in build.monthly]
    # Tickers start 2018-01, so the first monthly return is 2018-02 even
    # though the 3y window opens at 2017-12.
    assert months[0] == "2018-02"
    assert months[-1] == "2020-12"
    assert build.meta["rebalance_rule"] == "QE"
    assert build.meta["proxy_fills"]["BBB"]["proxies"] == ["AAA"]
    assert build.meta["first_valid_month"]["BBB"] == "2019-06"
    assert build.meta["cash_weight"] == pytest.approx(0.1)
    assert all(abs(p["return"]) < 0.5 for p in build.monthly)


def test_build_backcast_rejects_empty_or_cash_only(monkeypatch):
    with pytest.raises(ValueError):
        gb.build_backcast_monthly_returns({}, end="2020-12-31")
    with pytest.raises(ValueError):
        gb.build_backcast_monthly_returns({"CASH": 1.0}, end="2020-12-31")


def test_backcast_router_monthly(monkeypatch):
    from fastapi.testclient import TestClient

    from main import app

    closes = _closes(
        {"AAA": ("2018-01-01", ""), "BBB": ("2019-06-01", "")},
        start="2017-11-01",
        end="2020-12-31",
    )
    monkeypatch.setattr(gb, "_load_close_panel", lambda t, s, e: (closes, "test"))
    monkeypatch.setattr(gb, "_universe_meta_by_ticker", lambda: META)

    client = TestClient(app)
    res = client.post(
        "/backcast/monthly",
        json={
            "weights": {"AAA": 0.6, "BBB": 0.4},
            "years": 3,
            "rebalance_freq": "monthly",
            "fee_bps": 10,
            "end": "2020-12-31",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["monthly"][0]["month"] == "2018-02"
    assert data["meta"]["rebalance_rule"] == "ME"
    assert data["meta"]["proxy_fills"]["BBB"]["proxies"] == ["AAA"]


def test_backcast_router_rejects_bad_weights():
    from fastapi.testclient import TestClient

    from main import app

    client = TestClient(app)
    res = client.post("/backcast/monthly", json={"weights": {}})
    assert res.status_code == 422
    res = client.post("/backcast/monthly", json={"weights": {"CASH": 1.0}})
    assert res.status_code == 422

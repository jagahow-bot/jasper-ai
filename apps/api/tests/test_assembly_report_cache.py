"""Assembly reuses trial simulation cache instead of redundant backtests."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from app.engine.backtest import _assemble_candidates_from_records
from app.engine.report_sim_cache import ReportSimBundle, TrialReportCache
from app.models import BacktestRequest, Objective


def _minimal_sim(sharpe: float = 1.0, *, with_weights: bool = True) -> dict:
    idx = pd.date_range("2020-01-01", periods=80, freq="B")
    port_ret = pd.Series(0.0005, index=idx)
    equity = (1.0 + port_ret).cumprod()
    out = {
        "sharpe": sharpe,
        "max_drawdown": -0.1,
        "cagr": 0.12,
        "volatility": 0.15,
        "sortino": 1.1,
        "calmar": 1.0,
        "var_95": -0.02,
        "cvar_95": -0.03,
        "win_rate": 0.55,
        "turnover_avg": 0.01,
        "turnover_total": 0.5,
        "max_drawdown_duration_days": 10,
        "equity": equity,
        "port_ret": port_ret,
        "last_weights": [0.2, 0.2, 0.2, 0.2, 0.2],
        "rebalance_count": 4,
        "rebalance_applied": 4,
        "rebalance_freq": "M",
        "rebalance_dates": [],
        "factor_summary": {},
    }
    if with_weights:
        out["weight_history"] = [{"date": "2020-01-01", "A": 0.5, "B": 0.5, "OTHER": 0.0}]
        out["weight_history_tickers"] = ["A", "B"]
    return out


def _price_panel() -> tuple[list[str], pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    tickers = ["A", "B", "C", "D", "E"]
    idx = pd.date_range("2020-01-01", periods=120, freq="B")
    prices = pd.DataFrame({t: 100.0 + i for i, t in enumerate(tickers)}, index=idx)
    split = 80
    return tickers, prices, prices.iloc[:split], prices.iloc[split:]


def _req() -> BacktestRequest:
    return BacktestRequest(
        scenario_id="test-assembly-cache",
        start_date="2020-01-01",
        end_date="2020-06-30",
        asset_classes=["equity"],
        objective=Objective.max_sharpe,
        max_weight=0.25,
        max_turnover=0.5,
        top_n=10,
        trials=5,
        top_models=1,
    )


def test_assembly_distinct_metrics_per_model_code_from_cache():
    tickers, prices, prices_train, prices_val = _price_panel()
    cache = TrialReportCache()

    def _record(code: str, sharpe: float, w_mom: float) -> tuple[float, dict, dict]:
        params = {
            "model_code": code,
            "mode": "min_var",
            "lookback_days": 60,
            "shrinkage": 0.1,
            "risk_aversion": 2.0,
            "max_weight_actual": 0.25,
            "top_n_actual": 3,
            "rebalance_freq": "M",
            "w_mom": w_mom,
        }
        train_m = _minimal_sim(sharpe, with_weights=False)
        full_m = _minimal_sim(sharpe, with_weights=True)
        cache.stash_from_trial(
            params, train_m=train_m, val_m=None, full_m=full_m, retain_weight_history=True
        )
        return (sharpe, params, {})

    records = [_record("M0001", 1.1, 0.4), _record("M0002", 0.7, 1.6)]
    sim_mock = MagicMock(side_effect=AssertionError("simulate should not run"))
    with patch("app.engine.backtest.simulate_dynamic_portfolio", sim_mock):
        out = _assemble_candidates_from_records(
            records,
            req=_req(),
            top_n_models=2,
            tickers=tickers,
            prices=prices,
            prices_sim_panel=prices,
            prices_train=prices_train,
            prices_val=prices_val,
            oos=True,
            rebalance_rule="M",
            spec=MagicMock(
                benchmark_ticker="SPY",
                risk_free_rate=0.0,
                fee_bps=0.0,
                rebalance_rule="M",
                min_holdings=2,
                max_holdings=30,
            ),
            universe_by_ticker={},
            objective_effective="max_sharpe",
            train_start="2020-01-01",
            train_end="2020-04-01",
            val_start="2020-04-02",
            train_ratio=0.7,
            trial_report_cache=cache,
        )
    sim_mock.assert_not_called()
    assert len(out) == 2
    assert out[0].model_code == "M0001"
    assert out[1].model_code == "M0002"
    assert out[0].sharpe != out[1].sharpe


def test_assembly_skips_train_val_when_cache_complete():
    tickers, prices, prices_train, prices_val = _price_panel()
    train_m = _minimal_sim(1.2, with_weights=False)
    val_m = _minimal_sim(0.9, with_weights=False)
    full_m = _minimal_sim(1.0, with_weights=True)
    params = {
        "model_code": "M0001",
        "mode": "min_var",
        "lookback_days": 60,
        "shrinkage": 0.1,
        "risk_aversion": 2.0,
        "max_weight_actual": 0.25,
        "top_n_actual": 3,
        "rebalance_freq": "M",
    }
    records = [(1.0, params, {})]
    cache = TrialReportCache()
    cache.stash_from_trial(
        params,
        train_m=train_m,
        val_m=val_m,
        full_m=full_m,
        retain_weight_history=True,
    )

    sim_mock = MagicMock(side_effect=AssertionError("simulate should not run"))

    with patch("app.engine.backtest.simulate_dynamic_portfolio", sim_mock):
        out = _assemble_candidates_from_records(
            records,
            req=_req(),
            top_n_models=1,
            tickers=tickers,
            prices=prices,
            prices_sim_panel=prices,
            prices_train=prices_train,
            prices_val=prices_val,
            oos=True,
            rebalance_rule="M",
            spec=MagicMock(
                benchmark_ticker="SPY",
                risk_free_rate=0.0,
                fee_bps=0.0,
                rebalance_rule="M",
                min_holdings=2,
                max_holdings=30,
            ),
            universe_by_ticker={},
            objective_effective="max_sharpe",
            train_start="2020-01-01",
            train_end="2020-04-01",
            val_start="2020-04-02",
            train_ratio=0.7,
            trial_report_cache=cache,
        )
    sim_mock.assert_not_called()
    assert len(out) == 1
    assert out[0].model_code == "M0001"


def test_assembly_cache_hit_runs_only_full_for_weights():
    tickers, prices, prices_train, prices_val = _price_panel()
    train_m = _minimal_sim(1.2, with_weights=False)
    val_m = _minimal_sim(0.9, with_weights=False)
    full_m = _minimal_sim(1.0, with_weights=False)
    params = {
        "model_code": "M0002",
        "mode": "min_var",
        "lookback_days": 60,
        "shrinkage": 0.1,
        "risk_aversion": 2.0,
        "max_weight_actual": 0.25,
        "top_n_actual": 3,
        "rebalance_freq": "M",
    }
    records = [(1.0, params, {})]
    cache = TrialReportCache()
    cache.stash_from_trial(params, train_m=train_m, val_m=val_m, full_m=full_m)

    full_with_weights = _minimal_sim(1.0, with_weights=True)
    sim_mock = MagicMock(return_value=full_with_weights)

    with patch("app.engine.backtest.simulate_dynamic_portfolio", sim_mock):
        _assemble_candidates_from_records(
            records,
            req=_req(),
            top_n_models=1,
            tickers=tickers,
            prices=prices,
            prices_sim_panel=prices,
            prices_train=prices_train,
            prices_val=prices_val,
            oos=True,
            rebalance_rule="M",
            spec=MagicMock(
                benchmark_ticker="SPY",
                risk_free_rate=0.0,
                fee_bps=0.0,
                rebalance_rule="M",
                min_holdings=2,
                max_holdings=30,
            ),
            universe_by_ticker={},
            objective_effective="max_sharpe",
            train_start="2020-01-01",
            train_end="2020-04-01",
            val_start="2020-04-02",
            train_ratio=0.7,
            trial_report_cache=cache,
        )
    assert sim_mock.call_count == 1
    sim_mock.assert_called_once()
    assert sim_mock.call_args[0][0] is prices


def test_drop_model_codes_removes_stale_code_alias():
    params = {
        "mode": "min_var",
        "lookback_days": 60,
        "shrinkage": 0.1,
        "risk_aversion": 2.0,
        "max_weight_actual": 0.25,
        "top_n_actual": 3,
        "rebalance_freq": "M",
        "w_mom": 0.5,
        "model_code": "M0006",
    }
    cache = TrialReportCache()
    cache.stash_from_trial(params, train_m=_minimal_sim(0.5), val_m=None, full_m=None)
    assert cache.get_bundle(params) is not None
    cache.drop_model_codes({"M0006"})
    assert cache.get_bundle(params) is None
    assert "code:M0006" not in cache._by_key


def test_early_drop_of_retired_pool_code_forces_assembly_resim():
    """Regression: dropping retired Pro pool codes before packaging → cache miss.

    Round reports assemble after all rounds; early drop made packaging show
    'no search cache — running backtest(s) for charts' for non-winners.
    """
    tickers, prices, prices_train, prices_val = _price_panel()
    params = {
        "model_code": "M0003",
        "mode": "min_var",
        "lookback_days": 60,
        "shrinkage": 0.1,
        "risk_aversion": 2.0,
        "max_weight_actual": 0.25,
        "top_n_actual": 3,
        "rebalance_freq": "M",
        "w_mom": 0.9,
    }
    cache = TrialReportCache()
    full_m = _minimal_sim(1.2, with_weights=True)
    cache.stash_from_trial(
        params,
        train_m=_minimal_sim(1.2, with_weights=False),
        val_m=None,
        full_m=full_m,
        retain_weight_history=True,
    )
    cache.drop_model_codes({"M0003"})
    assert cache.get_bundle(params) is None

    sim_mock = MagicMock(return_value=_minimal_sim(1.2, with_weights=True))
    with patch("app.engine.backtest.simulate_dynamic_portfolio", sim_mock):
        _assemble_candidates_from_records(
            [(1.2, params, {})],
            req=_req(),
            top_n_models=1,
            tickers=tickers,
            prices=prices,
            prices_sim_panel=prices,
            prices_train=prices_train,
            prices_val=prices_val,
            oos=False,
            rebalance_rule="M",
            spec=MagicMock(
                benchmark_ticker="SPY",
                risk_free_rate=0.0,
                fee_bps=0.0,
                rebalance_rule="M",
                min_holdings=2,
                max_holdings=30,
            ),
            universe_by_ticker={},
            objective_effective="max_sharpe",
            train_start="2020-01-01",
            train_end="2020-04-01",
            val_start="2020-04-02",
            train_ratio=0.7,
            trial_report_cache=cache,
        )
    assert sim_mock.call_count >= 1


def test_get_bundle_rejects_stale_code_alias_for_different_signature():
    """code: keys must not serve a different parameter signature."""
    params_old = {
        "mode": "min_var",
        "lookback_days": 60,
        "shrinkage": 0.1,
        "risk_aversion": 2.0,
        "max_weight_actual": 0.25,
        "top_n_actual": 3,
        "rebalance_freq": "M",
        "w_mom": 0.5,
        "model_code": "M0006",
    }
    params_new = dict(params_old)
    params_new["w_mom"] = 1.8
    cache = TrialReportCache()
    cache.stash_from_trial(params_old, train_m=_minimal_sim(0.5), val_m=None, full_m=None)
    cache.drop_model_codes({"M0006"})
    cache.stash_from_trial(params_new, train_m=_minimal_sim(1.9), val_m=None, full_m=None)

    bundle = cache.get_bundle(params_new)
    assert bundle is not None
    assert float(bundle.train_m["sharpe"]) == pytest.approx(1.9)


def test_get_bundle_finds_sig_stash_when_params_have_model_code():
    """Trials stash under sig: before model_code exists; assembly must still hit."""
    params_trial = {
        "mode": "min_var",
        "lookback_days": 60,
        "shrinkage": 0.1,
        "risk_aversion": 2.0,
        "max_weight_actual": 0.25,
        "top_n_actual": 3,
        "rebalance_freq": "M",
    }
    train_m = _minimal_sim(1.0, with_weights=False)
    cache = TrialReportCache()
    cache.stash_from_trial(params_trial, train_m=train_m, val_m=None, full_m=None)

    params_assembly = dict(params_trial)
    params_assembly["model_code"] = "M0007"
    cache.register_model_code(params_assembly)

    bundle = cache.get_bundle(params_assembly)
    assert bundle is not None
    assert bundle.train_m is not None
    assert cache._by_key.get("code:M0007") is bundle


def test_assembly_hits_cache_after_trial_stash_then_model_code_assigned():
    tickers, prices, prices_train, prices_val = _price_panel()
    params_trial = {
        "mode": "min_var",
        "lookback_days": 60,
        "shrinkage": 0.1,
        "risk_aversion": 2.0,
        "max_weight_actual": 0.25,
        "top_n_actual": 3,
        "rebalance_freq": "M",
    }
    train_m = _minimal_sim(1.2, with_weights=False)
    val_m = _minimal_sim(0.9, with_weights=False)
    full_m = _minimal_sim(1.0, with_weights=True)
    cache = TrialReportCache()
    cache.stash_from_trial(
        params_trial, train_m=train_m, val_m=val_m, full_m=full_m, retain_weight_history=True
    )
    params = dict(params_trial)
    params["model_code"] = "M0007"
    cache.register_model_code(params)
    records = [(1.0, params, {})]

    sim_mock = MagicMock(side_effect=AssertionError("simulate should not run"))
    with patch("app.engine.backtest.simulate_dynamic_portfolio", sim_mock):
        _assemble_candidates_from_records(
            records,
            req=_req(),
            top_n_models=1,
            tickers=tickers,
            prices=prices,
            prices_sim_panel=prices,
            prices_train=prices_train,
            prices_val=prices_val,
            oos=True,
            rebalance_rule="M",
            spec=MagicMock(
                benchmark_ticker="SPY",
                risk_free_rate=0.0,
                fee_bps=0.0,
                rebalance_rule="M",
                min_holdings=2,
                max_holdings=30,
            ),
            universe_by_ticker={},
            objective_effective="max_sharpe",
            train_start="2020-01-01",
            train_end="2020-04-01",
            val_start="2020-04-02",
            train_ratio=0.7,
            trial_report_cache=cache,
        )
    sim_mock.assert_not_called()


def test_assembly_slim_payload_for_non_champion_only():
    tickers, prices, prices_train, prices_val = _price_panel()
    cache = TrialReportCache()

    def _record(code: str, sharpe: float) -> tuple[float, dict, dict]:
        params = {
            "model_code": code,
            "mode": "min_var",
            "lookback_days": 60,
            "shrinkage": 0.1,
            "risk_aversion": 2.0,
            "max_weight_actual": 0.25,
            "top_n_actual": 3,
            "rebalance_freq": "M",
        }
        train_m = _minimal_sim(sharpe, with_weights=False)
        full_m = _minimal_sim(sharpe, with_weights=True)
        cache.stash_from_trial(
            params, train_m=train_m, val_m=None, full_m=full_m, retain_weight_history=True
        )
        return (sharpe, params, {})

    records = [_record("M0001", 1.1), _record("M0002", 0.7)]
    spec = MagicMock(
        benchmark_ticker="SPY",
        risk_free_rate=0.0,
        fee_bps=0.0,
        rebalance_rule="M",
        min_holdings=2,
        max_holdings=30,
    )
    sim_mock = MagicMock(side_effect=AssertionError("simulate should not run"))
    with patch("app.engine.backtest.simulate_dynamic_portfolio", sim_mock):
        out = _assemble_candidates_from_records(
            records,
            req=_req(),
            top_n_models=2,
            tickers=tickers,
            prices=prices,
            prices_sim_panel=prices,
            prices_train=prices_train,
            prices_val=prices_val,
            oos=True,
            rebalance_rule="M",
            spec=spec,
            universe_by_ticker={},
            objective_effective="max_sharpe",
            train_start="2020-01-01",
            train_end="2020-04-01",
            val_start="2020-04-02",
            train_ratio=0.7,
            trial_report_cache=cache,
            full_payload_codes={"M0001"},
        )
    sim_mock.assert_not_called()
    champ = next(c for c in out if c.model_code == "M0001")
    slim = next(c for c in out if c.model_code == "M0002")
    assert champ.equity_curve
    assert champ.analytics and champ.analytics.get("weight_history")
    assert slim.equity_curve is None
    assert slim.analytics
    assert slim.analytics.get("sample_metrics")
    assert slim.analytics.get("exposure")
    assert not slim.analytics.get("weight_history")
    assert not slim.analytics.get("benchmark_equity_curve")


def test_report_sim_bundle_complete_flags():
    b = ReportSimBundle(
        train_m=_minimal_sim(with_weights=False),
        val_m=_minimal_sim(with_weights=False),
        full_m=_minimal_sim(with_weights=True),
    )
    assert b.complete_for_oos(oos=True, val_required=True)
    b2 = ReportSimBundle(
        train_m=_minimal_sim(with_weights=False),
        val_m=_minimal_sim(with_weights=False),
        full_m=_minimal_sim(with_weights=False),
    )
    assert not b2.complete_for_oos(oos=True, val_required=True)

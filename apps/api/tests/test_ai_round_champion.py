"""Post-Optuna AI round champion selection."""

from __future__ import annotations

from app.engine.ai_params import (
    _MAX_ROUND_CHAMPION_ATTEMPTS,
    _round_champion_composite_score,
    _round_champion_fallback_code,
    _round_champion_max_output_tokens,
    _thinking_config_for_round_champion,
    generate_ai_round_champion,
)
from app.engine.refinement import (
    build_round_champion_ai_payload,
    horizon_snapshots_from_full_path,
    record_for_model_code,
    resolve_trial_metrics_for_reporting,
)
from app.engine.report_sim_cache import TrialReportCache
from app.engine.spec import DEFAULT_SPEC


def _sim_metrics(*, sharpe: float, cagr: float = 0.1) -> dict:
    return {
        "sharpe": sharpe,
        "cagr": cagr,
        "max_drawdown": -0.1,
        "volatility": 0.15,
        "sortino": sharpe,
        "turnover_avg": 0.01,
    }


def test_resolve_trial_metrics_prefers_cache_when_record_lacks_snapshots():
    stale = {
        "sharpe": 0.36,
        "cagr": 0.092,
        "max_drawdown": -0.3353,
        "objective_value_is": 0.3645,
        "objective_value_oos": 1.0941,
    }
    cache = TrialReportCache()
    params_a = {"mode": "min_var", "lookback_days": 60, "w_mom": 0.4, "model_code": "M0001"}
    params_b = dict(params_a)
    params_b["w_mom"] = 1.6
    params_b["model_code"] = "M0002"
    cache.stash_from_trial(
        params_a,
        train_m=_sim_metrics(sharpe=0.5, cagr=0.11),
        val_m=_sim_metrics(sharpe=0.8, cagr=0.09),
        full_m=None,
    )
    cache.stash_from_trial(
        params_b,
        train_m=_sim_metrics(sharpe=0.9, cagr=0.14),
        val_m=_sim_metrics(sharpe=0.85, cagr=0.12),
        full_m=None,
    )
    out_a = resolve_trial_metrics_for_reporting(
        params_a,
        stale,
        trial_report_cache=cache,
        objective_effective="max_sharpe",
        oos_enabled=True,
        score=0.3645,
    )
    out_b = resolve_trial_metrics_for_reporting(
        params_b,
        stale,
        trial_report_cache=cache,
        objective_effective="max_sharpe",
        oos_enabled=True,
        score=0.3645,
    )
    assert out_a["objective_value_is"] != out_b["objective_value_is"]
    assert out_a["train_metrics"]["sharpe"] == 0.5
    assert out_b["train_metrics"]["sharpe"] == 0.9


def test_build_round_champion_payload_distinct_when_cache_differs():
    stale_metrics = {
        "sharpe": 0.3645,
        "cagr": 0.092,
        "max_drawdown": -0.3353,
        "objective_value_is": 0.3645,
        "objective_value_oos": 1.0941,
        "gap_objective": -0.7296,
        "train_metrics": {
            "sharpe": 0.3645,
            "cagr": 0.092,
            "max_drawdown": -0.3353,
            "objective_value": 0.3645,
        },
        "validation_metrics": {
            "sharpe": 1.0941,
            "cagr": 0.177,
            "max_drawdown": -0.1087,
            "objective_value": 1.0941,
        },
        "overfitting_assessment": {"risk_level": "low"},
    }
    cache = TrialReportCache()
    pool = []
    for i, (sh, oos_sh) in enumerate([(0.5, 0.8), (0.7, 0.75), (0.9, 0.85)], start=1):
        params = {
            "mode": "min_var",
            "lookback_days": 60,
            "w_mom": float(i),
            "model_code": f"M000{i}",
        }
        cache.stash_from_trial(
            params,
            train_m=_sim_metrics(sharpe=sh),
            val_m=_sim_metrics(sharpe=oos_sh, cagr=0.08 + i * 0.01),
            full_m=None,
        )
        record_metrics = {
            **stale_metrics,
            "train_metrics": {
                "sharpe": sh,
                "cagr": 0.092,
                "max_drawdown": -0.3353,
                "objective_value": sh,
            },
            "validation_metrics": {
                "sharpe": oos_sh,
                "cagr": 0.177,
                "max_drawdown": -0.1087,
                "objective_value": oos_sh,
            },
        }
        pool.append((sh, params, record_metrics))
    payload = build_round_champion_ai_payload(
        pool,
        objective_effective="max_sharpe",
        round_index=1,
        incoming_champion_model_code=None,
        benchmark_ticker="ACWI",
        oos_enabled=True,
        trial_report_cache=cache,
    )
    is_vals = [c["objective_value_is"] for c in payload["candidates"]]
    assert len(set(is_vals)) == 3
    assert payload["candidates"][0]["horizons"]["in_sample"]["sharpe"] == 0.5
    assert payload["candidates"][2]["horizons"]["in_sample"]["sharpe"] == 0.9


def test_resolve_prefers_record_snapshots_over_aliased_cache():
    """Record train_metrics are authoritative even when sig cache aliases trials."""
    cache = TrialReportCache()
    shared = {"mode": "min_var", "lookback_days": 60, "w_mom": 0.4, "optuna_trial_number": 0}
    params_a = {**shared, "model_code": "M0001"}
    params_b = {**shared, "model_code": "M0002"}
    cache.refresh_from_record_metrics(
        params_a,
        {
            "train_metrics": {"sharpe": 0.99, "cagr": 0.1, "max_drawdown": -0.2, "objective_value": 0.99},
            "validation_metrics": {"sharpe": 0.5, "cagr": 0.08, "max_drawdown": -0.1, "objective_value": 0.5},
        },
    )
    cache.refresh_from_record_metrics(
        params_b,
        {
            "train_metrics": {"sharpe": 0.41, "cagr": 0.09, "max_drawdown": -0.2, "objective_value": 0.41},
            "validation_metrics": {"sharpe": 0.95, "cagr": 0.15, "max_drawdown": -0.1, "objective_value": 0.95},
        },
    )
    stale = {
        "sharpe": 0.3645,
        "train_metrics": {"sharpe": 0.3645, "cagr": 0.092, "max_drawdown": -0.3353, "objective_value": 0.3645},
        "validation_metrics": {"sharpe": 1.0941, "cagr": 0.177, "max_drawdown": -0.1087, "objective_value": 1.0941},
    }
    out_a = resolve_trial_metrics_for_reporting(
        params_a,
        {
            **stale,
            "train_metrics": {"sharpe": 0.50, "cagr": 0.11, "max_drawdown": -0.2, "objective_value": 0.50},
            "validation_metrics": {"sharpe": 0.80, "cagr": 0.09, "max_drawdown": -0.1, "objective_value": 0.80},
        },
        trial_report_cache=cache,
        objective_effective="max_sharpe",
        oos_enabled=True,
        score=0.5,
    )
    out_b = resolve_trial_metrics_for_reporting(
        params_b,
        {
            **stale,
            "train_metrics": {"sharpe": 0.63, "cagr": 0.12, "max_drawdown": -0.18, "objective_value": 0.63},
            "validation_metrics": {"sharpe": 1.08, "cagr": 0.16, "max_drawdown": -0.09, "objective_value": 1.08},
        },
        trial_report_cache=cache,
        objective_effective="max_sharpe",
        oos_enabled=True,
        score=0.63,
    )
    assert out_a["train_metrics"]["sharpe"] == 0.50
    assert out_b["train_metrics"]["sharpe"] == 0.63
    assert out_a["objective_value_is"] != out_b["objective_value_is"]


def test_cache_isolates_model_codes_with_shared_signature():
    shared = {"mode": "min_var", "lookback_days": 60, "w_mom": 0.4, "optuna_trial_number": 0}
    cache = TrialReportCache()
    cache.refresh_from_record_metrics(
        {**shared, "model_code": "M0001"},
        {"train_metrics": _sim_metrics(sharpe=0.30), "validation_metrics": _sim_metrics(sharpe=0.80)},
    )
    cache.refresh_from_record_metrics(
        {**shared, "model_code": "M0007"},
        {"train_metrics": _sim_metrics(sharpe=0.55), "validation_metrics": _sim_metrics(sharpe=0.90)},
    )
    b1 = cache.get_bundle({**shared, "model_code": "M0001"})
    b7 = cache.get_bundle({**shared, "model_code": "M0007"})
    assert b1 is not None and b7 is not None
    assert b1 is not b7
    assert b1.train_m["sharpe"] == 0.30
    assert b7.train_m["sharpe"] == 0.55


def test_refresh_from_record_metrics_breaks_shared_signature_cache():
    """Pro round tags model_code after Optuna; sig lookup can alias — refresh per code."""
    stale_metrics = {
        "sharpe": 0.3645,
        "cagr": 0.092,
        "max_drawdown": -0.3353,
        "objective_value_is": 0.3645,
        "objective_value_oos": 1.0941,
        "train_metrics": {
            "sharpe": 0.3645,
            "cagr": 0.092,
            "max_drawdown": -0.3353,
            "objective_value": 0.3645,
        },
        "validation_metrics": {
            "sharpe": 1.0941,
            "cagr": 0.177,
            "max_drawdown": -0.1087,
            "objective_value": 1.0941,
        },
        "overfitting_assessment": {"risk_level": "low"},
    }
    shared_params = {"mode": "min_var", "lookback_days": 60, "w_mom": 0.4}
    cache = TrialReportCache()
    cache.stash_from_trial(
        shared_params,
        train_m=_sim_metrics(sharpe=0.3645),
        val_m=_sim_metrics(sharpe=1.0941),
        full_m=None,
    )
    pool = []
    for i, (is_sh, oos_sh) in enumerate([(0.41, 0.95), (0.52, 1.02), (0.63, 1.08)], start=1):
        params = {
            **shared_params,
            "model_code": f"M000{i}",
            "optuna_trial_number": i - 1,
            "pro_round_index": 1,
        }
        metrics = {
            **stale_metrics,
            "train_metrics": {
                "sharpe": is_sh,
                "cagr": 0.09 + i * 0.01,
                "max_drawdown": -0.2,
                "objective_value": is_sh,
            },
            "validation_metrics": {
                "sharpe": oos_sh,
                "cagr": 0.15,
                "max_drawdown": -0.1,
                "objective_value": oos_sh,
            },
        }
        cache.refresh_from_record_metrics(params, metrics)
        pool.append((is_sh, params, metrics))
    payload = build_round_champion_ai_payload(
        pool,
        objective_effective="max_sharpe",
        round_index=1,
        incoming_champion_model_code=None,
        benchmark_ticker="VT",
        oos_enabled=True,
        trial_report_cache=cache,
    )
    is_vals = [c["objective_value_is"] for c in payload["candidates"]]
    assert len(set(is_vals)) == 3
    assert payload["candidates"][0]["horizons"]["in_sample"]["sharpe"] == 0.41
    assert payload["candidates"][2]["horizons"]["in_sample"]["sharpe"] == 0.63


def test_resolve_trial_metrics_prefers_record_snapshots_over_aliased_cache():
    """Production bug: code-keyed cache aliases; per-record train_metrics are authoritative."""
    cache = TrialReportCache()
    shared = {"mode": "min_var", "lookback_days": 60, "w_mom": 0.4}
    cache.stash_from_trial(
        {**shared, "model_code": "M0001", "optuna_trial_number": 0},
        train_m=_sim_metrics(sharpe=0.3645),
        val_m=_sim_metrics(sharpe=1.0941),
        full_m=None,
    )
    stale_top = {
        "sharpe": 0.3645,
        "cagr": 0.092,
        "max_drawdown": -0.3353,
        "objective_value_is": 0.3645,
    }
    params_a = {**shared, "model_code": "M0001", "optuna_trial_number": 0}
    params_b = {**shared, "model_code": "M0002", "optuna_trial_number": 1}
    metrics_a = {
        **stale_top,
        "train_metrics": {
            "sharpe": 0.41,
            "cagr": 0.10,
            "max_drawdown": -0.2,
            "objective_value": 0.41,
        },
        "validation_metrics": {
            "sharpe": 0.95,
            "cagr": 0.16,
            "max_drawdown": -0.1,
            "objective_value": 0.95,
        },
    }
    metrics_b = {
        **stale_top,
        "train_metrics": {
            "sharpe": 0.63,
            "cagr": 0.12,
            "max_drawdown": -0.18,
            "objective_value": 0.63,
        },
        "validation_metrics": {
            "sharpe": 1.08,
            "cagr": 0.19,
            "max_drawdown": -0.09,
            "objective_value": 1.08,
        },
    }
    out_a = resolve_trial_metrics_for_reporting(
        params_a,
        metrics_a,
        trial_report_cache=cache,
        objective_effective="max_sharpe",
        oos_enabled=True,
    )
    out_b = resolve_trial_metrics_for_reporting(
        params_b,
        metrics_b,
        trial_report_cache=cache,
        objective_effective="max_sharpe",
        oos_enabled=True,
    )
    assert out_a["train_metrics"]["sharpe"] == 0.41
    assert out_b["train_metrics"]["sharpe"] == 0.63
    assert out_a["objective_value_is"] != out_b["objective_value_is"]


def test_build_round_champion_ai_payload_orders_by_model_code():
    pool = [
        (
            0.9,
            {"model_code": "M0002"},
            {
                "sharpe": 1.1,
                "cagr": 0.1,
                "max_drawdown": -0.1,
                "objective_value_is": 0.9,
                "train_metrics": {
                    "sharpe": 1.1,
                    "cagr": 0.1,
                    "max_drawdown": -0.1,
                    "objective_value": 0.9,
                },
            },
        ),
        (
            1.2,
            {"model_code": "M0001"},
            {
                "sharpe": 1.4,
                "cagr": 0.12,
                "max_drawdown": -0.08,
                "objective_value_is": 1.2,
                "train_metrics": {
                    "sharpe": 1.4,
                    "cagr": 0.12,
                    "max_drawdown": -0.08,
                    "objective_value": 1.2,
                },
            },
        ),
    ]
    payload = build_round_champion_ai_payload(
        pool,
        objective_effective="max_sharpe",
        round_index=2,
        incoming_champion_model_code="M0001",
        benchmark_ticker="SPY",
        oos_enabled=False,
    )
    codes = [c["model_code"] for c in payload["candidates"]]
    assert codes == ["M0001", "M0002"]
    assert payload["candidates"][0]["role"] == "incoming_champion"
    assert payload["candidates"][1]["role"] == "challenger"
    assert payload["candidates"][0]["objective_value_is"] == 1.4
    assert payload["candidates"][0]["horizons"]["in_sample"]["sharpe"] == 1.4
    assert payload["candidates"][0]["horizons"]["full_sample"]["objective_value"] == 1.4


def test_build_round_champion_ai_payload_includes_oos_horizons():
    pool = [
        (
            1.0,
            {"model_code": "M0001"},
            {
                "sharpe": 1.5,
                "cagr": 0.15,
                "max_drawdown": -0.1,
                "objective_value_is": 1.5,
                "objective_value_oos": 0.8,
                "gap_objective": 0.7,
                "train_metrics": {
                    "sharpe": 1.5,
                    "cagr": 0.15,
                    "max_drawdown": -0.1,
                    "objective_value": 1.5,
                },
                "validation_metrics": {
                    "sharpe": 0.9,
                    "cagr": 0.08,
                    "max_drawdown": -0.12,
                    "objective_value": 0.8,
                },
                "overfitting_assessment": {
                    "risk_level": "high",
                    "gap_sharpe": 0.6,
                    "gap_objective": 0.7,
                    "out_of_sample_objective": 0.8,
                },
            },
        ),
    ]
    payload = build_round_champion_ai_payload(
        pool,
        objective_effective="max_sharpe",
        round_index=1,
        incoming_champion_model_code=None,
        benchmark_ticker="SPY",
        oos_enabled=True,
    )
    row = payload["candidates"][0]
    assert row["holdout_objective"] == 0.9
    assert row["overfitting_risk"] == "high"
    assert row["horizons"]["out_of_sample"]["objective_value"] == 0.9
    assert row["horizons"]["gap"]["objective"] == 0.6
    assert "full_sample matches" in payload["selection_note"]


def test_record_for_model_code_finds_pool_trial():
    pool = [
        (1.0, {"model_code": "M0003"}, {"sharpe": 1.0}),
        (1.2, {"model_code": "M0001"}, {"sharpe": 1.2}),
    ]
    rec = record_for_model_code(pool, "m0001")
    assert rec is not None
    assert rec[1]["model_code"] == "M0001"


def test_round_champion_composite_prefers_balanced_oos_over_high_is():
    payload = {
        "oos_enabled": True,
        "candidates": [
            {
                "model_code": "M0001",
                "objective_value": 1.5,
                "objective_value_is": 1.5,
                "holdout_objective": 0.4,
                "overfitting_risk": "high",
                "horizons": {
                    "in_sample": {"objective_value": 1.5},
                    "out_of_sample": {"objective_value": 0.4},
                    "full_sample": None,
                    "gap": {"objective": 1.1},
                },
            },
            {
                "model_code": "M0002",
                "objective_value": 0.9,
                "objective_value_is": 0.9,
                "holdout_objective": 0.85,
                "overfitting_risk": "low",
                "horizons": {
                    "in_sample": {"objective_value": 0.9},
                    "out_of_sample": {"objective_value": 0.85},
                    "full_sample": None,
                    "gap": {"objective": 0.05},
                },
            },
        ],
    }
    assert _round_champion_fallback_code(payload) == "M0002"
    assert _round_champion_composite_score(
        payload["candidates"][1], oos_enabled=True
    ) > _round_champion_composite_score(payload["candidates"][0], oos_enabled=True)


def test_round_champion_fallback_uses_composite_without_oos():
    payload = {
        "oos_enabled": False,
        "candidates": [
            {
                "model_code": "M0001",
                "objective_value": 0.5,
                "horizons": {
                    "in_sample": {"objective_value": 0.5},
                    "out_of_sample": None,
                    "full_sample": {"objective_value": 0.5},
                    "gap": None,
                },
            },
            {
                "model_code": "M0002",
                "objective_value": 0.9,
                "horizons": {
                    "in_sample": {"objective_value": 0.9},
                    "out_of_sample": None,
                    "full_sample": {"objective_value": 0.9},
                    "gap": None,
                },
            },
        ],
    }
    assert _round_champion_fallback_code(payload) == "M0002"


def test_round_champion_max_output_tokens_bumps_on_retry():
    assert _round_champion_max_output_tokens(attempt=0) == 1536
    assert _round_champion_max_output_tokens(attempt=1) == 3584


def test_round_champion_thinking_disabled_for_gemini_3():
    assert _thinking_config_for_round_champion(model="gemini-3.5-flash") is None


def test_round_champion_allows_single_retry():
    assert _MAX_ROUND_CHAMPION_ATTEMPTS == 2


def test_generate_ai_round_champion_retries_on_max_tokens(monkeypatch):
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_api_key", "test-key")
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_model", "gemini-3.5-flash")
    calls: list[dict] = []

    def fake_post(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            return "MAX_TOKENS", '{"round_champion_model'
        return "STOP", '{"round_champion_model_code":"M0002","rationale":"Best OOS."}'

    monkeypatch.setattr("app.engine.ai_params._gemini_round_seed_post", fake_post)
    payload = {
        "oos_enabled": True,
        "round": 2,
        "candidates": [
            {
                "model_code": "M0001",
                "objective_value": 0.5,
                "horizons": {
                    "in_sample": {"objective_value": 0.5},
                    "out_of_sample": {"objective_value": 0.3},
                },
            },
            {
                "model_code": "M0002",
                "objective_value": 0.9,
                "horizons": {
                    "in_sample": {"objective_value": 0.9},
                    "out_of_sample": {"objective_value": 0.85},
                },
            },
        ],
    }
    out = generate_ai_round_champion(payload=payload)
    assert len(calls) == 2
    assert all(c["thinking_config"] is None for c in calls)
    assert calls[0]["generation_config"]["maxOutputTokens"] == 1536
    assert calls[1]["generation_config"]["maxOutputTokens"] == 3584
    assert out["enabled"] is True
    assert out["round_champion_model_code"] == "M0002"


def test_generate_ai_round_champion_without_api_key_uses_fallback(monkeypatch):
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_api_key", "")
    payload = {
        "oos_enabled": False,
        "round": 1,
        "candidates": [
            {
                "model_code": "M0001",
                "objective_value": 0.5,
                "horizons": {
                    "in_sample": {"objective_value": 0.5},
                    "full_sample": {"objective_value": 0.5},
                },
            },
            {
                "model_code": "M0002",
                "objective_value": 0.9,
                "horizons": {
                    "in_sample": {"objective_value": 0.9},
                    "full_sample": {"objective_value": 0.9},
                },
            },
        ],
    }
    out = generate_ai_round_champion(payload=payload)
    assert out["enabled"] is False
    assert out["round_champion_model_code"] == "M0002"


def _full_path_sim(*, is_mean: float, oos_mean: float, is_days: int = 252, oos_days: int = 126):
    import numpy as np
    import pandas as pd

    rng = np.random.default_rng(42)
    idx = pd.bdate_range("2016-01-01", periods=is_days + oos_days, freq="B")
    is_r = rng.normal(is_mean, 0.008, is_days)
    oos_r = rng.normal(oos_mean, 0.008, oos_days)
    port_ret = pd.Series(np.concatenate([is_r, oos_r]), index=idx, dtype=float)
    equity = (1.0 + port_ret).cumprod()
    return {"port_ret": port_ret, "equity": equity}


def test_resolve_prefers_full_path_slices_over_inflated_trial_snapshots():
    """Regression: trial IS simulates can inflate vs report full-path IS slices."""
    spec = DEFAULT_SPEC
    is_split = 252
    full_m = _full_path_sim(is_mean=0.0002, oos_mean=0.0012)
    inflated_train = _sim_metrics(sharpe=0.6911, cagr=0.1211)
    inflated_val = _sim_metrics(sharpe=1.6646, cagr=0.2377)
    is_snap, oos_snap, full_snap = horizon_snapshots_from_full_path(
        full_m,
        spec=spec,
        objective_effective="max_return",
        oos_enabled=True,
        is_split_idx=is_split,
        train_m=inflated_train,
        val_m=inflated_val,
    )
    assert is_snap["cagr"] < inflated_train["cagr"] - 0.02

    cache = TrialReportCache()
    params = {"mode": "min_var", "lookback_days": 60, "model_code": "M0088"}
    cache.stash_from_trial(
        params,
        train_m=inflated_train,
        val_m=inflated_val,
        full_m=full_m,
    )
    stale_record = {
        "train_metrics": inflated_train,
        "validation_metrics": inflated_val,
        "objective_value_is": 0.1211,
        "objective_value_oos": 0.2377,
    }
    resolved = resolve_trial_metrics_for_reporting(
        params,
        stale_record,
        trial_report_cache=cache,
        objective_effective="max_return",
        oos_enabled=True,
        spec=spec,
        is_split_idx=is_split,
    )
    assert resolved["train_metrics"]["cagr"] == is_snap["cagr"]
    assert resolved["validation_metrics"]["cagr"] == oos_snap["cagr"]
    assert resolved["full_metrics"]["cagr"] == full_snap["cagr"]


def test_champion_payload_horizons_match_report_grid():
    """Champion AI payload IS/OOS must match horizon_snapshots_from_full_path."""
    spec = DEFAULT_SPEC
    is_split = 252
    full_m = _full_path_sim(is_mean=0.0002, oos_mean=0.0012)
    inflated_train = _sim_metrics(sharpe=0.6911, cagr=0.1211)
    inflated_val = _sim_metrics(sharpe=1.6646, cagr=0.2377)
    is_snap, oos_snap, full_snap = horizon_snapshots_from_full_path(
        full_m,
        spec=spec,
        objective_effective="max_return",
        oos_enabled=True,
        is_split_idx=is_split,
        train_m=inflated_train,
        val_m=inflated_val,
    )
    cache = TrialReportCache()
    params = {"mode": "min_var", "lookback_days": 60, "model_code": "M0088"}
    cache.stash_from_trial(
        params,
        train_m=inflated_train,
        val_m=inflated_val,
        full_m=full_m,
    )
    pool = [
        (
            0.12,
            params,
            {
                "train_metrics": inflated_train,
                "validation_metrics": inflated_val,
                "objective_value_is": 0.1211,
                "objective_value_oos": 0.2377,
            },
        ),
    ]
    payload = build_round_champion_ai_payload(
        pool,
        objective_effective="max_return",
        round_index=3,
        incoming_champion_model_code=None,
        benchmark_ticker="ACWI",
        oos_enabled=True,
        trial_report_cache=cache,
        spec=spec,
        is_split_idx=is_split,
    )
    row = payload["candidates"][0]
    assert row["horizons"]["in_sample"]["cagr"] == is_snap["cagr"]
    assert row["horizons"]["out_of_sample"]["cagr"] == oos_snap["cagr"]
    assert row["horizons"]["full_sample"]["cagr"] == full_snap["cagr"]
    assert row["horizons"]["in_sample"]["cagr"] != inflated_train["cagr"]


def test_generate_ai_round_champion_honors_preselected_code(monkeypatch):
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_api_key", "test-key")
    monkeypatch.setattr("app.engine.ai_params.settings.gemini_model", "gemini-3.5-flash")

    def fake_post(**_kwargs):
        return "STOP", '{"round_champion_model_code":"M0001","rationale":"Wrong pick."}'

    monkeypatch.setattr("app.engine.ai_params._gemini_round_seed_post", fake_post)
    payload = {
        "oos_enabled": True,
        "round": 1,
        "candidates": [
            {
                "model_code": "M0001",
                "objective_value": 1.5,
                "horizons": {
                    "in_sample": {"objective_value": 1.5},
                    "out_of_sample": {"objective_value": 0.4},
                    "full_sample": {"objective_value": 0.3},
                },
            },
            {
                "model_code": "M0002",
                "objective_value": 0.9,
                "horizons": {
                    "in_sample": {"objective_value": 0.9},
                    "out_of_sample": {"objective_value": 0.85},
                    "full_sample": {"objective_value": 0.8},
                },
            },
        ],
    }
    out = generate_ai_round_champion(
        payload=payload,
        selected_model_code="M0002",
    )
    assert out["round_champion_model_code"] == "M0002"

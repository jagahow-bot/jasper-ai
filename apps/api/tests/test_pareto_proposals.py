"""Pareto proposal selection for RM comparison cards."""

from __future__ import annotations

from app.engine.objectives import (
    dedupe_proposal_candidates,
    pick_pareto_proposals,
    portfolios_near_identical,
    weights_signature,
)


EQUAL_WEIGHTS = {
    "AGG": 0.125,
    "DODIX": 0.125,
    "GLD": 0.125,
    "IVV": 0.125,
    "PG": 0.125,
    "SHY": 0.125,
    "TLT": 0.125,
    "VWELX": 0.125,
}

NEEDS = {
    "within_drawdown_tolerance": False,
    "within_single_name_cap": False,
    "within_theme_cap": True,
    "all_floors_met": False,
}


def test_pick_pareto_keeps_champion_and_diverse_labels():
    candidates = [
        {
            "model_code": "A",
            "sharpe": 1.2,
            "cagr": 0.12,
            "max_drawdown": -0.18,
            "is_champion": True,
            "objective_score": 1.2,
            "weights": {"AAPL": 0.6, "TLT": 0.4},
            "needs_attainment": {"within_drawdown_tolerance": True},
        },
        {
            "model_code": "B",
            "sharpe": 0.8,
            "cagr": 0.06,
            "max_drawdown": -0.05,
            "is_champion": False,
            "objective_score": 0.8,
            "weights": {"AAPL": 0.2, "TLT": 0.8},
            "needs_attainment": {"within_drawdown_tolerance": True},
        },
        {
            "model_code": "C",
            "sharpe": 1.5,
            "cagr": 0.20,
            "max_drawdown": -0.30,
            "is_champion": False,
            "objective_score": 1.5,
            "weights": {"AAPL": 0.9, "TLT": 0.1},
            "needs_attainment": {"within_drawdown_tolerance": False},
        },
        {
            "model_code": "D",
            "sharpe": 0.7,
            "cagr": 0.05,
            "max_drawdown": -0.06,
            "is_champion": False,
            "objective_score": 0.7,
            "weights": {"AAPL": 0.25, "TLT": 0.75},
            "needs_attainment": {"within_drawdown_tolerance": True},
        },
    ]
    cards = pick_pareto_proposals(candidates, max_n=3, champion_code="A")
    assert 1 <= len(cards) <= 3
    codes = {c["model_code"] for c in cards}
    assert "A" in codes
    labels = [c["label"] for c in cards]
    assert any(c.get("is_recommended") for c in cards)
    assert "recommended" in labels or cards[0]["is_recommended"]


def test_pick_pareto_empty():
    assert pick_pareto_proposals([]) == []


def test_weights_signature_rounds_and_sorts():
    assert weights_signature({"b": 0.50001, "a": 0.49999}) == "A:0.5000|B:0.5000"
    assert weights_signature({}) is None
    assert weights_signature(None) is None


def test_portfolios_near_identical_by_weights_or_metrics():
    a = {
        "sharpe": 0.422,
        "cagr": 0.07,
        "max_drawdown": -0.181,
        "needs_score": 0.333,
        "_weights_sig": weights_signature(EQUAL_WEIGHTS),
    }
    b = {
        "sharpe": 0.422,
        "cagr": 0.07,
        "max_drawdown": -0.181,
        "needs_score": 0.333,
        "_weights_sig": weights_signature(EQUAL_WEIGHTS),
    }
    c = {
        "sharpe": 0.9,
        "cagr": 0.12,
        "max_drawdown": -0.10,
        "needs_score": 1.0,
        "_weights_sig": "AAPL:1.0000",
    }
    assert portfolios_near_identical(a, b)
    assert not portfolios_near_identical(a, c)
    # Metrics-only match when weights missing on one side.
    a_no_w = {**a, "_weights_sig": None}
    b_no_w = {**b, "_weights_sig": None}
    assert portfolios_near_identical(a_no_w, b_no_w)


def test_dedupe_keeps_champion_drops_metric_clones():
    """Job a3556951-style: M0004/5/6 same weights+metrics, different params."""
    rows = [
        {
            "model_code": "M0004",
            "sharpe": 0.422,
            "cagr": 0.07,
            "max_drawdown": -0.181,
            "needs_score": 0.333,
            "is_champion": True,
            "_weights_sig": weights_signature(EQUAL_WEIGHTS),
        },
        {
            "model_code": "M0005",
            "sharpe": 0.422,
            "cagr": 0.07,
            "max_drawdown": -0.181,
            "needs_score": 0.333,
            "is_champion": False,
            "_weights_sig": weights_signature(EQUAL_WEIGHTS),
        },
        {
            "model_code": "M0006",
            "sharpe": 0.422,
            "cagr": 0.07,
            "max_drawdown": -0.181,
            "needs_score": 0.333,
            "is_champion": False,
            "_weights_sig": weights_signature(EQUAL_WEIGHTS),
        },
    ]
    kept = dedupe_proposal_candidates(rows)
    assert [r["model_code"] for r in kept] == ["M0004"]


def test_pick_pareto_collapses_identical_alternatives():
    candidates = [
        {
            "model_code": "M0004",
            "sharpe": 0.422,
            "cagr": 0.07,
            "max_drawdown": -0.181,
            "is_champion": True,
            "objective_score": 0.202246,
            "weights": EQUAL_WEIGHTS,
            "needs_attainment": NEEDS,
            "params": {"optuna_trial_number": 3, "w_mom": 1.8},
        },
        {
            "model_code": "M0005",
            "sharpe": 0.422,
            "cagr": 0.07,
            "max_drawdown": -0.181,
            "is_champion": False,
            "objective_score": 0.202246,
            "weights": dict(EQUAL_WEIGHTS),
            "needs_attainment": NEEDS,
            "params": {"optuna_trial_number": 4, "w_mom": 1.6},
        },
        {
            "model_code": "M0006",
            "sharpe": 0.422,
            "cagr": 0.07,
            "max_drawdown": -0.181,
            "is_champion": False,
            "objective_score": 0.202246,
            "weights": dict(EQUAL_WEIGHTS),
            "needs_attainment": NEEDS,
            "params": {"optuna_trial_number": 0, "w_mom": 1.8},
        },
    ]
    cards = pick_pareto_proposals(candidates, max_n=3, champion_code="M0004")
    assert len(cards) == 1
    assert cards[0]["model_code"] == "M0004"
    assert cards[0]["is_recommended"] is True
    assert cards[0]["label"] == "recommended"


def test_pick_pareto_keeps_true_tradeoffs():
    candidates = [
        {
            "model_code": "REC",
            "sharpe": 1.0,
            "cagr": 0.10,
            "max_drawdown": -0.15,
            "is_champion": True,
            "objective_score": 1.0,
            "weights": {"IVV": 0.7, "TLT": 0.3},
            "needs_attainment": {"within_drawdown_tolerance": True},
        },
        {
            "model_code": "DEF",
            "sharpe": 0.6,
            "cagr": 0.04,
            "max_drawdown": -0.04,
            "is_champion": False,
            "objective_score": 0.6,
            "weights": {"IVV": 0.2, "TLT": 0.8},
            "needs_attainment": {"within_drawdown_tolerance": True},
        },
        {
            "model_code": "GRO",
            "sharpe": 1.4,
            "cagr": 0.18,
            "max_drawdown": -0.28,
            "is_champion": False,
            "objective_score": 1.4,
            "weights": {"IVV": 0.95, "TLT": 0.05},
            "needs_attainment": {"within_drawdown_tolerance": False},
        },
    ]
    cards = pick_pareto_proposals(candidates, max_n=3, champion_code="REC")
    assert len(cards) == 3
    assert {c["model_code"] for c in cards} == {"REC", "DEF", "GRO"}

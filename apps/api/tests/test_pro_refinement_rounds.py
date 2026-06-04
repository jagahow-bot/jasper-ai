"""Pro refinement: single carry-over champion + per-round challengers only."""



from __future__ import annotations



from app.engine.backtest import (
    _resync_round_convergence_from_records,
    _sort_round_records_for_convergence,
)
from app.engine.refinement import (
    assign_pro_round_model_codes,
    assign_search_model_codes,
    best_record_in_pool,
    build_round_competition_pool,
    model_signature,
    params_for_champion_seed,
    pool_records_in_trial_order,
    pro_round_display_allowlist,
    pro_round_report_top_n,
    records_for_pool_model_codes,
    reconcile_pro_round_pool,
    record_objective_sort_value,
    register_prior_challenger_signatures,
    retire_non_winner_model_codes,
)





def _rec(portfolio_id: int, objective_is: float) -> tuple[float, dict, dict]:

    params = {"mode": "risk_parity", "portfolio_id": portfolio_id}

    metrics = {"objective_value_is": objective_is, "sharpe": objective_is}

    return (objective_is, params, metrics)





def test_round_pool_is_incoming_plus_new_only():

    incoming = _rec(2, 0.80)

    new_trials = [_rec(6, 0.70), _rec(7, 0.75), _rec(8, 0.72), _rec(9, 0.71)]

    pool = build_round_competition_pool(new_trials, incoming)

    assert len(pool) == 5

    assert model_signature(pool[0][1]) == model_signature(incoming[1])



    pool2 = build_round_competition_pool(new_trials, incoming)

    assert len(pool2) == len(pool)





def test_round_pool_dedupes_when_champion_ran_as_optuna_trial():

    incoming = _rec(2, 0.80)

    new_trials = [_rec(2, 0.82), _rec(6, 0.70)]

    pool = build_round_competition_pool(new_trials, incoming)

    sigs = {model_signature(r[1]) for r in pool}

    assert len(pool) == 2

    assert len(sigs) == 2





def test_prior_round_loser_excluded_from_later_pool():

    """Round 2: m0001 winner + m0006 loser; Round 3 pool must not contain m0006."""

    objective = "max_sharpe"

    m0001 = _rec(1, 0.90)

    m0006 = _rec(6, 0.70)

    m0007 = _rec(7, 0.75)

    m0008 = _rec(8, 0.72)

    m0009 = _rec(9, 0.71)



    prior_sigs: set[str] = set()

    pool_r2 = build_round_competition_pool(

        [m0006, m0007, m0008, m0009],

        m0001,

        prior_challenger_signatures=prior_sigs,

    )

    winner_r2 = best_record_in_pool(pool_r2, objective)

    assert winner_r2 is not None

    assert winner_r2[1]["portfolio_id"] == 1



    register_prior_challenger_signatures(

        [m0006, m0007, m0008, m0009],

        incoming_champion=m0001,

        round_winner=winner_r2,

        prior=prior_sigs,

    )

    assert model_signature(m0006[1]) in prior_sigs

    assert model_signature(m0001[1]) not in prior_sigs



    m0010 = _rec(10, 0.68)

    m0011 = _rec(11, 0.69)

    m0012 = _rec(12, 0.67)

    m0013 = _rec(13, 0.66)

    round3_trials_with_recycled_loser = [m0006, m0010, m0011, m0012, m0013]



    pool_r3 = build_round_competition_pool(

        round3_trials_with_recycled_loser,

        m0001,

        prior_challenger_signatures=prior_sigs,

    )

    pool_ids = {r[1]["portfolio_id"] for r in pool_r3}

    assert 6 not in pool_ids

    assert 1 in pool_ids

    assert {10, 11, 12, 13}.issubset(pool_ids)

    assert len(pool_r3) == 5





def test_champion_progression_user_example():

    """Rounds A–D: carry one champion; winner each round is best in pool only."""

    objective = "max_sharpe"

    min_gain = 0.01

    champion: tuple[float, dict, dict] | None = None

    champion_score = float("-inf")

    prior_sigs: set[str] = set()



    rounds = [

        [_rec(1, 0.50), _rec(2, 0.90), _rec(3, 0.60), _rec(4, 0.55), _rec(5, 0.52)],

        [_rec(6, 0.70), _rec(7, 0.75), _rec(8, 0.72), _rec(9, 0.71)],

        [_rec(10, 0.95), _rec(11, 0.80), _rec(12, 0.78), _rec(13, 0.77)],

        [_rec(14, 0.99), _rec(15, 0.85), _rec(16, 0.84), _rec(17, 0.83)],

    ]

    expected_winner_ids = [2, 2, 10, 14]



    for round_idx, new_trials in enumerate(rounds):

        incoming = champion

        incoming_score = champion_score if incoming is not None else None

        pool = build_round_competition_pool(

            new_trials,

            incoming,

            prior_challenger_signatures=prior_sigs,

        )

        winner = best_record_in_pool(pool, objective)

        assert winner is not None

        winner_id = winner[1]["portfolio_id"]

        assert winner_id == expected_winner_ids[round_idx]



        winner_obj = record_objective_sort_value(objective, winner[0], winner[2])

        baseline = float(incoming_score) if incoming_score is not None else float("-inf")

        improved = winner_obj > baseline + min_gain

        register_prior_challenger_signatures(

            new_trials,

            incoming_champion=incoming,

            round_winner=winner,

            prior=prior_sigs,

        )

        champion = winner

        champion_score = winner_obj



        if round_idx == 1:

            assert winner_id == 2

            assert improved is False

        if round_idx == 3:

            assert winner_id == 14



    assert champion is not None

    assert champion[1]["portfolio_id"] == 14


def test_deposed_champion_excluded_when_new_champion_wins():
    """R1 m0001 wins; R2 m0006 replaces m0001; R3 pool must not contain m0001."""
    objective = "max_sharpe"
    prior_sigs: set[str] = set()

    m0001 = _rec(1, 0.90)
    r1_trials = [_rec(1, 0.90), _rec(2, 0.50), _rec(3, 0.60), _rec(4, 0.55), _rec(5, 0.52)]
    pool_r1 = build_round_competition_pool(r1_trials, None)
    winner_r1 = best_record_in_pool(pool_r1, objective)
    assert winner_r1 is not None
    assert winner_r1[1]["portfolio_id"] == 1
    register_prior_challenger_signatures(
        r1_trials, incoming_champion=None, round_winner=winner_r1, prior=prior_sigs
    )

    m0006 = _rec(6, 0.95)
    r2_trials = [_rec(6, 0.95), _rec(7, 0.75), _rec(8, 0.72), _rec(9, 0.71)]
    pool_r2 = build_round_competition_pool(
        r2_trials, m0001, prior_challenger_signatures=prior_sigs
    )
    pool_r2_ids = {r[1]["portfolio_id"] for r in pool_r2}
    assert pool_r2_ids == {1, 6, 7, 8, 9}
    winner_r2 = best_record_in_pool(pool_r2, objective)
    assert winner_r2 is not None
    assert winner_r2[1]["portfolio_id"] == 6
    register_prior_challenger_signatures(
        r2_trials, incoming_champion=m0001, round_winner=winner_r2, prior=prior_sigs
    )
    assert model_signature(m0001[1]) in prior_sigs
    assert model_signature(m0006[1]) not in prior_sigs

    r3_trials = [
        m0001,
        m0006,
        _rec(10, 0.68),
        _rec(11, 0.69),
        _rec(12, 0.67),
    ]
    pool_r3 = build_round_competition_pool(
        r3_trials, m0006, prior_challenger_signatures=prior_sigs
    )
    pool_r3_ids = {r[1]["portfolio_id"] for r in pool_r3}
    assert 1 not in pool_r3_ids
    assert 6 in pool_r3_ids
    assert {10, 11, 12}.issubset(pool_r3_ids)
    assert len(pool_r3_ids) == 4


def test_signature_ignores_bounds_violations_and_model_code():
  """Prior-round exclusion must match across trials with different run metadata."""
  base = {"mode": "risk_parity", "portfolio_id": 1, "lookback_days": 252}
  sig_a = model_signature({**base, "bounds_violations": [{"field": "w_mom"}]})
  sig_b = model_signature({**base, "bounds_violations": []})
  sig_c = model_signature({**base, "model_code": "M0001", "pro_round_index": 3})
  assert sig_a == sig_b == sig_c

  seed = params_for_champion_seed(
      {**base, "bounds_violations": [{"field": "w_mom"}], "model_code": "M0001"}
  )
  assert "bounds_violations" not in seed
  assert "model_code" not in seed


def test_assign_search_model_codes_once_and_immutable():
    """Standard Optuna path assigns sequential codes; existing codes are preserved."""
    trials = [_rec(1, 0.9), _rec(2, 0.8), _rec(3, 0.7)]
    trials[1][1]["model_code"] = "M0042"
    assign_search_model_codes(trials, next_model_no=[1])
    assert trials[0][1]["model_code"] == "M0001"
    assert trials[1][1]["model_code"] == "M0042"
    assert trials[2][1]["model_code"] == "M0002"
    assign_search_model_codes(trials, next_model_no=[99])
    assert trials[0][1]["model_code"] == "M0001"
    assert trials[2][1]["model_code"] == "M0002"


def test_round2_loser_m0007_not_in_round3_allowlist():
    """Round 2: M0007 loses; round 3 display allowlist must not include M0007."""
    objective = "max_sharpe"
    next_no = [1]
    retired: set[str] = set()
    carry_code: str | None = None

    r1_trials = [_rec(i, 0.5 + i * 0.01) for i in range(1, 6)]
    assign_pro_round_model_codes(
        r1_trials, incoming_champion_record=None, incoming_champion_model_code=None, next_model_no=next_no
    )
    pool_r1 = build_round_competition_pool(r1_trials, None)
    winner_r1 = best_record_in_pool(pool_r1, objective)
    assert winner_r1 is not None
    winner_r1_code = str(winner_r1[1]["model_code"])
    retire_non_winner_model_codes(pool_r1, winner_r1, retired)
    carry_code = winner_r1_code

    m0007_r2 = _rec(7, 0.75)
    r2_trials = [m0007_r2, _rec(8, 0.92), _rec(9, 0.71), _rec(10, 0.70)]
    assign_pro_round_model_codes(
        r2_trials,
        incoming_champion_record=winner_r1,
        incoming_champion_model_code=carry_code,
        next_model_no=next_no,
    )
    pool_r2 = build_round_competition_pool(r2_trials, winner_r1)
    winner_r2 = best_record_in_pool(pool_r2, objective)
    assert winner_r2 is not None
    assert winner_r2[1]["portfolio_id"] == 8
    round2_loser_code = str(m0007_r2[1]["model_code"])
    round2_allow = pro_round_display_allowlist(
        incoming_champion_model_code=carry_code,
        round_winner_model_code=str(winner_r2[1]["model_code"]),
        round_challenger_model_codes=[
            str(r[1]["model_code"])
            for r in pool_r2
            if r[1].get("model_code")
            and str(r[1]["model_code"]) not in {carry_code, str(winner_r2[1]["model_code"])}
        ],
    )
    assert round2_loser_code in round2_allow
    retire_non_winner_model_codes(pool_r2, winner_r2, retired)
    assert round2_loser_code in retired
    carry_code = str(winner_r2[1]["model_code"])

    r3_trials = [m0007_r2, _rec(11, 0.68), _rec(12, 0.67)]
    assign_pro_round_model_codes(
        r3_trials,
        incoming_champion_record=winner_r2,
        incoming_champion_model_code=carry_code,
        next_model_no=next_no,
    )
    recycled = [r for r in r3_trials if r[1]["portfolio_id"] == 7][0]
    assert str(recycled[1]["model_code"]) != round2_loser_code
    pool_r3 = build_round_competition_pool(
        r3_trials, winner_r2, prior_challenger_signatures={model_signature(m0007_r2[1])}
    )
    round3_allow = pro_round_display_allowlist(
        incoming_champion_model_code=carry_code,
        round_winner_model_code=str(best_record_in_pool(pool_r3, objective)[1]["model_code"]),
        round_challenger_model_codes=[
            str(r[1]["model_code"])
            for r in pool_r3
            if str(r[1].get("model_code", "")) not in {carry_code}
        ],
    )
    assert round2_loser_code not in round3_allow


def test_reconcile_pro_round_pool_derives_codes_from_records_only():
    """Ghost codes from excluded trials must not appear in pool_model_codes."""
    incoming = _rec(1, 0.99)
    incoming[1]["model_code"] = "M0001"
    excluded = _rec(6, 0.70)
    excluded[1]["model_code"] = "M0010"
    fresh = _rec(10, 0.68)
    fresh[1]["model_code"] = "M0011"
    fresh2 = _rec(11, 0.67)
    fresh2[1]["model_code"] = "M0012"
    pool_in = [incoming, fresh, fresh2]
    filtered, pool_codes, challengers = reconcile_pro_round_pool(
        pool_in,
        incoming_champion_model_code="M0001",
        retired_model_codes=set(),
    )
    assert "M0010" not in pool_codes
    assert pool_codes == ["M0001", "M0011", "M0012"]
    assert challengers == ["M0011", "M0012"]
    assert {str(r[1]["model_code"]) for r in filtered} == set(pool_codes)


def test_build_pool_filters_retired_model_codes():
    """Retired labels must never enter the competition pool (defense in depth)."""
    incoming = _rec(1, 0.99)
    incoming[1]["model_code"] = "M0001"
    stale = _rec(6, 0.70)
    stale[1]["model_code"] = "M0006"
    fresh = _rec(10, 0.68)
    fresh[1]["model_code"] = "M0010"
    pool = build_round_competition_pool(
        [incoming, stale, fresh],
        incoming,
        retired_model_codes={"M0006"},
    )
    codes = {str(r[1]["model_code"]) for r in pool}
    assert codes == {"M0001", "M0010"}


def test_reconcile_pro_round_pool_strips_retired_codes():
    """Stale pool rows with retired labels must not appear in pool or challengers."""
    incoming = _rec(6, 0.90)
    incoming[1]["model_code"] = "M0006"
    stale = _rec(1, 0.50)
    stale[1]["model_code"] = "M0001"
    fresh = _rec(16, 0.88)
    fresh[1]["model_code"] = "M0016"
    fresh2 = _rec(17, 0.87)
    fresh2[1]["model_code"] = "M0017"
    pool_in = [incoming, stale, fresh, fresh2]
    filtered, pool_codes, challengers = reconcile_pro_round_pool(
        pool_in,
        incoming_champion_model_code="M0006",
        retired_model_codes={"M0001", "M0008"},
    )
    codes = {str(r[1]["model_code"]) for r in filtered}
    assert codes == {"M0006", "M0016", "M0017"}
    assert pool_codes == ["M0006", "M0016", "M0017"]
    assert challengers == ["M0016", "M0017"]


def test_prior_exclusion_with_bounds_violations_drift():
    """Round-1 loser with bounds_violations must not re-enter round 3 pool."""
    objective = "max_sharpe"
    prior_sigs: set[str] = set()

    core = {"mode": "risk_parity", "portfolio_id": 1}
    m0001_r1 = (
        0.90,
        {**core, "bounds_violations": [{"field": "w_mom"}]},
        {"objective_value_is": 0.90, "sharpe": 0.90},
    )
    m0002_r1 = _rec(2, 0.95)
    pool_r1 = build_round_competition_pool([m0001_r1, m0002_r1], None)
    winner_r1 = best_record_in_pool(pool_r1, objective)
    assert winner_r1 is not None
    assert winner_r1[1]["portfolio_id"] == 2
    register_prior_challenger_signatures(
        pool_r1, incoming_champion=None, round_winner=winner_r1, prior=prior_sigs
    )
    assert model_signature(m0001_r1[1]) in prior_sigs

    m0006 = _rec(6, 0.96)
    incoming = m0002_r1
    r2_trials = [m0006, _rec(7, 0.75), _rec(8, 0.72)]
    pool_r2 = build_round_competition_pool(
        r2_trials, incoming, prior_challenger_signatures=prior_sigs
    )
    winner_r2 = best_record_in_pool(pool_r2, objective)
    assert winner_r2 is not None
    assert winner_r2[1]["portfolio_id"] == 6
    register_prior_challenger_signatures(
        pool_r2, incoming_champion=incoming, round_winner=winner_r2, prior=prior_sigs
    )

    m0001_r3 = (
        0.88,
        {**core},
        {"objective_value_is": 0.88, "sharpe": 0.88},
    )
    pool_r3 = build_round_competition_pool(
        [m0001_r3, _rec(10, 0.68), _rec(11, 0.69)],
        m0006,
        prior_challenger_signatures=prior_sigs,
    )
    pool_ids = {r[1]["portfolio_id"] for r in pool_r3}
    assert 1 not in pool_ids
    assert 6 in pool_ids
    assert {10, 11}.issubset(pool_ids)


def test_pool_records_in_trial_order_not_objective_sorted():
    """Competition pool display must follow Optuna trial order, not objective rank."""
    round_records = [_rec(1, 0.50), _rec(2, 0.95), _rec(3, 0.60), _rec(4, 0.55)]
    assign_pro_round_model_codes(
        round_records,
        incoming_champion_record=None,
        incoming_champion_model_code=None,
        next_model_no=[1],
    )
    pool = build_round_competition_pool(round_records, None)
    filtered, pool_codes, _ = reconcile_pro_round_pool(
        pool, incoming_champion_model_code=None
    )
    ordered = pool_records_in_trial_order(round_records, filtered, pool_codes)
    assert [r[1]["portfolio_id"] for r in ordered] == [1, 2, 3, 4]
    assert [r[0] for r in ordered] == [0.50, 0.95, 0.60, 0.55]


def test_pool_records_in_trial_order_prepends_incoming_not_retried():
    incoming = _rec(2, 0.80)
    incoming[1]["model_code"] = "M0002"
    round_records = [_rec(6, 0.70), _rec(7, 0.75)]
    assign_pro_round_model_codes(
        round_records,
        incoming_champion_record=incoming,
        incoming_champion_model_code="M0002",
        next_model_no=[6],
    )
    pool = build_round_competition_pool(round_records, incoming)
    filtered, pool_codes, _ = reconcile_pro_round_pool(
        pool, incoming_champion_model_code="M0002"
    )
    ordered = pool_records_in_trial_order(round_records, filtered, pool_codes)
    assert [str(r[1].get("model_code")) for r in ordered] == [
        "M0002",
        "M0006",
        "M0007",
    ]


def test_round3_pool_incoming_plus_four_challengers_with_champion_resim():
    """Round 3+ must have 1 incoming + refinement_challengers_per_round unique models.

    When the incoming champion is re-simulated as an Optuna trial (champion_seed),
    build_round_competition_pool dedupes by signature — the pool still needs four
    distinct challenger codes plus the incoming code (five total).
    """
    challengers = 4
    next_no = [1]
    retired: set[str] = set()
    prior_sigs: set[str] = set()

    r1_trials = [_rec(i, 0.5 + i * 0.05) for i in range(1, 6)]
    assign_pro_round_model_codes(
        r1_trials,
        incoming_champion_record=None,
        incoming_champion_model_code=None,
        next_model_no=next_no,
    )
    pool_r1 = build_round_competition_pool(r1_trials, None)
    winner_r1 = best_record_in_pool(pool_r1, "max_sharpe")
    assert winner_r1 is not None
    retire_non_winner_model_codes(pool_r1, winner_r1, retired)
    carry_code = str(winner_r1[1]["model_code"])

    r2_trials = [_rec(6, 0.96), _rec(7, 0.75), _rec(8, 0.72), _rec(9, 0.71)]
    assign_pro_round_model_codes(
        r2_trials,
        incoming_champion_record=winner_r1,
        incoming_champion_model_code=carry_code,
        next_model_no=next_no,
    )
    pool_r2 = build_round_competition_pool(r2_trials, winner_r1)
    winner_r2 = best_record_in_pool(pool_r2, "max_sharpe")
    assert winner_r2 is not None
    register_prior_challenger_signatures(
        r2_trials, incoming_champion=winner_r1, round_winner=winner_r2, prior=prior_sigs
    )
    retire_non_winner_model_codes(pool_r2, winner_r2, retired)
    carry_code = str(winner_r2[1]["model_code"])

    incoming_r3 = winner_r2
    r3_trials = [
        _rec(6, 0.97),
        _rec(10, 0.68),
        _rec(11, 0.69),
        _rec(12, 0.67),
        _rec(13, 0.66),
    ]
    assign_pro_round_model_codes(
        r3_trials,
        incoming_champion_record=incoming_r3,
        incoming_champion_model_code=carry_code,
        next_model_no=next_no,
    )
    pool = build_round_competition_pool(
        r3_trials,
        incoming_r3,
        prior_challenger_signatures=prior_sigs,
        retired_model_codes=retired,
    )
    _filtered, pool_codes, challenger_codes = reconcile_pro_round_pool(
        pool,
        incoming_champion_model_code=carry_code,
        retired_model_codes=retired,
    )
    ordered = pool_records_in_trial_order(r3_trials, pool, pool_codes)

    assert len(pool_codes) == 1 + challengers
    assert len(challenger_codes) == challengers
    assert pool_codes[0] == carry_code
    assert set(pool_codes) == {carry_code} | set(challenger_codes)
    assert len(ordered) == 1 + challengers


def test_round3_pool_short_when_only_three_new_challengers():
    """Pre-fix failure mode: champion_seed consumed one of four trial slots."""
    incoming = _rec(6, 0.96)
    incoming[1]["model_code"] = "M0006"
    r3_trials = [
        _rec(6, 0.97),
        _rec(10, 0.68),
        _rec(11, 0.69),
        _rec(12, 0.67),
    ]
    assign_pro_round_model_codes(
        r3_trials,
        incoming_champion_record=incoming,
        incoming_champion_model_code="M0006",
        next_model_no=[10],
    )
    pool = build_round_competition_pool(r3_trials, incoming)
    _filtered, pool_codes, challenger_codes = reconcile_pro_round_pool(
        pool, incoming_champion_model_code="M0006"
    )
    assert len(pool_codes) == 4
    assert len(challenger_codes) == 3


def test_pro_round_report_top_n_assembles_full_pool_despite_top_models():
    """Round 2+ pool can be 6 (incoming + challengers + champion re-sim); top_models=5 must not truncate."""
    pool_codes = ["M0004", "M0006", "M0007", "M0008", "M0009", "M0010"]
    records = []
    for code in pool_codes:
        pid = int(code[1:])
        rec = _rec(pid, 0.5 + pid * 0.01)
        rec[1]["model_code"] = code
        records.append(rec)
    ordered, synced_codes = records_for_pool_model_codes(records, pool_codes)
    assert synced_codes == pool_codes
    assert len(ordered) == 6
    pr_top_n = pro_round_report_top_n(
        pool_model_codes=pool_codes,
        req_top_models=5,
        feasible_count=len(ordered),
    )
    assert pr_top_n == 6
    assert len(ordered[:pr_top_n]) == 6


def _metrics_with_is_oos(is_obj: float, oos_obj: float) -> dict:
    return {
        "objective_value_is": is_obj,
        "overfitting_assessment": {
            "in_sample_objective": is_obj,
            "out_of_sample_objective": oos_obj,
            "gap_objective": is_obj - oos_obj,
            "risk_level": "low",
        },
    }


def test_sort_round_records_by_optuna_trial_number():
    records = [
        (0.3, {"optuna_trial_number": 2}, _metrics_with_is_oos(0.3, 0.2)),
        (0.9, {"optuna_trial_number": 0}, _metrics_with_is_oos(0.9, 0.8)),
        (0.5, {"optuna_trial_number": 1}, _metrics_with_is_oos(0.5, 0.4)),
    ]
    ordered = _sort_round_records_for_convergence(records)
    assert [r[1]["optuna_trial_number"] for r in ordered] == [0, 1, 2]


def test_convergence_metrics_prefers_existing_per_trial_assessment():
    from app.engine.backtest import _convergence_metrics_for_record

    metrics_a = _metrics_with_is_oos(0.3, 0.2)
    metrics_b = _metrics_with_is_oos(0.8, 0.7)
    out_a = _convergence_metrics_for_record(
        0.3,
        {"portfolio_id": 1},
        metrics_a,
        trial_report_cache=None,
        objective_effective="max_sharpe",
        oos_enabled=True,
    )
    out_b = _convergence_metrics_for_record(
        0.8,
        {"portfolio_id": 2},
        metrics_b,
        trial_report_cache=None,
        objective_effective="max_sharpe",
        oos_enabled=True,
    )
    assert out_a["objective_value_is"] != out_b["objective_value_is"]


def test_resync_round_convergence_replaces_stale_duplicate_points():
    stale = {
        "round": 1,
        "trial": 2,
        "is_objective": 0.99,
        "oos_objective": 0.11,
        "gap_objective": 0.88,
    }
    history: list[dict] = [
        {"round": 1, "trial": 1, **{k: v for k, v in stale.items() if k not in ("round", "trial")}},
        {"round": 1, "trial": 2, **{k: v for k, v in stale.items() if k not in ("round", "trial")}},
        {"round": 2, "trial": 6, "is_objective": 0.5, "oos_objective": 0.4, "gap_objective": 0.1},
    ]
    records = [
        (0.2, {"portfolio_id": 1, "optuna_trial_number": 0}, _metrics_with_is_oos(0.20, 0.18)),
        (0.5, {"portfolio_id": 2, "optuna_trial_number": 1}, _metrics_with_is_oos(0.50, 0.40)),
        (0.8, {"portfolio_id": 3, "optuna_trial_number": 2}, _metrics_with_is_oos(0.80, 0.70)),
    ]
    _resync_round_convergence_from_records(
        history,
        round_idx=1,
        round_records=records,
        round_trial_base=1,
        objective_effective="max_sharpe",
    )
    round1 = [p for p in history if p.get("round") == 1]
    assert len(round1) == 3
    assert {p["trial"] for p in round1} == {1, 2, 3}
    is_vals = [p["is_objective"] for p in round1]
    assert len(set(is_vals)) == 3
    assert is_vals == [0.2, 0.5, 0.8]
    assert len([p for p in history if p.get("round") == 2]) == 1


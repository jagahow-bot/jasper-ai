"""Unit tests for fixed stress scenario windows (proposal slides Q3)."""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.engine.analytics import stress_scenarios


def _synthetic_equity() -> pd.Series:
    idx = pd.date_range("2007-01-01", "2023-12-31", freq="B")
    eq = pd.Series(100.0, index=idx)
    eq.loc["2007-10-09":"2009-03-09"] = np.linspace(
        100, 55, len(eq.loc["2007-10-09":"2009-03-09"])
    )
    eq.loc["2009-03-10":"2020-02-18"] = np.linspace(
        55, 200, len(eq.loc["2009-03-10":"2020-02-18"])
    )
    eq.loc["2020-02-19":"2020-03-23"] = np.linspace(
        200, 120, len(eq.loc["2020-02-19":"2020-03-23"])
    )
    eq.loc["2020-03-24":"2021-12-31"] = np.linspace(
        120, 250, len(eq.loc["2020-03-24":"2021-12-31"])
    )
    eq.loc["2022-01-03":"2022-10-12"] = np.linspace(
        250, 180, len(eq.loc["2022-01-03":"2022-10-12"])
    )
    eq.loc["2022-10-13":] = np.linspace(180, 220, len(eq.loc["2022-10-13":]))
    return eq


def test_stress_scenarios_depths_negative():
    rows = stress_scenarios(_synthetic_equity())
    assert [r["id"] for r in rows] == ["2008", "2020", "2022"]
    for r in rows:
        assert r["depth"] is not None
        assert r["depth"] < 0


def test_stress_scenarios_missing_window_is_none():
    eq = _synthetic_equity().loc["2019-01-01":]
    rows = stress_scenarios(eq)
    by_id = {r["id"]: r for r in rows}
    assert by_id["2008"]["depth"] is None
    assert by_id["2020"]["depth"] is not None
    assert by_id["2022"]["depth"] is not None

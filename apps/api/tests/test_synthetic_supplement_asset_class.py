"""U1–U6: synthetic supplement asset_class hint chain."""

from __future__ import annotations

import logging

import pytest

from app import profiles


def test_u1_synthetic_with_alternative_hint(caplog):
    with caplog.at_level(logging.WARNING, logger="app.profiles"):
        row = profiles._synthetic_supplement_item(
            "PFX", asset_class_hint="alternative"
        )
    assert row["asset_class"] == "alternative"
    assert row["asset_class_source"] == "overlay_hint"
    assert not any("PFX" in r.message for r in caplog.records)


def test_u2_synthetic_no_hint_defaults_equity_with_warning(caplog):
    with caplog.at_level(logging.WARNING, logger="app.profiles"):
        row = profiles._synthetic_supplement_item("PFX")
    assert row["asset_class"] == "equity"
    assert row["asset_class_source"] == "default_equity"
    assert any(
        r.levelno >= logging.WARNING and "PFX" in r.message for r in caplog.records
    )


def test_u3_illegal_hint_defaults_equity(caplog):
    with caplog.at_level(logging.WARNING, logger="app.profiles"):
        row = profiles._synthetic_supplement_item("PFX", asset_class_hint="crypto")
    assert row["asset_class"] == "equity"
    assert any("PFX" in r.message for r in caplog.records)


def test_u4_catalog_hit_ignores_meta():
    catalog = [
        {
            "ticker": "SPY",
            "name": "SPDR S&P 500",
            "asset_class": "equity",
            "category": "us_core",
            "region": "us",
        }
    ]
    out = profiles._union_supplement_items(
        [],
        catalog,
        ["SPY"],
        bypass_asset_class_filter=True,
        supplement_meta={"SPY": {"asset_class": "alternative"}},
    )
    assert len(out) == 1
    assert out[0]["asset_class"] == "equity"
    assert out[0].get("overlay_synthetic") is not True


def test_u5_get_universe_and_pin_respect_meta():
    uni = profiles.get_universe(
        tickers=["SPY"],
        supplement_tickers=["PFX"],
        supplement_meta={"PFX": {"asset_class": "alternative"}},
    )
    by_t = {u["ticker"]: u for u in uni}
    assert "PFX" in by_t
    assert by_t["PFX"]["asset_class"] == "alternative"

    pinned = profiles.pin_guaranteed_supplements(
        [{"ticker": "SPY", "asset_class": "equity"}],
        ["PFX"],
        supplement_meta={"PFX": {"asset_class": "alternative"}},
    )
    by_t2 = {u["ticker"]: u for u in pinned}
    assert by_t2["PFX"]["asset_class"] == "alternative"


def test_u6_meta_none_matches_legacy_equity_default(caplog):
    with caplog.at_level(logging.WARNING, logger="app.profiles"):
        uni = profiles.get_universe(
            tickers=["SPY"],
            supplement_tickers=["ZZZUNKNOWN"],
            supplement_meta=None,
        )
    by_t = {u["ticker"]: u for u in uni}
    assert by_t["ZZZUNKNOWN"]["asset_class"] == "equity"
    assert by_t["ZZZUNKNOWN"]["overlay_synthetic"] is True

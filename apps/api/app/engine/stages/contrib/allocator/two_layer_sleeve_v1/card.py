"""Capability card override for two_layer_sleeve_v1."""

from __future__ import annotations

from app.engine.stages.base import StageCapabilityCard, empty_card

from .locales import SUMMARY


def build_card() -> StageCapabilityCard:
    return empty_card(
        stage="allocator",
        implementation_id="two_layer_sleeve_v1",
        version="0.1.0",
        summary=SUMMARY,
        invariants=[],
    )

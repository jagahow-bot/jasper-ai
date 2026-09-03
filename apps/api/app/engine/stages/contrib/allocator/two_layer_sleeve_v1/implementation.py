"""(4) Main logic for two_layer_sleeve_v1 (allocator)."""

from __future__ import annotations

from typing import Any

from app.engine.stages.base import StageCapabilityCard, StageIssue, StageKind, empty_card

STAGE: StageKind = "allocator"
IMPLEMENTATION_ID = "two_layer_sleeve_v1"
VERSION = "0.1.0"


class TwoLayerSleeveV1:
    stage: StageKind = STAGE
    implementation_id: str = IMPLEMENTATION_ID
    version: str = VERSION

    def validate_config(self, config: dict[str, Any]) -> list[StageIssue]:
        # (2) validate_config — fill bounds checks
        del config
        return []

    def capability_card(self) -> StageCapabilityCard:
        from .card import build_card

        return build_card()


def build_two_layer_sleeve_v1() -> TwoLayerSleeveV1:
    return TwoLayerSleeveV1()

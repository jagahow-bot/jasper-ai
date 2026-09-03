"""(3) Mechanical feasibility for two_layer_sleeve_v1."""

from __future__ import annotations

from typing import Any

from app.engine.stages.base import StageIssue


def check_feasibility(config: dict[str, Any]) -> list[StageIssue]:
    del config
    return []

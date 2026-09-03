"""Pipeline-stage plugin package (Phase 0 foundation)."""

from __future__ import annotations

from app.engine.stages.base import (
    LEGACY_CATALOG_VERSION,
    LEGACY_IMPLEMENTATIONS_MARKER,
    STAGE_KINDS,
    Stage,
    StageCapabilityCard,
    StageContext,
    StageIssue,
    StageKind,
    TunableSpec,
)
from app.engine.stages.registry import (
    StageRegistration,
    StageRegistry,
    apply_legacy_stage_defaults,
    get_registry,
    reset_registry_for_tests,
    stage_pin_fields,
)

__all__ = [
    "LEGACY_CATALOG_VERSION",
    "LEGACY_IMPLEMENTATIONS_MARKER",
    "STAGE_KINDS",
    "Stage",
    "StageCapabilityCard",
    "StageContext",
    "StageIssue",
    "StageKind",
    "StageRegistration",
    "StageRegistry",
    "TunableSpec",
    "apply_legacy_stage_defaults",
    "get_registry",
    "reset_registry_for_tests",
    "stage_pin_fields",
]

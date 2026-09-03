"""Shared types for pipeline-stage plugins (Phase 0)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Protocol, runtime_checkable

import pandas as pd

from app.engine.spec import BacktestSpec
from app.models import BacktestRequest, ClientContext

StageKind = Literal[
    "universe",
    "signals",
    "allocator",
    "constraints",
    "objective",
    "rebalance",
    "cash_schedule",
    "reporting",
]

STAGE_KINDS: tuple[StageKind, ...] = (
    "universe",
    "signals",
    "allocator",
    "constraints",
    "objective",
    "rebalance",
    "cash_schedule",
    "reporting",
)

ApprovalStatus = Literal["pending_rm_confirmation", "rm_confirmed", "approved"]
RegistrationStatus = Literal["active", "deprecated", "shadow"]
IssueSeverity = Literal["error", "warning"]
TunableKind = Literal["numeric", "categorical", "boolean"]

LEGACY_CATALOG_VERSION = "v0-legacy"
LEGACY_IMPLEMENTATIONS_MARKER = "legacy-monolith"


@dataclass(frozen=True)
class StageContext:
    """Cross-stage read-only context: request, spec, anchor, client needs, prices."""

    req: BacktestRequest
    spec: BacktestSpec
    anchor_weights: dict[str, float] | None
    client_context: ClientContext | None
    prices: pd.DataFrame
    universe_meta: dict[str, dict[str, Any]]
    seed: int


@dataclass(frozen=True)
class StageIssue:
    code: str
    message_zh: str
    message_en: str
    message_ko: str
    severity: IssueSeverity


@dataclass(frozen=True)
class TunableSpec:
    key: str
    kind: TunableKind
    bounds: tuple[float, float] | None
    choices: list[str] | None
    default: Any
    overlay_eligible: bool
    description: dict[str, str]


@dataclass(frozen=True)
class StageCapabilityCard:
    stage: StageKind
    implementation_id: str
    version: str
    summary: dict[str, str]
    inputs: list[dict[str, str]]
    outputs: list[dict[str, str]]
    tunables: list[TunableSpec]
    invariants: list[str]
    since_pr: str | None = None


@runtime_checkable
class Stage(Protocol):
    """Common interface for every stage implementation."""

    stage: StageKind
    implementation_id: str
    version: str

    def validate_config(self, config: dict[str, Any]) -> list[StageIssue]: ...

    def capability_card(self) -> StageCapabilityCard: ...


def empty_card(
    *,
    stage: StageKind,
    implementation_id: str,
    version: str,
    summary: dict[str, str] | None = None,
    invariants: list[str] | None = None,
) -> StageCapabilityCard:
    """Minimal capability card helper for built-in Phase 0 wrappers."""
    return StageCapabilityCard(
        stage=stage,
        implementation_id=implementation_id,
        version=version,
        summary=summary
        or {
            "zh": f"{implementation_id}（內建）",
            "en": f"{implementation_id} (built-in)",
            "ko": f"{implementation_id} (내장)",
        },
        inputs=[],
        outputs=[],
        tunables=[],
        invariants=invariants or [],
        since_pr=None,
    )


def issue(
    code: str,
    *,
    zh: str,
    en: str,
    ko: str,
    severity: IssueSeverity = "error",
) -> StageIssue:
    return StageIssue(
        code=code,
        message_zh=zh,
        message_en=en,
        message_ko=ko,
        severity=severity,
    )

"""Objective stage: trial scoring and client-needs soft penalties (Phase 0)."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from app.engine.objectives import (
    compute_client_needs_penalty,
    compute_objective_score,
)
from app.engine.stages.base import (
    Stage,
    StageCapabilityCard,
    StageContext,
    StageIssue,
    StageKind,
    empty_card,
)

STAGE: StageKind = "objective"
IMPLEMENTATION_ID = "metrics_score_v1"
VERSION = "1.0.0"


@runtime_checkable
class ObjectiveStage(Stage, Protocol):
    def score(self, metrics: dict[str, Any], ctx: StageContext) -> float: ...

    def needs_penalty(
        self,
        metrics: dict[str, Any],
        holdings: dict[str, float],
        ctx: StageContext,
    ) -> float: ...


class MetricsScoreObjectiveV1:
    """Built-in objective wrapping engine.objectives scoring helpers."""

    stage: StageKind = STAGE
    implementation_id: str = IMPLEMENTATION_ID
    version: str = VERSION

    def validate_config(self, config: dict[str, Any]) -> list[StageIssue]:
        del config
        return []

    def capability_card(self) -> StageCapabilityCard:
        return empty_card(
            stage=STAGE,
            implementation_id=IMPLEMENTATION_ID,
            version=VERSION,
            summary={
                "zh": "指標目標分數與客戶需求 soft penalty（內建）",
                "en": "Metric objective score plus client-needs soft penalty (built-in)",
                "ko": "지표 목적 점수 및 고객 니즈 soft penalty (내장)",
            },
            invariants=[
                "higher score is better for all objective modes",
                "needs_penalty == 0 when client_context is empty",
                "deterministic given metrics and context",
            ],
        )

    def score(self, metrics: dict[str, Any], ctx: StageContext) -> float:
        mode = ctx.req.objective.value if hasattr(ctx.req.objective, "value") else str(
            ctx.req.objective
        )
        return compute_objective_score(mode, metrics)

    def needs_penalty(
        self,
        metrics: dict[str, Any],
        holdings: dict[str, float],
        ctx: StageContext,
    ) -> float:
        return compute_client_needs_penalty(
            metrics,
            ctx.client_context,
            holdings=holdings,
            ticker_meta=ctx.universe_meta,
        )

    def compute_objective_score(
        self, objective_mode: str, metrics: dict[str, Any]
    ) -> float:
        return compute_objective_score(objective_mode, metrics)

    def compute_client_needs_penalty(
        self,
        metrics: dict[str, Any],
        client_context: Any | None,
        *,
        holdings: dict[str, float] | None = None,
        ticker_meta: dict[str, dict[str, Any]] | None = None,
    ) -> float:
        return compute_client_needs_penalty(
            metrics,
            client_context,
            holdings=holdings,
            ticker_meta=ticker_meta,
        )


def build_metrics_score_v1() -> MetricsScoreObjectiveV1:
    return MetricsScoreObjectiveV1()

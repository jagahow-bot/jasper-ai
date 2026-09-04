"""Reporting stage Protocol + built-in needs_attainment_v1 (Phase 0 scaffold)."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from app.engine.objectives import needs_attainment
from app.engine.stages.base import (
    Stage,
    StageCapabilityCard,
    StageContext,
    StageIssue,
    StageKind,
    empty_card,
)
from app.models import PortfolioCandidate, ProposalCard

STAGE: StageKind = "reporting"
IMPLEMENTATION_ID = "needs_attainment_v1"
VERSION = "1.0.0"


@runtime_checkable
class ReportingStage(Stage, Protocol):
    def attainment(
        self,
        metrics: dict[str, Any],
        holdings: dict[str, float],
        ctx: StageContext,
    ) -> dict[str, Any] | None: ...

    def proposal_cards(
        self,
        candidates: list[PortfolioCandidate],
        ctx: StageContext,
    ) -> list[ProposalCard]: ...


class NeedsAttainmentReportingV1:
    """Built-in reporting wrapping needs_attainment / pick_pareto_proposals."""

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
                "zh": "客戶需求達標檢查與 Pareto 提案卡（Phase 0 骨架）",
                "en": "Client needs attainment and Pareto proposal cards (Phase 0 scaffold)",
                "ko": "고객 니즈 달성 검사 및 Pareto 제안 카드 (Phase 0 스캐폴드)",
            },
        )

    def attainment(
        self,
        metrics: dict[str, Any],
        holdings: dict[str, float],
        ctx: StageContext,
    ) -> dict[str, Any] | None:
        drift = getattr(ctx.req, "customization_drift", None)
        return needs_attainment(
            metrics,
            ctx.client_context,
            holdings=holdings,
            ticker_meta=ctx.universe_meta,
            anchor_weights=ctx.anchor_weights,
            customization_drift=float(drift) if drift is not None else None,
            class_budget=getattr(ctx, "class_budget", None),
        )

    def needs_attainment(
        self,
        metrics: dict[str, Any],
        client_context: Any | None,
        *,
        holdings: dict[str, float] | None = None,
        ticker_meta: dict[str, dict[str, Any]] | None = None,
        must_include_tickers: list[str] | None = None,
        anchor_weights: dict[str, float] | None = None,
        customization_drift: float | None = None,
        class_budget: dict[str, float] | None = None,
    ) -> dict[str, Any] | None:
        """Legacy-compatible entry matching engine.objectives.needs_attainment."""
        return needs_attainment(
            metrics,
            client_context,
            holdings=holdings,
            ticker_meta=ticker_meta,
            must_include_tickers=must_include_tickers,
            anchor_weights=anchor_weights,
            customization_drift=customization_drift,
            class_budget=class_budget,
        )

    def proposal_cards(
        self,
        candidates: list[PortfolioCandidate],
        ctx: StageContext,
    ) -> list[ProposalCard]:
        """Phase 0 scaffold: full proposal assembly stays in backtest.py (PR-13)."""
        del candidates, ctx
        return []


def build_needs_attainment_v1() -> NeedsAttainmentReportingV1:
    return NeedsAttainmentReportingV1()

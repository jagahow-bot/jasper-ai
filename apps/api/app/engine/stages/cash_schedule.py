"""Cash schedule stage Protocol + built-in dca_v1 (Phase 0 scaffold)."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

import pandas as pd

from app.engine.stages.base import (
    Stage,
    StageCapabilityCard,
    StageContext,
    StageIssue,
    StageKind,
    empty_card,
)

STAGE: StageKind = "cash_schedule"
IMPLEMENTATION_ID = "dca_v1"
VERSION = "1.0.0"


@runtime_checkable
class CashScheduleStage(Stage, Protocol):
    def invested_fraction(
        self, ctx: StageContext, date: pd.Timestamp, t_index: int
    ) -> float: ...


class DcaCashScheduleV1:
    """Built-in DCA cash schedule wrapping portfolio.deployment_fraction."""

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
                "zh": "DCA 部署比例 × 現金保留（Phase 0 骨架）",
                "en": "DCA deployment fraction × cash reserve (Phase 0 scaffold)",
                "ko": "DCA 투입 비율 × 현금 보유 (Phase 0 스캐폴드)",
            },
            invariants=["invested_fraction ∈ [0, 1]"],
        )

    def deployment_fraction(
        self,
        dt: pd.Timestamp,
        start: pd.Timestamp,
        months: int | None,
        tranches: int | None,
    ) -> float:
        """Legacy-compatible DCA fraction (pure; no cash_reserve overlay)."""
        from app.engine.portfolio import deployment_fraction as _legacy

        return float(_legacy(dt, start, months, tranches))

    def invested_fraction(
        self, ctx: StageContext, date: pd.Timestamp, t_index: int
    ) -> float:
        del t_index
        months = ctx.spec.deployment_months
        if months is None:
            months = getattr(ctx.req, "deployment_months", None)
        tranches = ctx.spec.deployment_tranches
        if tranches is None:
            tranches = getattr(ctx.req, "deployment_tranches", None)
        start = (
            pd.Timestamp(ctx.prices.index[0])
            if len(ctx.prices.index)
            else pd.Timestamp(date)
        )
        dca = float(
            self.deployment_fraction(pd.Timestamp(date), start, months, tranches)
        )
        target = float(ctx.spec.target_invested_frac)
        return float(max(0.0, min(1.0, dca * target)))


def build_dca_v1() -> DcaCashScheduleV1:
    return DcaCashScheduleV1()

"""Rebalance stage Protocol + built-in calendar_qe_v1 (Phase 0 scaffold)."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

import numpy as np
import pandas as pd

from app.engine.stages.base import (
    Stage,
    StageCapabilityCard,
    StageContext,
    StageIssue,
    StageKind,
    empty_card,
)

STAGE: StageKind = "rebalance"
IMPLEMENTATION_ID = "calendar_qe_v1"
VERSION = "1.0.0"


@runtime_checkable
class RebalanceStage(Stage, Protocol):
    def schedule(
        self, ctx: StageContext, index: pd.DatetimeIndex
    ) -> list[pd.Timestamp]: ...

    def apply(
        self,
        w_new: np.ndarray,
        w_prev: np.ndarray,
        *,
        max_turnover: float,
        no_trade_tol: float,
    ) -> np.ndarray: ...


class CalendarQeRebalanceV1:
    """Built-in calendar rebalance wrapping portfolio schedule helpers."""

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
                "zh": "日曆再平衡（QE/ME 等規則）與周轉率上限（Phase 0 骨架）",
                "en": "Calendar rebalance (QE/ME) with turnover cap (Phase 0 scaffold)",
                "ko": "캘린더 리밸런스 및 회전율 상한 (Phase 0 스캐폴드)",
            },
        )

    def trading_day_rebalance_dates(
        self, index: pd.DatetimeIndex, rule: str
    ) -> list[pd.Timestamp]:
        """Legacy-compatible calendar schedule (lazy-import portfolio helper)."""
        from app.engine.portfolio import _trading_day_rebalance_dates

        return list(_trading_day_rebalance_dates(index, rule))

    def schedule(
        self, ctx: StageContext, index: pd.DatetimeIndex
    ) -> list[pd.Timestamp]:
        rule = ctx.req.rebalance_freq or ctx.spec.rebalance_rule or "QE"
        return self.trading_day_rebalance_dates(index, rule)

    def apply(
        self,
        w_new: np.ndarray,
        w_prev: np.ndarray,
        *,
        max_turnover: float,
        no_trade_tol: float,
    ) -> np.ndarray:
        # no_trade_tol is applied in portfolio._finalize_rebalance_weights;
        # this stage entry mirrors the turnover-cap primitive for Phase 0.
        del no_trade_tol
        from app.engine.portfolio import _apply_max_turnover

        return _apply_max_turnover(w_new, w_prev, float(max_turnover))


def build_calendar_qe_v1() -> CalendarQeRebalanceV1:
    return CalendarQeRebalanceV1()

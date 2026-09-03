"""Signals stage Protocol + built-in factor_lib_v1 (Phase 0 scaffold)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

import pandas as pd

from app.engine.factors import FactorParams, score_assets, score_assets_with_details
from app.engine.stages.base import (
    Stage,
    StageCapabilityCard,
    StageContext,
    StageIssue,
    StageKind,
    empty_card,
)
from app.engine.stages.universe import UniverseResult

STAGE: StageKind = "signals"
IMPLEMENTATION_ID = "factor_lib_v1"
VERSION = "1.0.0"


@dataclass(frozen=True)
class SignalResult:
    scores: pd.Series
    details: dict[str, pd.Series]


@runtime_checkable
class SignalsStage(Stage, Protocol):
    def score(
        self,
        ctx: StageContext,
        date: pd.Timestamp,
        universe: UniverseResult,
        params: FactorParams,
    ) -> SignalResult: ...


class FactorLibSignalsV1:
    """Built-in signals wrapping factors.score_assets* (full wire-up in later PR)."""

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
                "zh": "內建因子庫訊號（mom/reversal/value/lowvol/trend/drawdown/income）",
                "en": "Built-in factor library signals",
                "ko": "내장 팩터 라이브러리 시그널",
            },
        )

    def score_assets_with_details(
        self,
        prices: pd.DataFrame,
        rets: pd.DataFrame,
        params: FactorParams,
        *,
        dividend_panel: pd.DataFrame | None = None,
    ) -> tuple[pd.Series, dict]:
        """Legacy-compatible entry matching factors.score_assets_with_details."""
        return score_assets_with_details(
            prices, rets, params, dividend_panel=dividend_panel
        )

    def score(
        self,
        ctx: StageContext,
        date: pd.Timestamp,
        universe: UniverseResult,
        params: FactorParams,
    ) -> SignalResult:
        del date
        cols = list(universe.tradable) if universe.tradable else list(ctx.prices.columns)
        prices = ctx.prices.reindex(columns=cols).dropna(how="all", axis=1)
        rets = prices.pct_change().fillna(0.0)
        scores, detail = self.score_assets_with_details(prices, rets, params)
        contrib = detail.get("contrib") or {}
        details = {
            k: v for k, v in contrib.items() if isinstance(v, pd.Series)
        }
        if scores is None:
            scores = score_assets(prices, rets, params)
        return SignalResult(scores=scores, details=details)


def build_factor_lib_v1() -> FactorLibSignalsV1:
    return FactorLibSignalsV1()

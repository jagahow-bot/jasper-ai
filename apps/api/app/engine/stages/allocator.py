"""Allocator stage: weight solve from mu/Sigma (Phase 0)."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

import numpy as np

from app.engine.allocator import AllocatorParams, solve_weights
from app.engine.stages.base import (
    Stage,
    StageCapabilityCard,
    StageContext,
    StageIssue,
    StageKind,
    empty_card,
    issue,
)

STAGE: StageKind = "allocator"
IMPLEMENTATION_ID = "slsqp_classic_v1"
VERSION = "1.0.0"


@runtime_checkable
class AllocatorStage(Stage, Protocol):
    def solve(
        self,
        ctx: StageContext,
        *,
        mu: np.ndarray,
        cov: np.ndarray,
        chosen: list[str],
        params: AllocatorParams,
        w0: np.ndarray | None,
    ) -> np.ndarray: ...


class SlsqpClassicAllocatorV1:
    """Built-in allocator wrapping engine.allocator.solve_weights."""

    stage: StageKind = STAGE
    implementation_id: str = IMPLEMENTATION_ID
    version: str = VERSION

    def validate_config(self, config: dict[str, Any]) -> list[StageIssue]:
        mode = config.get("mode")
        if mode is None:
            return []
        allowed = {
            "min_var",
            "mean_variance",
            "risk_parity",
            "max_diversification",
        }
        if str(mode) not in allowed:
            return [
                issue(
                    "INVALID_ALLOCATOR_MODE",
                    zh=f"未知配置模式 {mode}",
                    en=f"Unknown allocator mode {mode}",
                    ko=f"알 수 없는 배분 모드 {mode}",
                )
            ]
        return []

    def capability_card(self) -> StageCapabilityCard:
        return empty_card(
            stage=STAGE,
            implementation_id=IMPLEMENTATION_ID,
            version=VERSION,
            summary={
                "zh": "SLSQP 經典配置器（min_var / mean_variance / risk_parity / max_diversification）",
                "en": "Classic SLSQP allocator (min_var / mean_variance / risk_parity / max_diversification)",
                "ko": "SLSQP 클래식 배분기 (min_var / mean_variance / risk_parity / max_diversification)",
            },
            invariants=[
                "len(w) == len(chosen)",
                "w_i ∈ [0, max_weight]",
                "sum(w) ≤ 1 (cash via cash_schedule)",
                "deterministic given seed/inputs",
            ],
        )

    def solve(
        self,
        ctx: StageContext,
        *,
        mu: np.ndarray,
        cov: np.ndarray,
        chosen: list[str],
        params: AllocatorParams,
        w0: np.ndarray | None,
    ) -> np.ndarray:
        max_weight = float(ctx.req.max_weight)
        drift = getattr(ctx.req, "customization_drift", None)
        anchor_full = ctx.anchor_weights or {}
        if chosen and anchor_full:
            w_anchor = np.asarray(
                [float(anchor_full.get(str(t), 0.0)) for t in chosen],
                dtype=float,
            )
        else:
            w_anchor = None
        return solve_weights(
            mu_annual=mu,
            cov_annual=cov,
            max_weight=max_weight,
            params=params,
            w0=w0,
            anchor_weights=w_anchor,
            customization_drift=float(drift) if drift is not None else None,
        )

    def solve_weights(
        self,
        *,
        mu_annual: np.ndarray,
        cov_annual: np.ndarray,
        max_weight: float,
        params: AllocatorParams,
        w0: np.ndarray | None = None,
        anchor_weights: np.ndarray | None = None,
        customization_drift: float | None = None,
    ) -> np.ndarray:
        """Legacy-compatible entry matching engine.allocator.solve_weights."""
        return solve_weights(
            mu_annual=mu_annual,
            cov_annual=cov_annual,
            max_weight=max_weight,
            params=params,
            w0=w0,
            anchor_weights=anchor_weights,
            customization_drift=customization_drift,
        )


def build_slsqp_classic_v1() -> SlsqpClassicAllocatorV1:
    return SlsqpClassicAllocatorV1()

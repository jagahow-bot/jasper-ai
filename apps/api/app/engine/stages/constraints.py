"""Constraints stage: feasibility + weight projection (Phase 0)."""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

import numpy as np

from app.engine.customization import (
    apply_must_include_floor,
    min_holdings_for_customization,
    project_anchor_l1_drift,
)
from app.engine.stages.base import (
    Stage,
    StageCapabilityCard,
    StageContext,
    StageIssue,
    StageKind,
    empty_card,
    issue,
)
from app.engine.weights import project_max_weight

STAGE: StageKind = "constraints"
IMPLEMENTATION_ID = "l1_drift_v1"
VERSION = "1.0.0"


@runtime_checkable
class ConstraintsStage(Stage, Protocol):
    def feasibility(
        self,
        ctx: StageContext,
        universe: Any,
        config: dict[str, Any],
    ) -> list[StageIssue]: ...

    def project(
        self,
        ctx: StageContext,
        w: np.ndarray,
        *,
        anchor: np.ndarray | None,
        must_include_idx: list[int],
        config: dict[str, Any],
    ) -> np.ndarray: ...


class L1DriftConstraintsV1:
    """Built-in constraints wrapping customization.py / weights.py."""

    stage: StageKind = STAGE
    implementation_id: str = IMPLEMENTATION_ID
    version: str = VERSION

    def validate_config(self, config: dict[str, Any]) -> list[StageIssue]:
        issues: list[StageIssue] = []
        if "max_weight" in config:
            try:
                mw = float(config["max_weight"])
            except (TypeError, ValueError):
                issues.append(
                    issue(
                        "INVALID_MAX_WEIGHT",
                        zh="max_weight 必須為數值",
                        en="max_weight must be numeric",
                        ko="max_weight는 숫자여야 합니다",
                    )
                )
            else:
                if not (0.0 < mw <= 1.0):
                    issues.append(
                        issue(
                            "INVALID_MAX_WEIGHT",
                            zh="max_weight 須在 (0, 1]",
                            en="max_weight must be in (0, 1]",
                            ko="max_weight는 (0, 1] 범위여야 합니다",
                        )
                    )
        if "customization_drift" in config and config["customization_drift"] is not None:
            try:
                drift = float(config["customization_drift"])
            except (TypeError, ValueError):
                issues.append(
                    issue(
                        "INVALID_DRIFT",
                        zh="customization_drift 必須為數值",
                        en="customization_drift must be numeric",
                        ko="customization_drift는 숫자여야 합니다",
                    )
                )
            else:
                if not (0.0 <= drift <= 1.0):
                    issues.append(
                        issue(
                            "INVALID_DRIFT",
                            zh="customization_drift 須在 [0, 1]",
                            en="customization_drift must be in [0, 1]",
                            ko="customization_drift는 [0, 1] 범위여야 합니다",
                        )
                    )
        return issues

    def capability_card(self) -> StageCapabilityCard:
        return empty_card(
            stage=STAGE,
            implementation_id=IMPLEMENTATION_ID,
            version=VERSION,
            summary={
                "zh": "單層 L1 漂移球投影與持股/上限可行性預檢（內建）",
                "en": "Single-layer L1 drift ball projection and holdings/cap feasibility (built-in)",
                "ko": "단층 L1 드리프트 투영 및 보유/상한 타당성 검사 (내장)",
            },
            invariants=[
                "sum(w) ≈ 1 after projection (cash handled elsewhere)",
                "w_i ∈ [0, max_weight]",
                "L1(w, anchor) ≤ drift when drift is set (last transform)",
                "deterministic given inputs",
            ],
        )

    def feasibility(
        self,
        ctx: StageContext,
        universe: Any,
        config: dict[str, Any],
    ) -> list[StageIssue]:
        """Mechanical pre-check aligned with min_holdings_for_customization."""
        del ctx  # reserved for future universe-aware checks
        max_weight = float(config.get("max_weight", 0.25))
        drift = config.get("customization_drift")
        n_must = int(config.get("n_must_include", 0))
        n_assets = int(config.get("n_assets", 0))
        if hasattr(universe, "tradable") and n_assets <= 0:
            n_assets = len(getattr(universe, "tradable", []) or [])
        if hasattr(universe, "must_include") and n_must <= 0:
            n_must = len(getattr(universe, "must_include", []) or [])
        if n_assets <= 0:
            return [
                issue(
                    "EMPTY_UNIVERSE",
                    zh="可交易宇宙為空",
                    en="Tradable universe is empty",
                    ko="거래 가능 유니버스가 비어 있습니다",
                )
            ]
        need = min_holdings_for_customization(
            n_must_include=n_must,
            max_weight=max_weight,
            customization_drift=float(drift) if drift is not None else None,
            n_assets=n_assets,
        )
        max_holdings = config.get("max_holdings")
        if max_holdings is not None and int(max_holdings) < need:
            return [
                issue(
                    "INFEASIBLE_DRIFT",
                    zh=f"持股上限 {max_holdings} 低於客製化可行性下界 {need}",
                    en=f"max_holdings {max_holdings} below customization floor {need}",
                    ko=f"보유 상한 {max_holdings}이 커스터마이징 하한 {need}보다 낮습니다",
                    severity="warning",
                )
            ]
        return []

    def project(
        self,
        ctx: StageContext,
        w: np.ndarray,
        *,
        anchor: np.ndarray | None,
        must_include_idx: list[int],
        config: dict[str, Any],
    ) -> np.ndarray:
        """project_max_weight (+ optional must-include floor) then L1 drift last."""
        del ctx
        max_weight = float(config.get("max_weight", 0.25))
        drift = config.get("customization_drift")
        floor = float(config.get("must_include_floor", 0.0) or 0.0)
        out = project_max_weight(np.asarray(w, dtype=float), max_weight)
        if must_include_idx and floor > 0.0:
            out = apply_must_include_floor(
                out,
                list(must_include_idx),
                floor=floor,
                max_weight=max_weight,
            )
        if anchor is not None and drift is not None:
            out = project_anchor_l1_drift(
                out,
                np.asarray(anchor, dtype=float),
                float(drift),
                max_weight,
            )
        return out

    # --- Legacy-compatible facades (bit-for-bit wrappers) ---

    def project_max_weight(
        self, w: np.ndarray, max_weight: float, max_iter: int = 100
    ) -> np.ndarray:
        return project_max_weight(w, max_weight, max_iter=max_iter)

    def project_anchor_l1_drift(
        self,
        w: np.ndarray,
        anchor: np.ndarray,
        drift: float,
        max_weight: float,
        *,
        max_iter: int = 24,
    ) -> np.ndarray:
        return project_anchor_l1_drift(
            w, anchor, drift, max_weight, max_iter=max_iter
        )

    def min_holdings_for_customization(
        self,
        *,
        n_must_include: int,
        max_weight: float,
        customization_drift: float | None,
        n_assets: int,
    ) -> int:
        return min_holdings_for_customization(
            n_must_include=n_must_include,
            max_weight=max_weight,
            customization_drift=customization_drift,
            n_assets=n_assets,
        )

    def apply_must_include_floor(
        self,
        w: np.ndarray,
        must_indices: list[int],
        *,
        floor: float,
        max_weight: float,
    ) -> np.ndarray:
        return apply_must_include_floor(
            w, must_indices, floor=floor, max_weight=max_weight
        )


def build_l1_drift_v1() -> L1DriftConstraintsV1:
    return L1DriftConstraintsV1()

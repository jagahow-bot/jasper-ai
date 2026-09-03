"""Universe stage Protocol + built-in etf_catalog_v1 (Phase 0 scaffold)."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from app.engine.stages.base import (
    Stage,
    StageCapabilityCard,
    StageContext,
    StageIssue,
    StageKind,
    empty_card,
)

STAGE: StageKind = "universe"
IMPLEMENTATION_ID = "etf_catalog_v1"
VERSION = "1.0.0"


@dataclass(frozen=True)
class UniverseResult:
    tradable: list[str]
    must_include: list[str]
    excluded: list[str]
    benchmark_ticker: str
    provenance: dict[str, Any]


@runtime_checkable
class UniverseStage(Stage, Protocol):
    def build(self, ctx: StageContext) -> UniverseResult: ...


class EtfCatalogUniverseV1:
    """Phase 0 scaffold: passthrough of request tickers (full extract in later PR)."""

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
                "zh": "ETF 目錄宇宙建構（Phase 0 骨架）",
                "en": "ETF catalog universe builder (Phase 0 scaffold)",
                "ko": "ETF 카탈로그 유니버스 (Phase 0 스캐폴드)",
            },
        )

    def derive_must_include_tickers(
        self,
        tickers: list[str],
        anchor_weights: dict[str, float] | None,
    ) -> list[str]:
        """Legacy-compatible entry matching customization.derive_must_include_tickers."""
        from app.engine.customization import derive_must_include_tickers

        return list(derive_must_include_tickers(tickers, anchor_weights))

    def build(self, ctx: StageContext) -> UniverseResult:
        tickers = list(ctx.req.universe_tickers or [])
        must = self.derive_must_include_tickers(tickers, ctx.anchor_weights)
        bench = (
            ctx.spec.benchmark_ticker
            or getattr(ctx.req, "benchmark_ticker", None)
            or "SPY"
        )
        return UniverseResult(
            tradable=tickers,
            must_include=must,
            excluded=[],
            benchmark_ticker=str(bench),
            provenance={t: {"source": "request"} for t in tickers},
        )


def build_etf_catalog_v1() -> EtfCatalogUniverseV1:
    return EtfCatalogUniverseV1()

"""User-facing champion metrics — aligned with the UI full-period grid."""

from __future__ import annotations

from typing import TYPE_CHECKING, NamedTuple

if TYPE_CHECKING:
    from app.models import PortfolioCandidate


class ChampionDisplayMetrics(NamedTuple):
    sharpe: float
    cagr: float
    max_drawdown: float
    horizon: str  # "full_sample" | "selection"


def champion_display_metrics(cand: PortfolioCandidate) -> ChampionDisplayMetrics:
    """Sharpe/CAGR/max DD for report grid, email, and job history (prefers full_sample)."""
    sm = (cand.analytics or {}).get("sample_metrics") or {}
    full = sm.get("full_sample")
    if isinstance(full, dict) and full:
        return ChampionDisplayMetrics(
            sharpe=float(full.get("sharpe", cand.sharpe)),
            cagr=float(full.get("cagr", cand.cagr)),
            max_drawdown=float(full.get("max_drawdown", cand.max_drawdown)),
            horizon="full_sample",
        )
    return ChampionDisplayMetrics(
        sharpe=float(cand.sharpe),
        cagr=float(cand.cagr),
        max_drawdown=float(cand.max_drawdown),
        horizon="selection",
    )

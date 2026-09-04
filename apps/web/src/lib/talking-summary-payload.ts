import type { BacktestResult, PortfolioCandidate } from "@/lib/types";

/**
 * Strip chart/UI-only bulk from adjustedResult before POST /api/talking-summary.
 * Keeps weights, exposure, needs_attainment, and class_quota_unfilled for the
 * LLM + template fallback — omits equity curves / weight history / full catalog.
 */
export function slimTalkingSummaryResult(
  result: BacktestResult,
  modelCode?: string | null,
): Record<string, unknown> {
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  const code = modelCode?.trim().toUpperCase() || null;

  let picked: PortfolioCandidate | undefined;
  if (code) {
    picked = candidates.find(
      (c) => (c.model_code ?? "").toUpperCase() === code,
    );
  }
  if (!picked) {
    picked =
      candidates.find((c) => c.is_champion === true) ?? candidates[0];
  }

  const slimCandidate = picked
    ? {
        model_code: picked.model_code,
        rank: picked.rank,
        is_champion: picked.is_champion,
        weights: picked.weights ?? null,
        sharpe: picked.sharpe,
        cagr: picked.cagr,
        max_drawdown: picked.max_drawdown,
        volatility: picked.volatility,
        needs_attainment: picked.needs_attainment ?? null,
        analytics: picked.analytics?.exposure
          ? { exposure: picked.analytics.exposure }
          : undefined,
      }
    : null;

  const nf = (result.narrative_facts ?? {}) as Record<string, unknown>;

  return {
    job_id: result.job_id,
    candidates: slimCandidate ? [slimCandidate] : [],
    narrative_facts: {
      objective: nf.objective,
      objective_label: nf.objective_label,
      champion_model_code: nf.champion_model_code,
      ai_champion_model_code: nf.ai_champion_model_code,
      class_quota_unfilled: nf.class_quota_unfilled ?? null,
    },
  };
}

/** Keep only client-facing overlay fields the talking-summary prompt needs. */
export function slimTalkingSummaryOverlay(
  overlay: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!overlay || typeof overlay !== "object") return null;
  const universe = overlay.universe as Record<string, unknown> | undefined;
  const asks = Array.isArray(overlay.asks) ? overlay.asks : undefined;
  return {
    client_profile: overlay.client_profile ?? null,
    market_view: overlay.market_view ?? null,
    allocation: overlay.allocation ?? null,
    universe: universe
      ? {
          prompts: universe.prompts ?? [],
          supplement_tickers: universe.supplement_tickers ?? [],
          proposed_tickers: universe.proposed_tickers ?? [],
        }
      : null,
    asks: asks?.slice(0, 12) ?? [],
    confidence: overlay.confidence,
    rationale: overlay.rationale,
  };
}

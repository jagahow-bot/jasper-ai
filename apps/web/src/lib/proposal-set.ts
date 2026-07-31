import type { PortfolioCandidate, ProposalCard } from "@/lib/types";
import { resolveCandidateWeights } from "@/lib/candidate-weights";

const SHARPE_EPS = 5e-4;
const CAGR_EPS = 5e-5;
const MDD_EPS = 5e-5;
const WEIGHT_ROUND = 4;

function needsScore(
  attainment: PortfolioCandidate["needs_attainment"] | ProposalCard["needs_attainment"],
): number {
  if (!attainment) return 0;
  const keys = [
    "within_drawdown_tolerance",
    "within_single_name_cap",
    "within_theme_cap",
    "within_cash_reserve",
    "within_income_need",
  ] as const;
  const vals = keys
    .filter((k) => k in attainment)
    .map((k) => (attainment[k] ? 1 : 0));
  return vals.length
    ? vals.reduce<number>((a, b) => a + b, 0) / vals.length
    : 0;
}

export function weightsSignature(
  weights: Record<string, number> | null | undefined,
): string | null {
  if (!weights) return null;
  const parts: string[] = [];
  for (const ticker of Object.keys(weights).sort((a, b) =>
    a.toUpperCase().localeCompare(b.toUpperCase()),
  )) {
    const w = Number(weights[ticker]);
    if (!Number.isFinite(w) || Math.abs(w) < 10 ** -(WEIGHT_ROUND + 1)) continue;
    parts.push(`${ticker.toUpperCase()}:${w.toFixed(WEIGHT_ROUND)}`);
  }
  return parts.length ? parts.join("|") : null;
}

function proposalsNearIdentical(
  a: {
    sharpe: number;
    cagr: number;
    max_drawdown: number;
    needsScore: number;
    weightsSig: string | null;
  },
  b: {
    sharpe: number;
    cagr: number;
    max_drawdown: number;
    needsScore: number;
    weightsSig: string | null;
  },
): boolean {
  if (a.weightsSig && b.weightsSig && a.weightsSig === b.weightsSig) return true;
  if (Math.abs(a.sharpe - b.sharpe) > SHARPE_EPS) return false;
  if (Math.abs(a.cagr - b.cagr) > CAGR_EPS) return false;
  if (Math.abs(a.max_drawdown - b.max_drawdown) > MDD_EPS) return false;
  return a.needsScore === b.needsScore;
}

/**
 * Drop near-identical proposal cards (same rounded weights or same headline
 * metrics). Keeps recommended / earlier cards; never pads with clones.
 */
export function dedupeProposalSet(
  proposals: ProposalCard[] | null | undefined,
  candidates?: PortfolioCandidate[] | null,
): ProposalCard[] {
  if (!proposals?.length) return [];
  const byCode = new Map<string, PortfolioCandidate>();
  for (const c of candidates ?? []) {
    const code = (c.model_code || "").toUpperCase();
    if (code) byCode.set(code, c);
  }

  const ordered = [...proposals].sort((a, b) => {
    if (a.is_recommended !== b.is_recommended) return a.is_recommended ? -1 : 1;
    return 0;
  });

  const kept: ProposalCard[] = [];
  const keptMeta: {
    sharpe: number;
    cagr: number;
    max_drawdown: number;
    needsScore: number;
    weightsSig: string | null;
  }[] = [];

  for (const p of ordered) {
    const cand = byCode.get(p.model_code.toUpperCase());
    const weights = cand ? resolveCandidateWeights(cand) : null;
    const meta = {
      sharpe: p.sharpe,
      cagr: p.cagr,
      max_drawdown: p.max_drawdown,
      needsScore: needsScore(p.needs_attainment),
      weightsSig: weightsSignature(weights),
    };
    if (keptMeta.some((prev) => proposalsNearIdentical(meta, prev))) continue;
    kept.push(p);
    keptMeta.push(meta);
  }
  return kept;
}

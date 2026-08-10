import type { PortfolioCandidate, ProposalCard } from "@/lib/types";
import { resolveCandidateWeights } from "@/lib/candidate-weights";

const SHARPE_EPS = 5e-4;
const CAGR_EPS = 5e-5;
const MDD_EPS = 5e-5;
const WEIGHT_ROUND = 4;
const DEFAULT_MAX_PROPOSALS = 4;

type ProposalMeta = {
  sharpe: number;
  cagr: number;
  max_drawdown: number;
  needsScore: number;
  weightsSig: string | null;
};

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

function proposalsNearIdentical(a: ProposalMeta, b: ProposalMeta): boolean {
  // Exact holdings match → clone, regardless of headline metrics.
  if (a.weightsSig && b.weightsSig) {
    return a.weightsSig === b.weightsSig;
  }
  // Without both weight books, fall back to tight headline-metric equality.
  if (Math.abs(a.sharpe - b.sharpe) > SHARPE_EPS) return false;
  if (Math.abs(a.cagr - b.cagr) > CAGR_EPS) return false;
  if (Math.abs(a.max_drawdown - b.max_drawdown) > MDD_EPS) return false;
  return a.needsScore === b.needsScore;
}

function candidateByCode(
  candidates: PortfolioCandidate[] | null | undefined,
): Map<string, PortfolioCandidate> {
  const byCode = new Map<string, PortfolioCandidate>();
  for (const c of candidates ?? []) {
    const code = (c.model_code || "").toUpperCase();
    if (!code) continue;
    const prev = byCode.get(code);
    if (!prev || (c.is_champion && !prev.is_champion)) byCode.set(code, c);
  }
  return byCode;
}

function metaForProposal(
  p: ProposalCard,
  cand: PortfolioCandidate | undefined,
): ProposalMeta {
  const weights = cand ? resolveCandidateWeights(cand) : null;
  return {
    sharpe: p.sharpe,
    cagr: p.cagr,
    max_drawdown: p.max_drawdown,
    needsScore: needsScore(p.needs_attainment),
    weightsSig: weightsSignature(weights),
  };
}

function metaForCandidate(c: PortfolioCandidate): ProposalMeta {
  return {
    sharpe: c.sharpe,
    cagr: c.cagr,
    max_drawdown: c.max_drawdown,
    needsScore: needsScore(c.needs_attainment),
    weightsSig: weightsSignature(resolveCandidateWeights(c)),
  };
}

function cardFromCandidate(c: PortfolioCandidate, label: string): ProposalCard {
  return {
    model_code: c.model_code || "M?",
    label,
    is_recommended: false,
    sharpe: c.sharpe,
    cagr: c.cagr,
    max_drawdown: c.max_drawdown,
    objective_score: c.sharpe,
    needs_attainment: c.needs_attainment,
  };
}

/** Map raw/internal labels (alternative_2, ALTERNATIVE_2) to stable i18n keys. */
export function normalizeProposalLabel(label: string): string {
  const raw = (label || "").trim();
  const lower = raw.toLowerCase();
  if (
    lower === "recommended" ||
    lower === "defensive" ||
    lower === "growth" ||
    lower === "anchor_close" ||
    lower === "full_drift" ||
    lower === "theme"
  ) {
    return lower;
  }
  if (/^alternative([_\s-]?\d+)?$/i.test(raw)) return "alternative";
  return raw;
}

/**
 * Canonical primary recommendation for a job: search/AI champion when present
 * in the proposal cards; otherwise the card already marked is_recommended.
 * Exactly one card stays is_recommended / label "recommended".
 */
export function alignPrimaryRecommendation(
  proposals: ProposalCard[],
  candidates?: PortfolioCandidate[] | null,
): ProposalCard[] {
  if (!proposals.length) return [];

  const champCode =
    (candidates ?? [])
      .find((c) => c.is_champion)
      ?.model_code?.trim()
      .toUpperCase() ?? "";

  const recommendedCode = champCode
    ? proposals.some((p) => p.model_code.toUpperCase() === champCode)
      ? champCode
      : null
    : null;

  const fallbackRec =
    proposals.find((p) => p.is_recommended)?.model_code.toUpperCase() ??
    proposals[0]?.model_code.toUpperCase() ??
    null;

  const primary = recommendedCode ?? fallbackRec;
  if (!primary) return proposals.map((p) => ({
    ...p,
    label: normalizeProposalLabel(p.label),
  }));

  const usedRole = new Set<string>();
  return proposals.map((p) => {
    const isRec = p.model_code.toUpperCase() === primary;
    let label = normalizeProposalLabel(p.label);
    if (isRec) {
      label = "recommended";
    } else if (label === "recommended") {
      label = "alternative";
    } else if (label === "defensive" || label === "growth") {
      if (usedRole.has(label)) label = "alternative";
      else usedRole.add(label);
    } else if (
      label === "anchor_close" ||
      label === "full_drift" ||
      label === "theme"
    ) {
      if (usedRole.has(label)) label = "alternative";
      else usedRole.add(label);
    }
    return { ...p, is_recommended: isRec, label };
  });
}

/** Model code for all user-facing 建議/推薦/冠軍 labels on a job. */
export function resolvePrimaryRecommendationCode(
  proposals: ProposalCard[] | null | undefined,
  candidates?: PortfolioCandidate[] | null,
): string | null {
  const display = buildDisplayProposalSet(proposals, candidates);
  const rec = display.find((p) => p.is_recommended) ?? display[0];
  const code = rec?.model_code?.trim();
  return code ? code.toUpperCase() : null;
}

/**
 * Drop exact-weight clones (or metric clones when weights are missing).
 * Keeps recommended / earlier cards; never pads with clones.
 */
export function dedupeProposalSet(
  proposals: ProposalCard[] | null | undefined,
  candidates?: PortfolioCandidate[] | null,
): ProposalCard[] {
  if (!proposals?.length) return [];
  const byCode = candidateByCode(candidates);

  const ordered = [...proposals].sort((a, b) => {
    if (a.is_recommended !== b.is_recommended) return a.is_recommended ? -1 : 1;
    return 0;
  });

  const kept: ProposalCard[] = [];
  const keptMeta: ProposalMeta[] = [];

  for (const p of ordered) {
    const cand = byCode.get(p.model_code.toUpperCase());
    const meta = metaForProposal(p, cand);
    if (keptMeta.some((prev) => proposalsNearIdentical(meta, prev))) continue;
    kept.push(p);
    keptMeta.push(meta);
  }
  return kept;
}

/**
 * API proposal cards after dedupe, filled from weight-distinct candidates when
 * the Pareto set is thin so other trade-off portfolios still surface.
 * Always ends with exactly one is_recommended card (= search champion when present).
 */
export function buildDisplayProposalSet(
  proposals: ProposalCard[] | null | undefined,
  candidates?: PortfolioCandidate[] | null,
  maxN = DEFAULT_MAX_PROPOSALS,
): ProposalCard[] {
  const base = dedupeProposalSet(proposals, candidates);
  const limit = Math.max(1, maxN);
  let out = base;

  if (candidates?.length && base.length < limit) {
    const byCode = candidateByCode(candidates);
    const keptMeta = base.map((p) =>
      metaForProposal(p, byCode.get(p.model_code.toUpperCase())),
    );
    const usedCodes = new Set(base.map((p) => p.model_code.toUpperCase()));
    out = [...base];

    const sorted = [...candidates].sort((a, b) => {
      if (Boolean(a.is_champion) !== Boolean(b.is_champion)) {
        return a.is_champion ? -1 : 1;
      }
      const mdd = Math.abs(a.max_drawdown) - Math.abs(b.max_drawdown);
      if (mdd !== 0) return mdd;
      return b.sharpe - a.sharpe;
    });

    for (const c of sorted) {
      if (out.length >= limit) break;
      const code = (c.model_code || "").toUpperCase();
      if (!code || usedCodes.has(code)) continue;
      const meta = metaForCandidate(c);
      if (keptMeta.some((prev) => proposalsNearIdentical(meta, prev))) continue;
      usedCodes.add(code);
      keptMeta.push(meta);

      // Prefer scenario_style / defensive / growth labels when not already used.
      const labels = new Set(out.map((p) => normalizeProposalLabel(p.label)));
      const styleRaw = c.params?.scenario_style;
      const style =
        typeof styleRaw === "string" ? normalizeProposalLabel(styleRaw) : "";
      let label = "alternative";
      if (
        style &&
        (style === "anchor_close" ||
          style === "full_drift" ||
          style === "theme" ||
          style === "defensive") &&
        !labels.has(style)
      ) {
        label = style;
      } else {
        const isLowestMdd = sorted.every(
          (o) =>
            (o.model_code || "").toUpperCase() === code ||
            Math.abs(c.max_drawdown) <= Math.abs(o.max_drawdown),
        );
        const isHighestSharpe = sorted.every(
          (o) =>
            (o.model_code || "").toUpperCase() === code || c.sharpe >= o.sharpe,
        );
        if (!labels.has("defensive") && isLowestMdd) label = "defensive";
        else if (!labels.has("growth") && isHighestSharpe) label = "growth";
      }

      out.push(cardFromCandidate(c, label));
    }
  }

  out = ensureChampionInProposalSet(out, candidates, limit);
  return alignPrimaryRecommendation(out, candidates);
}

function ensureChampionInProposalSet(
  cards: ProposalCard[],
  candidates: PortfolioCandidate[] | null | undefined,
  limit: number,
): ProposalCard[] {
  const champ = (candidates ?? []).find((c) => c.is_champion && c.model_code);
  if (!champ?.model_code) return cards;
  const code = champ.model_code.toUpperCase();
  if (cards.some((p) => p.model_code.toUpperCase() === code)) return cards;
  const injected = cardFromCandidate(champ, "recommended");
  return [injected, ...cards.filter((p) => p.model_code.toUpperCase() !== code)].slice(
    0,
    limit,
  );
}

import { formatPctDecimal } from "./ai-metric-format";
import { candidateModelKey } from "./performance-compare-chart";

type HorizonSnap = {
  sharpe?: number;
  cagr?: number;
  max_drawdown?: number;
  objective_value?: number;
};

export type CompareCandidateLite = {
  model_code?: string;
  rank: number;
  sharpe?: number;
  cagr?: number;
  max_drawdown?: number;
  volatility?: number;
  turnover_avg?: number;
  beta?: number | null;
  alpha?: number | null;
  alpha_annual?: number | null;
  information_ratio?: number | null;
  train_sharpe?: number | null;
  validation_sharpe?: number | null;
  is_champion?: boolean;
  horizons?: {
    in_sample?: HorizonSnap;
    out_of_sample?: HorizonSnap | null;
    full_sample?: HorizonSnap;
    gap?: { sharpe?: number | null; objective?: number | null } | null;
  };
};

export type CompareSummaryPayload = {
  benchmark: string;
  objective?: string;
  objective_label?: string;
  champion_model_code?: string | null;
  candidates: CompareCandidateLite[];
  candidate_count_total?: number;
};

const SLIM_HORIZON_KEYS = [
  "sharpe",
  "cagr",
  "max_drawdown",
  "objective_value",
] as const;

function slimHorizon(h?: HorizonSnap): HorizonSnap | undefined {
  if (!h) return undefined;
  const out: HorizonSnap = {};
  for (const k of SLIM_HORIZON_KEYS) {
    if (h[k] != null) out[k] = h[k];
  }
  return Object.keys(out).length ? out : undefined;
}

function slimCandidate(c: CompareCandidateLite): CompareCandidateLite {
  const h = c.horizons;
  const horizons = h
    ? {
        in_sample: slimHorizon(h.in_sample),
        out_of_sample: slimHorizon(h.out_of_sample ?? undefined),
        full_sample: slimHorizon(h.full_sample),
        gap: h.gap,
      }
    : undefined;
  return {
    model_code: c.model_code,
    rank: c.rank,
    sharpe: c.sharpe,
    cagr: c.cagr,
    max_drawdown: c.max_drawdown,
    volatility: c.volatility,
    turnover_avg: c.turnover_avg,
    beta: c.beta,
    alpha: c.alpha ?? c.alpha_annual,
    information_ratio: c.information_ratio,
    validation_sharpe: c.validation_sharpe,
    is_champion: c.is_champion,
    horizons,
  };
}

/** Pro/final ★ champion for compare narrative (not objective rank 1). */
export function resolveCompareChampion(
  candidates: CompareCandidateLite[],
  championModelCode?: string | null,
): CompareCandidateLite | undefined {
  if (championModelCode) {
    const byCode = candidates.find(
      (c) => candidateModelKey(c) === championModelCode.trim(),
    );
    if (byCode) return byCode;
  }
  const flagged = candidates.find((c) => c.is_champion === true);
  if (flagged) return flagged;
  return candidates.find((c) => c.rank === 1) ?? candidates[0];
}

/** Cap prompt size for multi-trial runs; full count echoed for the model. */
export function slimComparePayload(
  payload: CompareSummaryPayload,
  maxCandidates = 10,
): CompareSummaryPayload {
  const sorted = [...payload.candidates].sort(
    (a, b) => (a.rank ?? 999) - (b.rank ?? 999),
  );
  const champ = resolveCompareChampion(
    sorted,
    payload.champion_model_code,
  );
  const champKey = champ ? candidateModelKey(champ) : null;
  const ordered = champKey
    ? [
        champ!,
        ...sorted.filter((c) => candidateModelKey(c) !== champKey),
      ]
    : sorted;
  return {
    benchmark: payload.benchmark,
    objective: payload.objective,
    objective_label: payload.objective_label,
    champion_model_code:
      payload.champion_model_code ??
      (champ?.model_code ? candidateModelKey(champ) : null),
    candidate_count_total: sorted.length,
    candidates: ordered.slice(0, maxCandidates).map(slimCandidate),
  };
}

/** Detect truncated Gemini metric bullet dumps (not narrative prose). */
export function looksLikeMetricDump(text: string): boolean {
  const lines = text.trim().split(/\n+/).filter((l) => l.trim());
  if (lines.length < 2) return false;
  const metricish = lines.filter(
    (l) =>
      /^M\d{3,5}\s+(Volatility|Sharpe|CAGR|Max DD|Turnover)/i.test(l.trim()) ||
      /^-\s*(Full sample|In-sample|Out-of-sample|Turnover)/i.test(l.trim()),
  ).length;
  if (metricish >= 2) return true;
  if (lines.length >= 4 && metricish / lines.length >= 0.35) return true;
  return /^of-sample\b/i.test(lines[0]?.trim() ?? "");
}

export function isAcceptableCompareSummary(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 100) return false;
  if (looksLikeMetricDump(t)) return false;
  const sentences = t.split(/[.!?]+/).filter((s) => s.trim().length > 24);
  return sentences.length >= 2;
}

function horizonLine(code: string, label: string, h?: HorizonSnap): string {
  if (!h) return "";
  return (
    `${code} ${label}: Sharpe ${h.sharpe ?? "—"}, CAGR ${formatPctDecimal(h.cagr)}, ` +
    `max DD ${formatPctDecimal(h.max_drawdown)}.`
  );
}

export function buildCompareFallback(payload: CompareSummaryPayload): string {
  const sorted = [...payload.candidates].sort(
    (a, b) => (a.rank ?? 999) - (b.rank ?? 999),
  );
  const champ = resolveCompareChampion(sorted, payload.champion_model_code);
  if (!champ) return "No models to compare.";
  const champCode = champ.model_code ?? "M?";
  const obj = payload.objective_label ?? payload.objective ?? "n/a";
  const total = payload.candidate_count_total ?? sorted.length;

  const p1 = [
    `Across ${total} models vs ${payload.benchmark} (${obj}), ${champCode} is the Pro champion (★) on the selection objective.`,
    `Selection view: CAGR ${formatPctDecimal(champ.cagr)}, Sharpe ${champ.sharpe ?? "—"}, ` +
      `max drawdown ${formatPctDecimal(champ.max_drawdown)}, turnover ${formatPctDecimal(champ.turnover_avg)}.`,
  ].join(" ");

  const full = champ.horizons?.full_sample;
  const oos = champ.horizons?.out_of_sample;
  const p2Parts: string[] = [];
  if (full) {
    p2Parts.push(horizonLine(champCode, "full sample", full));
  }
  if (oos && champ.validation_sharpe != null) {
    p2Parts.push(
      `Holdout validation Sharpe ${champ.validation_sharpe}; ` +
        horizonLine(champCode, "out-of-sample", oos),
    );
  }
  const peers = sorted.filter(
    (c) => candidateModelKey(c) !== candidateModelKey(champ),
  );
  const runner = peers[0];
  const p2 =
    p2Parts.length > 0
      ? p2Parts.join(" ")
      : runner
        ? `Next ranked ${runner.model_code ?? "M?"}: Sharpe ${runner.sharpe ?? "—"}, CAGR ${formatPctDecimal(runner.cagr)}.`
        : "";

  const others = peers.slice(0, 3);
  const p3 =
    others.length > 0
      ? `Peers to watch: ${others
          .map(
            (c) =>
              `${c.model_code ?? "M?"} (Sharpe ${c.sharpe ?? "—"}, CAGR ${formatPctDecimal(c.cagr)})`,
          )
          .join("; ")}.`
      : "";

  return [p1, p2, p3, "For research and education only — not investment advice."]
    .filter(Boolean)
    .join("\n\n");
}

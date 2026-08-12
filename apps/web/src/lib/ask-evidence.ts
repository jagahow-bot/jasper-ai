import type { OverlayAsk } from "@/lib/overlay-schema";
import type { Objective, PortfolioCandidate } from "@/lib/types";

export type AskEvidenceStatus = "met" | "partial" | "missed" | "unknown";

export type AskEvidenceRow = {
  ask: OverlayAsk;
  targetLabel: string;
  actualLabel: string;
  status: AskEvidenceStatus;
  actualPct?: number | null;
};

export type GroupTickerMap = Record<string, string[]>;

function pctLabel(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function bandLabel(ask: OverlayAsk): string {
  const lo = ask.min_pct;
  const hi = ask.max_pct;
  if (lo != null && hi != null) return `${pctLabel(lo, 0)}–${pctLabel(hi, 0)}`;
  if (lo != null) return `≥ ${pctLabel(lo, 0)}`;
  if (hi != null) return `≤ ${pctLabel(hi, 0)}`;
  if (ask.target_pct != null) return `~ ${pctLabel(ask.target_pct, 0)}`;
  return "—";
}

function weightOf(
  weights: Record<string, number> | null | undefined,
  ticker: string,
): number {
  if (!weights) return 0;
  const key = ticker.toUpperCase();
  for (const [t, w] of Object.entries(weights)) {
    if (t.toUpperCase() === key) return Number(w) || 0;
  }
  return 0;
}

function sumGroupWeight(
  weights: Record<string, number> | null | undefined,
  tickers: string[],
): number {
  return tickers.reduce((sum, t) => sum + weightOf(weights, t), 0);
}

function cashWeight(
  weights: Record<string, number> | null | undefined,
  needs?: PortfolioCandidate["needs_attainment"],
): number {
  if (needs?.cash_weight_actual != null && Number.isFinite(needs.cash_weight_actual)) {
    return Number(needs.cash_weight_actual);
  }
  return weightOf(weights, "CASH");
}

function resolveGroupTickers(
  ask: OverlayAsk,
  groups?: GroupTickerMap | null,
): string[] {
  if (ask.tickers?.length) return ask.tickers.map((t) => t.toUpperCase());
  if (ask.group_id && groups?.[ask.group_id]) {
    return groups[ask.group_id].map((t) => t.toUpperCase());
  }
  // Heuristic aliases used in demo books / briefs.
  if (ask.group_id && groups) {
    const needle = ask.group_id.toLowerCase();
    for (const [id, tickers] of Object.entries(groups)) {
      if (
        id.toLowerCase() === needle ||
        (needle.includes("tech") && id.toLowerCase().includes("tech")) ||
        (needle.includes("satellite") && id.toLowerCase().includes("satellite")) ||
        (needle.includes("ai") && id.toLowerCase().includes("tech"))
      ) {
        return tickers.map((t) => t.toUpperCase());
      }
    }
  }
  return [];
}

function statusForBand(
  actual: number,
  minPct?: number | null,
  maxPct?: number | null,
  targetPct?: number | null,
  slack = 0.02,
): AskEvidenceStatus {
  const lo = minPct ?? (targetPct != null ? targetPct - slack : null);
  const hi = maxPct ?? (targetPct != null ? targetPct + slack : null);
  if (lo == null && hi == null) return "unknown";
  const within =
    (lo == null || actual + 1e-9 >= lo) && (hi == null || actual - 1e-9 <= hi);
  if (within) return "met";
  const nearLo = lo != null && actual >= lo - slack && actual < lo;
  const nearHi = hi != null && actual <= hi + slack && actual > hi;
  if (nearLo || nearHi) return "partial";
  return "missed";
}

/** Format a human target string for one ask card. */
export function formatAskTarget(ask: OverlayAsk): string {
  switch (ask.kind) {
    case "group_weight_band":
      return bandLabel(ask);
    case "ticker_max": {
      const t = ask.tickers?.[0] ?? "ticker";
      return ask.max_pct != null ? `${t} ≤ ${pctLabel(ask.max_pct, 0)}` : `${t} trim`;
    }
    case "ticker_min": {
      const list = (ask.tickers ?? []).join("/");
      return ask.min_pct != null
        ? `${list || "tickers"} ≥ ${pctLabel(ask.min_pct, 0)}`
        : `${list || "tickers"} present`;
    }
    case "exclude_ticker":
      return `Exclude ${(ask.tickers ?? []).join(", ") || "—"}`;
    case "objective":
      return ask.objective ? `Objective: ${ask.objective}` : "Objective set";
    case "cash_reserve": {
      const cash = ask.cash_reserve_pct ?? ask.target_pct ?? ask.min_pct;
      return cash != null ? `Cash ~ ${pctLabel(cash, 0)}` : "Cash buffer";
    }
    default:
      return ask.summary.slice(0, 80);
  }
}

/**
 * Evaluate signed soft asks against optimized weights (honest miss is OK).
 */
export function evaluateAskEvidence(
  asks: OverlayAsk[] | null | undefined,
  opts: {
    weights?: Record<string, number> | null;
    needs?: PortfolioCandidate["needs_attainment"];
    objective?: Objective | string | null;
    groupTickers?: GroupTickerMap | null;
  },
): AskEvidenceRow[] {
  if (!asks?.length) return [];
  const { weights, needs, objective, groupTickers } = opts;

  return asks.map((ask) => {
    switch (ask.kind) {
      case "group_weight_band": {
        const tickers = resolveGroupTickers(ask, groupTickers);
        const actual = tickers.length ? sumGroupWeight(weights, tickers) : null;
        const status =
          actual == null
            ? "unknown"
            : statusForBand(actual, ask.min_pct, ask.max_pct, ask.target_pct);
        return {
          ask,
          targetLabel: formatAskTarget(ask),
          actualLabel: actual == null ? "—" : pctLabel(actual),
          status,
          actualPct: actual,
        };
      }
      case "ticker_max": {
        const ticker = ask.tickers?.[0];
        const actual = ticker ? weightOf(weights, ticker) : null;
        let status: AskEvidenceStatus = "unknown";
        if (actual != null && ask.max_pct != null) {
          if (actual <= ask.max_pct + 1e-9) status = "met";
          else if (actual <= ask.max_pct + 0.03) status = "partial";
          else status = "missed";
        }
        return {
          ask,
          targetLabel: formatAskTarget(ask),
          actualLabel:
            ticker == null || actual == null
              ? "—"
              : `${ticker} ${pctLabel(actual)}`,
          status,
          actualPct: actual,
        };
      }
      case "ticker_min": {
        const tickers = ask.tickers ?? [];
        const present = tickers.filter((t) => weightOf(weights, t) > 0.001);
        const weightsSum = sumGroupWeight(weights, tickers);
        let status: AskEvidenceStatus = "unknown";
        if (!tickers.length) status = "unknown";
        else if (ask.min_pct != null) {
          status = statusForBand(weightsSum, ask.min_pct, null, ask.min_pct);
        } else if (present.length === tickers.length) status = "met";
        else if (present.length > 0) status = "partial";
        else status = "missed";
        const detail = tickers
          .map((t) => `${t} ${pctLabel(weightOf(weights, t))}`)
          .join(", ");
        return {
          ask,
          targetLabel: formatAskTarget(ask),
          actualLabel: detail || "—",
          status,
          actualPct: weightsSum,
        };
      }
      case "exclude_ticker": {
        const tickers = ask.tickers ?? [];
        const stillIn = tickers.filter((t) => weightOf(weights, t) > 0.005);
        const status: AskEvidenceStatus = !tickers.length
          ? "unknown"
          : stillIn.length === 0
            ? "met"
            : stillIn.length < tickers.length
              ? "partial"
              : "missed";
        return {
          ask,
          targetLabel: formatAskTarget(ask),
          actualLabel:
            stillIn.length === 0
              ? "Not held"
              : `Still held: ${stillIn.join(", ")}`,
          status,
        };
      }
      case "objective": {
        const wanted = ask.objective;
        const actual = objective ? String(objective) : null;
        const status: AskEvidenceStatus =
          !wanted || !actual
            ? "unknown"
            : actual === wanted
              ? "met"
              : "missed";
        return {
          ask,
          targetLabel: formatAskTarget(ask),
          actualLabel: actual ?? "—",
          status,
        };
      }
      case "cash_reserve": {
        const target = ask.cash_reserve_pct ?? ask.target_pct ?? ask.min_pct ?? null;
        const actual = cashWeight(weights, needs);
        const status =
          target == null
            ? "unknown"
            : statusForBand(actual, target * 0.7, target * 1.4, target, 0.015);
        return {
          ask,
          targetLabel: formatAskTarget(ask),
          actualLabel: pctLabel(actual),
          status,
          actualPct: actual,
        };
      }
      default:
        return {
          ask,
          targetLabel: formatAskTarget(ask),
          actualLabel: "See holdings / narrative",
          status: "unknown",
        };
    }
  });
}

/** Build group_id → ticker[] from client holdings groups. */
export function groupTickerMapFromHoldingsGroups(
  groups:
    | Array<{ id: string; holdings?: Array<{ ticker: string }> }>
    | null
    | undefined,
): GroupTickerMap {
  const out: GroupTickerMap = {};
  for (const g of groups ?? []) {
    if (!g?.id) continue;
    out[g.id] = (g.holdings ?? [])
      .map((h) => String(h.ticker || "").toUpperCase())
      .filter(Boolean);
  }
  return out;
}

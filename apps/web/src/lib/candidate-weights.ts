/** Latest rebalance weights from weight_history (as-of end of report window). */

const META_KEYS = new Set(["date", "OTHER", "other", "__OTHER__"]);

/** Chart / packaging bucket for truncated or sub-threshold mass. */
export const WEIGHT_REMAINDER_TICKER = "OTHER";

function asFiniteWeight(raw: unknown): number | null {
  const w = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(w) ? w : null;
}

/** Hamilton / largest-remainder percents so displayed rows sum exactly to target. */
export function largestRemainderPercents(
  weights: Record<string, number>,
  decimals = 2,
  targetPct?: number,
): Record<string, number> {
  const entries = Object.entries(weights)
    .map(([ticker, w]) => [ticker, Number(w)] as const)
    .filter(([, w]) => Number.isFinite(w) && w > 0);
  if (entries.length === 0) return {};
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const sum = entries.reduce((s, [, w]) => s + w, 0);
  let target =
    targetPct ??
    (sum >= 1 - 5e-4 ? 100 : Math.round(sum * 100 * 10 ** decimals) / 10 ** decimals);
  if (targetPct == null && Math.abs(sum - 1) <= 5e-4) target = 100;
  const scale = 10 ** decimals;
  const exact = entries.map(([, w]) => (w / sum) * target * scale);
  const floors = exact.map((x) => Math.floor(x + 1e-9));
  const targetUnits = Math.round(target * scale);
  let need = targetUnits - floors.reduce((a, b) => a + b, 0);
  const order = [...floors.keys()].sort(
    (i, j) =>
      exact[j] - floors[j] - (exact[i] - floors[i]) ||
      entries[j][1] - entries[i][1] ||
      entries[i][0].localeCompare(entries[j][0]),
  );
  const units = [...floors];
  if (need > 0) {
    for (let k = 0; k < need; k += 1) units[order[k % order.length]] += 1;
  } else if (need < 0) {
    const trim = [...floors.keys()].sort(
      (i, j) =>
        exact[i] - floors[i] - (exact[j] - floors[j]) ||
        entries[i][1] - entries[j][1] ||
        entries[i][0].localeCompare(entries[j][0]),
    );
    for (const i of trim) {
      if (need >= 0) break;
      if (units[i] > 0) {
        units[i] -= 1;
        need += 1;
      }
    }
  }
  const out: Record<string, number> = {};
  for (let i = 0; i < entries.length; i += 1) {
    if (units[i] > 0) out[entries[i][0]] = units[i] / scale;
  }
  return out;
}

/**
 * Build table rows from raw weights: keep names ≥ minWeight, fold the rest
 * (and meaningful cash gap to 1.0) into OTHER/CASH, then assign display
 * percents that sum to 100.00 when the book is fully invested.
 */
export function buildAllocationRows(
  weights: Record<string, number> | null | undefined,
  minWeight = 0.001,
): Array<{ ticker: string; weight: number; pct: number; isRemainder: boolean }> {
  const raw = weights ?? {};
  const kept: Record<string, number> = {};
  let tiny = 0;
  for (const [ticker, rawW] of Object.entries(raw)) {
    const w = asFiniteWeight(rawW);
    if (w == null || w <= 0) continue;
    const key = ticker.toUpperCase();
    if (key === "CASH") {
      kept.CASH = (kept.CASH ?? 0) + w;
      continue;
    }
    if (key === WEIGHT_REMAINDER_TICKER || META_KEYS.has(ticker)) {
      tiny += w;
      continue;
    }
    if (w >= minWeight) kept[key] = w;
    else tiny += w;
  }
  const keptSum = Object.values(kept).reduce((s, w) => s + w, 0);
  // Packaging round(w, 4) dust (~0.01%) should not become its own row.
  const cashGap = Math.max(0, 1 - keptSum - tiny);
  const meaningfulCashGap = cashGap > 5e-4;
  const remainderMass = tiny + (meaningfulCashGap ? cashGap : 0);
  if (remainderMass > 1e-9) {
    if (kept.CASH != null || meaningfulCashGap) {
      kept.CASH = (kept.CASH ?? 0) + remainderMass;
    } else {
      kept[WEIGHT_REMAINDER_TICKER] =
        (kept[WEIGHT_REMAINDER_TICKER] ?? 0) + remainderMass;
    }
  }

  const pcts = largestRemainderPercents(kept, 2);
  return Object.entries(kept)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([ticker, weight]) => ({
      ticker,
      weight,
      pct: pcts[ticker] ?? 0,
      isRemainder: ticker === WEIGHT_REMAINDER_TICKER || ticker === "CASH",
    }));
}

/** Latest rebalance weights from weight_history (as-of end of report window). */
export function weightsFromLatestHistory(
  history: Array<{ date?: string } & Record<string, unknown>> | null | undefined,
  minWeight = 0.001,
): Record<string, number> | null {
  if (!Array.isArray(history) || history.length === 0) return null;
  const last = history[history.length - 1];
  if (!last || typeof last !== "object") return null;
  const out: Record<string, number> = {};
  let residual = 0;
  for (const [key, raw] of Object.entries(last)) {
    if (key === "date") continue;
    const w = asFiniteWeight(raw);
    if (w == null || w <= 0) continue;
    if (META_KEYS.has(key)) {
      residual += w;
      continue;
    }
    if (w < minWeight) {
      residual += w;
      continue;
    }
    out[key.toUpperCase()] = w;
  }
  if (residual > 0) {
    out[WEIGHT_REMAINDER_TICKER] = (out[WEIGHT_REMAINDER_TICKER] ?? 0) + residual;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Prefer terminal weight_history; fall back to packaged candidate.weights. */
export function resolveCandidateWeights(
  candidate:
    | {
        weights?: Record<string, number> | null;
        analytics?: {
          weight_history?: Array<{ date?: string } & Record<string, unknown>> | null;
        } | null;
      }
    | null
    | undefined,
  minWeight = 0.001,
): Record<string, number> {
  const fromHist = weightsFromLatestHistory(candidate?.analytics?.weight_history, minWeight);
  if (fromHist) return fromHist;
  const raw = candidate?.weights ?? {};
  const out: Record<string, number> = {};
  let residual = 0;
  for (const [t, rawW] of Object.entries(raw)) {
    const w = asFiniteWeight(rawW);
    if (w == null || w <= 0) continue;
    const key = t.toUpperCase();
    if (key === WEIGHT_REMAINDER_TICKER) {
      residual += w;
      continue;
    }
    if (w >= minWeight) out[key] = w;
    else residual += w;
  }
  if (residual > 0) {
    out[WEIGHT_REMAINDER_TICKER] = (out[WEIGHT_REMAINDER_TICKER] ?? 0) + residual;
  }
  return out;
}

/** Format portfolio weight as percent with 2 decimals (avoids fake "20.0%" clarity). */
export function formatWeightPct(pct: number): string {
  return `${pct.toFixed(2)}%`;
}

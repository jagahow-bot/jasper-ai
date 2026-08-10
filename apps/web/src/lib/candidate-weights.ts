/** Latest rebalance weights from weight_history (as-of end of report window). */

const META_KEYS = new Set(["date", "OTHER", "other", "__OTHER__"]);

/** Chart / packaging bucket for truncated mass — never invent as a holdings ticker. */
export const WEIGHT_REMAINDER_TICKER = "OTHER";

/** Drop only numerical dust; keep every real named holding for RM tables. */
export const HOLDINGS_WEIGHT_EPS = 1e-6;

/** Chart-truncation OTHER above this means the history row is incomplete. */
const CHART_OTHER_INCOMPLETE = 1e-3;

function asFiniteWeight(raw: unknown): number | null {
  const w = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(w) ? w : null;
}

function isMetaKey(key: string): boolean {
  return META_KEYS.has(key) || key.toUpperCase() === WEIGHT_REMAINDER_TICKER;
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
 * Build table rows from raw weights: keep every named holding, optionally keep
 * an engine CASH sleeve, then assign display percents that sum to 100.00 when
 * the book is fully invested. Never invent an OTHER ticker row.
 */
export function buildAllocationRows(
  weights: Record<string, number> | null | undefined,
  minWeight = HOLDINGS_WEIGHT_EPS,
): Array<{ ticker: string; weight: number; pct: number; isRemainder: boolean }> {
  const raw = weights ?? {};
  const kept: Record<string, number> = {};
  for (const [ticker, rawW] of Object.entries(raw)) {
    const w = asFiniteWeight(rawW);
    if (w == null || w < minWeight) continue;
    if (isMetaKey(ticker)) continue;
    const key = ticker.toUpperCase();
    kept[key] = (kept[key] ?? 0) + w;
  }

  const pcts = largestRemainderPercents(kept, 2);
  return Object.entries(kept)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([ticker, weight]) => ({
      ticker,
      weight,
      pct: pcts[ticker] ?? 0,
      isRemainder: ticker === "CASH",
    }));
}

/**
 * Terminal weight_history row as named holdings.
 * Returns null when chart OTHER mass is large (truncated ticker set) so callers
 * can fall back to packaged last_weights.
 */
export function weightsFromLatestHistory(
  history: Array<{ date?: string } & Record<string, unknown>> | null | undefined,
  minWeight = HOLDINGS_WEIGHT_EPS,
): Record<string, number> | null {
  if (!Array.isArray(history) || history.length === 0) return null;
  const last = history[history.length - 1];
  if (!last || typeof last !== "object") return null;
  const out: Record<string, number> = {};
  let chartOther = 0;
  for (const [key, raw] of Object.entries(last)) {
    if (key === "date") continue;
    const w = asFiniteWeight(raw);
    if (w == null || w <= 0) continue;
    if (isMetaKey(key)) {
      chartOther += w;
      continue;
    }
    if (w < minWeight) continue;
    out[key.toUpperCase()] = w;
  }
  // Large OTHER = truncated chart payload; do not invent a fake ticker.
  if (chartOther > CHART_OTHER_INCOMPLETE) return null;
  return Object.keys(out).length > 0 ? out : null;
}

function weightsFromPackaged(
  raw: Record<string, number> | null | undefined,
  minWeight: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [t, rawW] of Object.entries(raw ?? {})) {
    const w = asFiniteWeight(rawW);
    if (w == null || w < minWeight) continue;
    if (isMetaKey(t)) continue;
    out[t.toUpperCase()] = w;
  }
  return out;
}

/** Prefer complete terminal weight_history; fall back to packaged candidate.weights. */
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
  minWeight = HOLDINGS_WEIGHT_EPS,
): Record<string, number> {
  const fromHist = weightsFromLatestHistory(candidate?.analytics?.weight_history, minWeight);
  if (fromHist) {
    const riskySum = Object.entries(fromHist)
      .filter(([k]) => k !== "CASH")
      .reduce((s, [, w]) => s + w, 0);
    // Truncated schedule rows dump unnamed mass into CASH; prefer packaged book.
    if (riskySum >= 0.99 - 5e-4) return fromHist;
  }
  return weightsFromPackaged(candidate?.weights, minWeight);
}

/** Format portfolio weight as percent with 2 decimals (avoids fake "20.0%" clarity). */
export function formatWeightPct(pct: number): string {
  return `${pct.toFixed(2)}%`;
}

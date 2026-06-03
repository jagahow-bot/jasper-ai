import type {
  BenchmarkSeriesPoint,
  DynamicObjectiveTimelinePoint,
  ObjectiveSwitchLabResult,
  RegimeScoreTimelinePoint,
} from "@/lib/types";

/** Shared sync + layout for Objective Switch Lab benchmark + score charts. */
export const LAB_CHART_SYNC_ID = "objectiveSwitchLab";
/** Backtest report: dynamic objective timeline + optional regime strip. */
export const DYNAMIC_OBJECTIVE_CHART_SYNC_ID = "dynamicObjectiveBacktest";
export const LAB_CHART_MARGIN = { top: 8, right: 8, left: 0, bottom: 0 };
export const LAB_Y_AXIS_WIDTH = 44;

/** Parse YYYY-MM-DD to UTC noon ms for stable axis positioning. */
export function parseDateTs(date: string): number {
  return new Date(`${date}T12:00:00Z`).getTime();
}

export function formatAxisDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Shared x-domain from benchmark path and walk-forward regime steps. */
export function computeSharedDateDomain(
  benchmarkSeries: BenchmarkSeriesPoint[],
  regimeTimeline: ObjectiveSwitchLabResult["regime_timeline"],
  scoreTimeline?: RegimeScoreTimelinePoint[],
): { min: number; max: number } | null {
  const stamps: number[] = [];
  for (const p of benchmarkSeries) {
    const t = parseDateTs(p.date);
    if (!Number.isNaN(t)) stamps.push(t);
  }
  for (const row of regimeTimeline) {
    const t = parseDateTs(row.date);
    if (!Number.isNaN(t)) stamps.push(t);
  }
  for (const row of scoreTimeline ?? []) {
    const t = parseDateTs(row.date);
    if (!Number.isNaN(t)) stamps.push(t);
  }
  if (!stamps.length) return null;
  return { min: Math.min(...stamps), max: Math.max(...stamps) };
}

export function labXAxisProps(domainMin: number, domainMax: number) {
  return {
    type: "number" as const,
    dataKey: "ts" as const,
    domain: [domainMin, domainMax] as [number, number],
    scale: "time" as const,
    tick: { fontSize: 9, fill: "var(--dim)" },
    minTickGap: 40,
    tickFormatter: (ts: number) => formatAxisDate(ts),
  };
}

/** Active regime label at a calendar timestamp (walk-forward steps). */
export function activeRegimeAtTs(
  ts: number,
  timeline: ObjectiveSwitchLabResult["regime_timeline"],
): string | null {
  if (!timeline.length || Number.isNaN(ts)) return null;
  let active: string | null = null;
  for (const row of timeline) {
    const rowTs = parseDateTs(row.date);
    if (Number.isNaN(rowTs) || rowTs > ts) break;
    active = row.active_regime ?? row.regime;
  }
  return active;
}

export type RegimeBandRange = { startTs: number; endTs: number; regime: string };

export function regimeBandRanges(
  timeline: ObjectiveSwitchLabResult["regime_timeline"],
  domainMax: number,
  regimeKey: "active_regime" | "raw_regime" = "active_regime",
): RegimeBandRange[] {
  if (!timeline.length) return [];
  const bands: RegimeBandRange[] = [];
  for (let i = 0; i < timeline.length; i++) {
    const row = timeline[i];
    const regime =
      regimeKey === "raw_regime"
        ? row.raw_regime ?? row.regime
        : row.active_regime ?? row.regime;
    const startTs = parseDateTs(timeline[i].date);
    const endTs =
      i + 1 < timeline.length ? parseDateTs(timeline[i + 1].date) : domainMax;
    bands.push({ startTs, endTs, regime });
  }
  return bands;
}

/** Map a timestamp into [0, 1] on the shared domain (for layout checks). */
export function dateRatio(ts: number, min: number, max: number): number {
  if (max <= min) return 0;
  return (ts - min) / (max - min);
}

export const OBJECTIVE_BAND_COLORS: Record<string, string> = {
  max_sharpe: "rgba(96, 165, 250, 0.16)",
  max_return: "rgba(52, 211, 153, 0.16)",
  min_max_drawdown: "rgba(248, 113, 113, 0.16)",
};

export const OBJECTIVE_STRIP_COLORS: Record<string, string> = {
  max_sharpe: "rgba(96, 165, 250, 0.55)",
  max_return: "rgba(52, 211, 153, 0.55)",
  min_max_drawdown: "rgba(248, 113, 113, 0.55)",
};

export const OBJECTIVE_DISPLAY_LABELS: Record<string, string> = {
  max_sharpe: "Max Sharpe",
  max_return: "Max Return",
  min_max_drawdown: "Min Max Drawdown",
};

export type ObjectiveBandRange = { startTs: number; endTs: number; objective: string };

/** Effective allocator objective at a calendar timestamp (walk-forward steps). */
export function activeObjectiveAtTs(
  ts: number,
  timeline: DynamicObjectiveTimelinePoint[],
): string | null {
  if (!timeline.length || Number.isNaN(ts)) return null;
  let active: string | null = null;
  for (const row of timeline) {
    const rowTs = parseDateTs(row.date);
    if (Number.isNaN(rowTs) || rowTs > ts) break;
    active = row.objective;
  }
  return active;
}

export function objectiveBandRanges(
  timeline: DynamicObjectiveTimelinePoint[],
  domainMax: number,
): ObjectiveBandRange[] {
  if (!timeline.length) return [];
  const bands: ObjectiveBandRange[] = [];
  for (let i = 0; i < timeline.length; i++) {
    const startTs = parseDateTs(timeline[i].date);
    const endTs =
      i + 1 < timeline.length ? parseDateTs(timeline[i + 1].date) : domainMax;
    bands.push({ startTs, endTs, objective: timeline[i].objective });
  }
  return bands;
}

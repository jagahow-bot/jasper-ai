import type {
  BenchmarkSeriesPoint,
  DynamicObjectiveTimelinePoint,
  ObjectiveSwitchLabResult,
  RegimeScoreTimelinePoint,
} from "@/lib/types";

/** Shared sync + layout for Objective Switch Lab benchmark + score charts. */
export const LAB_CHART_SYNC_ID = "objectiveSwitchLab";
/** Results dashboard: equity performance + dynamic objective timeline (linked hover). */
export const JASPER_PERFORMANCE_SYNC_ID = "jasperPerformance";
/** @deprecated Use JASPER_PERFORMANCE_SYNC_ID */
export const DYNAMIC_OBJECTIVE_CHART_SYNC_ID = JASPER_PERFORMANCE_SYNC_ID;

export const JASPER_PERFORMANCE_CHART_SYNC = {
  syncId: JASPER_PERFORMANCE_SYNC_ID,
  syncMethod: "value" as const,
};
export const LAB_CHART_MARGIN = { top: 8, right: 8, left: 0, bottom: 0 };
export const LAB_Y_AXIS_WIDTH = 44;

/** Parse YYYY-MM-DD to UTC noon ms for stable axis positioning. */
export function parseDateTs(date: string): number {
  return new Date(`${date}T12:00:00Z`).getTime();
}

export function formatAxisDate(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/** Recharts tooltip/x labels: numeric ms timestamps → YYYY-MM-DD. */
export function formatChartTooltipLabel(label: unknown): string {
  const ts = Number(label);
  if (Number.isFinite(ts) && ts > 1e11) return formatAxisDate(ts);
  const s = String(label ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s || "—";
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

/** Neon-tinted objective bands (main chart background). */
export const OBJECTIVE_BAND_COLORS: Record<string, string> = {
  max_sharpe: "rgba(0, 245, 255, 0.32)",
  max_return: "rgba(57, 255, 20, 0.32)",
  min_max_drawdown: "rgba(255, 43, 214, 0.32)",
};

export const OBJECTIVE_STRIP_COLORS: Record<string, string> = {
  max_sharpe: "rgba(0, 245, 255, 0.85)",
  max_return: "rgba(57, 255, 20, 0.85)",
  min_max_drawdown: "rgba(255, 43, 214, 0.85)",
};

export const OBJECTIVE_DISPLAY_LABELS: Record<string, string> = {
  max_sharpe: "Max Sharpe",
  max_return: "Max Return",
  min_max_drawdown: "Min Max Drawdown",
};

export const OBJECTIVE_DISPLAY_LABELS_ZH: Record<string, string> = {
  max_sharpe: "最大夏普",
  max_return: "最大報酬",
  min_max_drawdown: "最小最大回撤",
};

export const REGIME_BAND_COLORS: Record<string, string> = {
  risk_off: "rgba(255, 80, 80, 0.14)",
  neutral: "rgba(255, 176, 0, 0.1)",
  risk_on: "rgba(0, 220, 180, 0.12)",
};

export const REGIME_STRIP_COLORS: Record<string, string> = {
  risk_off: "rgba(255, 80, 80, 0.55)",
  neutral: "rgba(255, 176, 0, 0.55)",
  risk_on: "rgba(0, 220, 180, 0.55)",
};

export const REGIME_DISPLAY_LABELS: Record<string, string> = {
  risk_off: "Risk-off",
  neutral: "Neutral",
  risk_on: "Risk-on",
};

export const REGIME_DISPLAY_LABELS_ZH: Record<string, string> = {
  risk_off: "風險趨避",
  neutral: "中性",
  risk_on: "風險偏好",
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

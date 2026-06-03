import type { BenchmarkSeriesPoint, ObjectiveSwitchLabResult } from "@/lib/types";

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
  if (!stamps.length) return null;
  return { min: Math.min(...stamps), max: Math.max(...stamps) };
}

export type RegimeBandRange = { startTs: number; endTs: number; regime: string };

export function regimeBandRanges(
  timeline: ObjectiveSwitchLabResult["regime_timeline"],
  domainMax: number,
): RegimeBandRange[] {
  if (!timeline.length) return [];
  const bands: RegimeBandRange[] = [];
  for (let i = 0; i < timeline.length; i++) {
    const regime = timeline[i].active_regime ?? timeline[i].regime;
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

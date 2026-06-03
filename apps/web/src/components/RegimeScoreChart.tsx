"use client";

import {
  computeSharedDateDomain,
  formatAxisDate,
  LAB_CHART_MARGIN,
  LAB_CHART_SYNC_ID,
  LAB_Y_AXIS_WIDTH,
  labXAxisProps,
  parseDateTs,
} from "@/lib/benchmark-chart-scale";
import type {
  BenchmarkSeriesPoint,
  ObjectiveSwitchLabResult,
  RegimeScoreTimelinePoint,
} from "@/lib/types";
import type { TooltipProps } from "recharts";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const SCORE_CHART_HEIGHT = 180;
const CHART_SYNC = { syncId: LAB_CHART_SYNC_ID, syncMethod: "value" as const };

type Props = {
  scoreTimeline: RegimeScoreTimelinePoint[];
  benchmarkSeries?: BenchmarkSeriesPoint[];
  regimeTimeline?: ObjectiveSwitchLabResult["regime_timeline"];
};

function RegimeScoreTooltip({
  active,
  payload,
  label,
}: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;
  const ts = Number(label);
  if (!Number.isFinite(ts)) return null;
  const row = payload[0]?.payload as
    | { active?: string; raw?: string; scoreWinner?: string }
    | undefined;
  const activeRegime = row?.active ?? null;
  const rawRegime = row?.raw ?? null;
  const scoreWinner = row?.scoreWinner ?? null;

  return (
    <div
      className="rounded border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-[11px]"
      style={{ fontSize: 11 }}
    >
      <p className="text-[var(--foreground)]">Date: {formatAxisDate(ts)}</p>
      {payload
        .filter((p) => p.dataKey !== "switched")
        .map((p) => (
          <p key={String(p.dataKey)} className="text-dim">
            {p.name ?? p.dataKey}:{" "}
            {typeof p.value === "number" ? p.value.toFixed(3) : "—"}
          </p>
        ))}
      {scoreWinner && (
        <p className="text-dim">Score winner at step: {scoreWinner}</p>
      )}
      {rawRegime && (
        <p className="text-dim">Raw regime (arbitration): {rawRegime}</p>
      )}
      {activeRegime && (
        <p className="text-dim">Active regime (hysteresis): {activeRegime}</p>
      )}
    </div>
  );
}

export function RegimeScoreChart({
  scoreTimeline,
  benchmarkSeries = [],
  regimeTimeline = [],
}: Props) {
  if (!scoreTimeline.length) {
    return (
      <p className="text-xs text-dim">
        No regime scores (use detector V2 or run a longer in-sample window).
      </p>
    );
  }

  const domain = computeSharedDateDomain(
    benchmarkSeries,
    regimeTimeline,
    scoreTimeline,
  );
  if (!domain) {
    return <p className="text-xs text-dim">No valid dates for score chart.</p>;
  }

  const { min: domainMin, max: domainMax } = domain;
  const data = scoreTimeline.map((row) => ({
    ts: parseDateTs(row.date),
    risk_off: row.risk_off_score ?? null,
    risk_on: row.risk_on_score ?? null,
    neutral: row.neutral_score ?? null,
    active: row.active_regime,
    raw: row.raw_regime ?? null,
    scoreWinner: row.score_winner ?? null,
    switched: row.switched,
  }));
  const xAxis = labXAxisProps(domainMin, domainMax);

  return (
    <div className="space-y-2">
      <ResponsiveContainer width="100%" height={SCORE_CHART_HEIGHT}>
        <LineChart {...CHART_SYNC} data={data} margin={LAB_CHART_MARGIN}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis {...xAxis} />
          <YAxis
            domain={[0, 1]}
            tick={{ fontSize: 9, fill: "var(--dim)" }}
            width={LAB_Y_AXIS_WIDTH}
            tickFormatter={(v) => Number(v).toFixed(1)}
          />
          <Tooltip content={<RegimeScoreTooltip />} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Line
            type="monotone"
            dataKey="risk_off"
            name="Risk-off score"
            stroke="#ff5050"
            dot={false}
            strokeWidth={1.5}
          />
          <Line
            type="monotone"
            dataKey="risk_on"
            name="Risk-on score"
            stroke="#00dcb4"
            dot={false}
            strokeWidth={1.5}
          />
          <Line
            type="monotone"
            dataKey="neutral"
            name="Neutral (implied)"
            stroke="#ffb000"
            dot={false}
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-dim">
        63d indicator scores at each walk-forward step (lines). Tooltip: score winner (margin
        arbitration), raw regime, and active regime after hysteresis. Hover syncs with the
        benchmark chart above.
      </p>
    </div>
  );
}

"use client";

import {
  activeObjectiveAtTs,
  computeSharedDateDomain,
  formatAxisDate,
  JASPER_PERFORMANCE_CHART_SYNC,
  LAB_CHART_MARGIN,
  LAB_Y_AXIS_WIDTH,
  labXAxisProps,
  OBJECTIVE_BAND_COLORS,
  OBJECTIVE_STRIP_COLORS,
  objectiveBandRanges,
  parseDateTs,
} from "@/lib/benchmark-chart-scale";
import { objectiveBandLabel, useI18n } from "@/lib/i18n";
import type {
  BenchmarkSeriesPoint,
  DynamicObjectiveTimelinePoint,
} from "@/lib/types";
import type { RechartsTooltipContentProps } from "@/components/ChartTooltip";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const MAIN_CHART_HEIGHT = 220;
const OBJECTIVE_STRIP_HEIGHT = 24;

type Props = {
  benchmarkSeries: BenchmarkSeriesPoint[];
  timeline: DynamicObjectiveTimelinePoint[];
  benchmarkTicker: string;
};

function DynamicObjectiveTooltip({
  active,
  payload,
  label,
  timeline,
}: RechartsTooltipContentProps & { timeline: DynamicObjectiveTimelinePoint[] }) {
  const { t } = useI18n();
  if (!active || !payload?.length) return null;
  const ts = Number(label);
  if (!Number.isFinite(ts)) return null;
  const value = payload[0]?.value;
  const objective = activeObjectiveAtTs(ts, timeline);

  return (
    <div
      className="rounded border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-[11px]"
      style={{ fontSize: 11 }}
    >
      <p className="text-[var(--foreground)]">{t("common.date")}: {formatAxisDate(ts)}</p>
      {objective && (
        <p className="text-dim">
          {t("common.objective")}: {objectiveBandLabel(t, objective)}
        </p>
      )}
      <p className="text-dim">
        {t("common.return")}: {typeof value === "number" ? `${value.toFixed(2)}%` : "—"}
      </p>
    </div>
  );
}

export function DynamicObjectiveTimelineChart({
  benchmarkSeries,
  timeline,
  benchmarkTicker,
}: Props) {
  const { t } = useI18n();
  if (!benchmarkSeries.length) {
    return <p className="text-xs text-dim">{t("dynamicObjective.noSeries")}</p>;
  }

  const domain = computeSharedDateDomain(benchmarkSeries, timeline);
  if (!domain) {
    return <p className="text-xs text-dim">{t("dynamicObjective.noValidDates")}</p>;
  }

  const { min: domainMin, max: domainMax } = domain;
  const objectiveBands = objectiveBandRanges(timeline, domainMax);
  const chartData = benchmarkSeries.map((p) => ({
    ...p,
    ts: parseDateTs(p.date),
  }));
  const stripAnchor = [
    { ts: domainMin, v: 0 },
    { ts: domainMax, v: 1 },
  ];
  const xAxis = labXAxisProps(domainMin, domainMax);
  const objectivesInRun = [
    ...new Set(timeline.map((r) => r.objective).filter(Boolean)),
  ];

  return (
    <div className="space-y-1">
      <ResponsiveContainer width="100%" height={MAIN_CHART_HEIGHT}>
        <LineChart
          {...JASPER_PERFORMANCE_CHART_SYNC}
          data={chartData}
          margin={LAB_CHART_MARGIN}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis {...xAxis} />
          <YAxis
            tick={{ fontSize: 9, fill: "var(--dim)" }}
            width={LAB_Y_AXIS_WIDTH}
            tickFormatter={(v) => `${Number(v).toFixed(0)}%`}
          />
          {objectiveBands.map((b) => (
            <ReferenceArea
              key={`${b.startTs}-${b.objective}`}
              x1={b.startTs}
              x2={b.endTs}
              fill={OBJECTIVE_BAND_COLORS[b.objective] ?? "transparent"}
              strokeOpacity={0}
              ifOverflow="hidden"
            />
          ))}
          <Tooltip content={<DynamicObjectiveTooltip timeline={timeline} />} />
          <Line
            type="monotone"
            dataKey="cumulative_return_pct"
            stroke="var(--cyan)"
            dot={false}
            strokeWidth={1.5}
            name={t("dynamicObjective.cumPct", { ticker: benchmarkTicker })}
          />
        </LineChart>
      </ResponsiveContainer>

      {timeline.length > 0 && (
        <ResponsiveContainer width="100%" height={OBJECTIVE_STRIP_HEIGHT}>
          <LineChart
            {...JASPER_PERFORMANCE_CHART_SYNC}
            data={stripAnchor}
            margin={LAB_CHART_MARGIN}
          >
            <XAxis {...xAxis} hide />
            <YAxis hide domain={[0, 1]} width={LAB_Y_AXIS_WIDTH} />
            {objectiveBands.map((b, i) => {
              const row = timeline[i];
              const fill = row.switched
                ? "var(--amber)"
                : OBJECTIVE_STRIP_COLORS[b.objective] ?? "var(--border)";
              return (
                <ReferenceArea
                  key={`obj-${row.date}`}
                  x1={b.startTs}
                  x2={b.endTs}
                  y1={0}
                  y2={1}
                  fill={fill}
                  strokeOpacity={0}
                  ifOverflow="hidden"
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      )}

      <div className="flex flex-wrap gap-3 text-[10px] text-dim">
        {objectivesInRun.map((obj) => (
          <span key={obj} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2 w-3 rounded-sm border border-[var(--border)]"
              style={{
                backgroundColor:
                  OBJECTIVE_BAND_COLORS[obj] ?? "var(--border)",
              }}
            />
            {objectiveBandLabel(t, obj)}
          </span>
        ))}
      </div>
      <p className="text-[10px] text-dim">
        {t("dynamicObjective.footer", { ticker: benchmarkTicker })}
      </p>
    </div>
  );
}

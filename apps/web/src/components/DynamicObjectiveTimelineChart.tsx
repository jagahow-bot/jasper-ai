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
  OBJECTIVE_DISPLAY_LABELS_ZH,
  OBJECTIVE_STRIP_COLORS,
  objectiveBandRanges,
  parseDateTs,
} from "@/lib/benchmark-chart-scale";
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
      <p className="text-[var(--foreground)]">日期：{formatAxisDate(ts)}</p>
      {objective && (
        <p className="text-dim">
          目標：{OBJECTIVE_DISPLAY_LABELS_ZH[objective] ?? objective}
        </p>
      )}
      <p className="text-dim">
        報酬率：{typeof value === "number" ? `${value.toFixed(2)}%` : "—"}
      </p>
    </div>
  );
}

export function DynamicObjectiveTimelineChart({
  benchmarkSeries,
  timeline,
  benchmarkTicker,
}: Props) {
  if (!benchmarkSeries.length) {
    return <p className="text-xs text-dim">尚無基準序列可繪圖。</p>;
  }

  const domain = computeSharedDateDomain(benchmarkSeries, timeline);
  if (!domain) {
    return <p className="text-xs text-dim">無有效日期可繪圖。</p>;
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
            name={`${benchmarkTicker} 累積 %`}
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
            {OBJECTIVE_DISPLAY_LABELS_ZH[obj] ?? obj}
          </span>
        ))}
      </div>
      <p className="text-[10px] text-dim">
        上：{benchmarkTicker} 累積報酬（%），背景色為各 walk-forward 步驟的作用中目標。下：目標色帶（琥珀色＝切換）。與上方績效圖連動游標。
      </p>
    </div>
  );
}

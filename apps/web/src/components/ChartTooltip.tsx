"use client";

import {
  chartTooltipFontSize,
  formatChartTooltipLabel,
} from "@/lib/benchmark-chart-scale";
import type { TooltipProps } from "recharts";

type Row = {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
};

type Props = TooltipProps<number, string> & {
  active?: boolean;
  payload?: Row[];
  label?: string | number;
  /** Multiply numeric values by 100 and append % */
  valueIsPct?: boolean;
  valueDecimals?: number;
  title?: string;
};

export function ChartTooltip({
  active,
  payload,
  label,
  valueIsPct = false,
  valueDecimals = 2,
  title,
}: Props) {
  if (!active || !payload?.length) return null;

  const rows = payload as Row[];
  const heading =
    title ?? (label != null ? formatChartTooltipLabel(label) : undefined);

  const fmt = (v: unknown) => {
    if (v == null || v === "") return "—";
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    if (valueIsPct) return `${(n * 100).toFixed(valueDecimals)}%`;
    return n.toFixed(valueDecimals);
  };

  const tipPx = chartTooltipFontSize();

  return (
    <div
      className="border-2 border-[var(--neon)] bg-[#050508] px-3 py-2 shadow-pixel min-w-[140px]"
      style={{ fontSize: tipPx }}
    >
      {heading && (
        <div
          className="mb-2 border-b border-[var(--border)] pb-1 font-pixel text-[var(--amber)]"
          style={{ fontSize: Math.max(11, tipPx - 1) }}
        >
          {heading}
        </div>
      )}
      <ul className="space-y-1 font-terminal" style={{ fontSize: tipPx }}>
        {rows.map((row, i) => (
          <li key={`${row.dataKey ?? i}`} className="flex justify-between gap-4">
            <span className="text-dim" style={{ color: row.color }}>
              {row.name ?? row.dataKey}
            </span>
            <span className="font-semibold text-neon">{fmt(row.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

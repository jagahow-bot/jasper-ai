"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
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
  /** Sort rows by numeric value descending (weights tooltips). */
  sortByValue?: boolean;
  /** Render in document.body to avoid chart overflow clipping. */
  usePortal?: boolean;
};

function rowNumericValue(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : -Infinity;
}

function sortPayloadRows(rows: Row[], sortByValue: boolean): Row[] {
  if (!sortByValue) return rows;
  return [...rows].sort(
    (a, b) => rowNumericValue(b.value) - rowNumericValue(a.value),
  );
}

export function ChartTooltip({
  active,
  payload,
  label,
  coordinate,
  valueIsPct = false,
  valueDecimals = 2,
  title,
  sortByValue = false,
  usePortal = true,
}: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const rows = useMemo(
    () => sortPayloadRows((payload ?? []) as Row[], sortByValue),
    [payload, sortByValue],
  );

  if (!active || !rows.length) return null;

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
  const offset = 12;
  const left =
    coordinate?.x != null ? coordinate.x + offset : undefined;
  const top =
    coordinate?.y != null ? coordinate.y + offset : undefined;

  const panel = (
    <div
      className="pointer-events-auto border-2 border-[var(--neon)] bg-[#050508] px-3 py-2 shadow-pixel min-w-[140px] max-w-[min(92vw,22rem)] max-h-[min(70vh,28rem)] overflow-y-auto overflow-x-hidden"
      style={{
        fontSize: tipPx,
        zIndex: 10050,
        ...(usePortal && left != null && top != null
          ? { position: "fixed" as const, left, top }
          : undefined),
      }}
    >
      {heading && (
        <div
          className="sticky top-0 z-[1] mb-2 border-b border-[var(--border)] bg-[#050508] pb-1 font-pixel text-[var(--amber)]"
          style={{ fontSize: Math.max(11, tipPx - 1) }}
        >
          {heading}
        </div>
      )}
      <ul className="space-y-1 font-terminal" style={{ fontSize: tipPx }}>
        {rows.map((row, i) => (
          <li key={`${row.dataKey ?? i}`} className="flex justify-between gap-4">
            <span className="text-dim shrink-0" style={{ color: row.color }}>
              {row.name ?? row.dataKey}
            </span>
            <span className="font-semibold text-neon tabular-nums">
              {fmt(row.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  if (usePortal && mounted && typeof document !== "undefined") {
    return createPortal(panel, document.body);
  }
  return panel;
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  chartTooltipFontSize,
  formatChartTooltipLabel,
} from "@/lib/benchmark-chart-scale";
export type ChartTooltipRow = {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  payload?: unknown;
};

/** Recharts v3 omits payload/label/coordinate on TooltipProps — declare them for custom content. */
export type RechartsTooltipContentProps = {
  active?: boolean;
  payload?: ChartTooltipRow[];
  label?: string | number;
  coordinate?: { x?: number; y?: number };
};

type Props = RechartsTooltipContentProps & {
  /** Multiply numeric values by 100 and append % */
  valueIsPct?: boolean;
  valueDecimals?: number;
  /** Appended after formatted number when not using valueIsPct (e.g. "%" for already-% values). */
  valueSuffix?: string;
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

function sortPayloadRows(rows: ChartTooltipRow[], sortByValue: boolean): ChartTooltipRow[] {
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
  valueSuffix = "",
  title,
  sortByValue = false,
  usePortal = false,
}: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const rows = useMemo(
    () => sortPayloadRows(payload ?? [], sortByValue),
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
    return `${n.toFixed(valueDecimals)}${valueSuffix}`;
  };

  const tipPx = chartTooltipFontSize();
  const offset = 12;
  const left =
    coordinate?.x != null ? coordinate.x + offset : undefined;
  const top =
    coordinate?.y != null ? coordinate.y + offset : undefined;

  const panel = (
    <div
      className="pointer-events-auto min-w-[140px] max-w-[min(92vw,22rem)] max-h-[min(70vh,28rem)] overflow-y-auto overflow-x-hidden rounded-lg border border-[var(--border)] bg-white px-3 py-2 shadow-md"
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
          className="sticky top-0 z-[1] mb-2 border-b border-[var(--border)] bg-white pb-1 text-xs font-semibold text-[var(--amber)]"
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
            <span className="font-semibold tabular-nums text-[var(--primary)]">
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

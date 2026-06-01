"use client";

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
  const heading = title ?? (label != null ? String(label) : undefined);

  const fmt = (v: unknown) => {
    if (v == null || v === "") return "—";
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    if (valueIsPct) return `${(n * 100).toFixed(valueDecimals)}%`;
    return n.toFixed(valueDecimals);
  };

  return (
    <div className="border-2 border-[var(--neon)] bg-[#050508] px-3 py-2 text-xs shadow-pixel min-w-[140px]">
      {heading && (
        <div className="mb-2 border-b border-[var(--border)] pb-1 font-pixel text-[8px] text-[var(--amber)]">
          {heading}
        </div>
      )}
      <ul className="space-y-1 font-terminal text-sm">
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

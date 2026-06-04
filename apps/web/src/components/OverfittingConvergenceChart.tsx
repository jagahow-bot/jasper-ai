"use client";

import { ChartTooltip } from "@/components/ChartTooltip";
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

export type ConvergencePoint = {
  trial?: number;
  round: number;
  is_objective?: number;
  oos_objective?: number | null;
  gap_objective?: number;
  overfitting_penalty?: number;
  overfitting_risk?: string;
  is_champion?: boolean;
  objective_label?: string;
  /** @deprecated legacy preview fields */
  adjusted_score?: number;
  raw_score?: number;
  train_sharpe?: number;
  validation_sharpe?: number | null;
  gap_sharpe?: number;
};

type ChartRow = {
  trial_index: number;
  round: number;
  is_objective: number;
  oos_objective: number | null;
  gap_objective: number;
  is_champion?: boolean;
};

type Props = {
  data?: ConvergencePoint[];
  history?: ConvergencePoint[];
  title?: string;
  objectiveLabel?: string;
};

function normalizePoints(raw: ConvergencePoint[]): ChartRow[] {
  return raw.map((p, idx) => {
    const isObj =
      p.is_objective ??
      p.adjusted_score ??
      p.raw_score ??
      p.train_sharpe ??
      0;
    const oosObj = p.oos_objective ?? p.validation_sharpe ?? null;
    const gap =
      p.gap_objective ??
      (p.gap_sharpe != null ? p.gap_sharpe : isObj - Number(oosObj ?? isObj));
    const trialFromApi =
      typeof p.trial === "number" && Number.isFinite(p.trial) && p.trial >= 0
        ? Math.round(p.trial)
        : null;
    return {
      trial_index: trialFromApi ?? idx + 1,
      round: p.round,
      is_objective: isObj,
      oos_objective: oosObj,
      gap_objective: gap,
      is_champion: p.is_champion,
    };
  });
}

/** Recharts x-axis must be a strict 1..N trial sequence (not model codes / round ids). */
function withSequentialTrialIndex(rows: ChartRow[]): ChartRow[] {
  const keys = rows.map((r) => `${r.round}:${r.trial_index}`);
  const uniqueCount = new Set(keys).size;
  if (uniqueCount === rows.length) return rows;
  return rows.map((row, idx) => ({ ...row, trial_index: idx + 1 }));
}

export function OverfittingConvergenceChart({
  data,
  history,
  title = "Pro convergence · in-sample vs holdout",
  objectiveLabel = "Objective",
}: Props) {
  const raw = data ?? history ?? [];
  const points = withSequentialTrialIndex(normalizePoints(raw));
  if (!points.length) {
    return (
      <p className="text-sm text-dim">No convergence history (use Pro + holdout split).</p>
    );
  }

  const lastSource = raw[raw.length - 1];
  const riskLabel =
    lastSource?.overfitting_risk === "low"
      ? "LOW"
      : lastSource?.overfitting_risk === "medium" ||
          lastSource?.overfitting_risk === "moderate"
        ? "MED"
        : lastSource?.overfitting_risk === "high"
          ? "HIGH"
          : "N/A";
  const label = lastSource?.objective_label ?? objectiveLabel;
  const last = points[points.length - 1];
  const gap =
    last.gap_objective ??
    (last.is_objective != null && last.oos_objective != null
      ? last.is_objective - Number(last.oos_objective)
      : 0);

  return (
    <div className="space-y-2">
      <h4 className="font-pixel text-[8px] text-dim">{title}</h4>
      <p className="font-terminal text-sm text-[var(--amber)]">
        {label} · IS {Number(last.is_objective ?? 0).toFixed(4)}
        {last.oos_objective != null ? ` · OOS ${Number(last.oos_objective).toFixed(4)}` : ""}
        {" · "}gap {gap.toFixed(4)} · risk {riskLabel}
      </p>
      <div className="h-56 w-full border-2 border-[var(--border)] bg-[#050508] p-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points}>
            <CartesianGrid stroke="#1a3d1a" strokeDasharray="4 4" />
            <XAxis
              dataKey="trial_index"
              type="number"
              domain={["dataMin", "dataMax"]}
              allowDecimals={false}
              stroke="#5a7a5a"
              tick={{ fontSize: 11 }}
              label={{
                value: "Trial #",
                position: "insideBottom",
                offset: -4,
                fill: "#5a7a5a",
                fontSize: 10,
              }}
            />
            <YAxis stroke="#5a7a5a" tick={{ fontSize: 11 }} />
            <Tooltip
              content={<ChartTooltip valueDecimals={4} />}
              labelFormatter={(_, payload) => {
                const row = payload?.[0]?.payload as ChartRow | undefined;
                if (!row) return "";
                return `Trial ${row.trial_index} · Round ${row.round}`;
              }}
              shared={false}
              isAnimationActive={false}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Line
              type="monotone"
              dataKey="is_objective"
              name={`In-sample ${label}`}
              stroke="#39ff14"
              dot={false}
              activeDot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="oos_objective"
              name={`Holdout ${label} (not for selection)`}
              stroke="#ffb000"
              dot={false}
              activeDot={false}
              strokeWidth={2}
              strokeDasharray="6 4"
              connectNulls
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="gap_objective"
              name="IS − OOS gap"
              stroke="#ff2bd6"
              dot={false}
              activeDot={false}
              strokeWidth={1}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs text-dim">
        X-axis = global trial index (1…N). Green = in-sample objective used for selection. Amber
        dashed = holdout tail (diagnostic). Pink = IS − OOS gap.
      </p>
    </div>
  );
}

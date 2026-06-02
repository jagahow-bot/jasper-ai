"use client";

import type { RegimeScoreTimelinePoint } from "@/lib/types";
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

type Props = {
  scoreTimeline: RegimeScoreTimelinePoint[];
};

export function RegimeScoreChart({ scoreTimeline }: Props) {
  if (!scoreTimeline.length) {
    return (
      <p className="text-xs text-dim">
        No regime scores (use detector V2 or run a longer in-sample window).
      </p>
    );
  }

  const data = scoreTimeline.map((row) => ({
    date: row.date,
    risk_off: row.risk_off_score ?? null,
    risk_on: row.risk_on_score ?? null,
    neutral: row.neutral_score ?? null,
    active: row.active_regime,
    switched: row.switched,
  }));

  return (
    <div className="space-y-2">
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="date" tick={{ fontSize: 9, fill: "var(--dim)" }} minTickGap={40} />
          <YAxis
            domain={[0, 1]}
            tick={{ fontSize: 9, fill: "var(--dim)" }}
            width={32}
            tickFormatter={(v) => Number(v).toFixed(1)}
          />
          <Tooltip
            contentStyle={{
              background: "var(--panel)",
              border: "1px solid var(--border)",
              fontSize: 11,
            }}
            formatter={(value: number, name: string) => [
              value != null ? value.toFixed(3) : "—",
              name,
            ]}
          />
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
        Walk-forward scores before arbitration and cooldown. Active regime in the table below
        may differ when both scores are below confidence or during confirmation.
      </p>
    </div>
  );
}

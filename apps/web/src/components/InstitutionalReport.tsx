"use client";

import { ChartTooltip } from "@/components/ChartTooltip";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PortfolioCandidate } from "@/lib/types";

export function InstitutionalReport({
  candidate,
  benchmark = "SPY",
}: {
  candidate: PortfolioCandidate;
  benchmark?: string;
}) {
  const a = candidate.analytics;
  if (!a) {
    return (
      <p className="text-sm text-dim">No institutional analytics (rerun backtest).</p>
    );
  }

  const rel = a.benchmark_relative ?? {};
  const periodic = a.periodic_returns ?? { monthly: [], annual: [] };
  const periodicHoldout = a.periodic_returns_holdout;
  const sampleMetrics = a.sample_metrics;
  const periodicInSample =
    a.periodic_returns_scope === "in_sample" ||
    sampleMetrics?.selection === "in_sample";
  const trainStart = sampleMetrics?.train_start;
  const trainEnd = sampleMetrics?.train_end;
  const valStart = sampleMetrics?.val_start;
  const isRange =
    trainStart && trainEnd
      ? ` ${trainStart} → ${trainEnd}`
      : trainEnd
        ? ` through ${trainEnd}`
        : "";
  const monthlyTitle = periodicInSample
    ? `Monthly returns (in-sample${isRange})`
    : "Monthly returns";
  const annualTitle = periodicInSample
    ? `Annual returns (in-sample${isRange})`
    : "Annual returns";
  const holdoutMonthlyTitle = valStart
    ? `Monthly returns (holdout from ${valStart})`
    : "Monthly returns (holdout)";
  const holdoutAnnualTitle = valStart
    ? `Annual returns (holdout from ${valStart})`
    : "Annual returns (holdout)";
  const rolling = a.rolling ?? { rolling_sharpe: [], rolling_vol: [] };
  const exposure = a.exposure ?? {};
  const rc = a.risk_contribution ?? [];
  const ddEps = a.drawdown_episodes ?? [];
  const ddSeries = a.drawdown_series ?? [];
  const execution = (a as { execution?: Record<string, unknown> }).execution ?? {};
  const horizonIs = sampleMetrics?.in_sample;
  const horizonOos = sampleMetrics?.out_of_sample;
  const horizonFull = sampleMetrics?.full_sample;
  const horizonGap = sampleMetrics?.gap;
  const hasHorizonTable =
    horizonIs != null || horizonOos != null || horizonFull != null;

  return (
    <div className="space-y-5">
      {hasHorizonTable && (
        <Section title="Performance by horizon (IS · OOS · full)">
          <p className="mb-3 text-xs text-dim">
            Trial selection uses in-sample when holdout is on. IS and OOS rows are slices of
            the same continuous full backtest (ttl); they are not separate fresh-start runs.
            Ranked train/holdout Sharpe on the dashboard may differ slightly from these rows.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-dim">
                <tr>
                  <th className="pb-2">Horizon</th>
                  <th className="pb-2 text-right">Sharpe</th>
                  <th className="pb-2 text-right">CAGR</th>
                  <th className="pb-2 text-right">Max DD</th>
                  <th className="pb-2 text-right">Objective</th>
                </tr>
              </thead>
              <tbody>
                {horizonIs != null && (
                  <HorizonRow label="In-sample" snap={horizonIs} />
                )}
                {horizonOos != null && (
                  <HorizonRow label="Out-of-sample" snap={horizonOos} />
                )}
                {horizonFull != null && (
                  <HorizonRow label="Full sample (ttl)" snap={horizonFull} />
                )}
              </tbody>
            </table>
          </div>
          {horizonGap != null &&
            (horizonGap.sharpe != null || horizonGap.objective != null) && (
              <p className="mt-2 text-xs text-dim">
                IS−OOS gap: objective {horizonGap.objective ?? "—"}, Sharpe{" "}
                {horizonGap.sharpe ?? "—"} (positive = in-sample stronger).
              </p>
            )}
        </Section>
      )}

      {execution.rebalance_freq != null && (
        <Section title="Rebalance execution">
          <p className="text-sm">
            Freq <span className="text-neon">{String(execution.rebalance_freq)}</span>
            {" · "}
            Count <span className="text-neon">{String(execution.rebalance_count)}</span>
          </p>
          {Array.isArray(execution.rebalance_dates_sample) &&
            (execution.rebalance_dates_sample as string[]).length > 0 && (
              <p className="mt-2 text-xs text-dim">
                Sample dates: {(execution.rebalance_dates_sample as string[]).join(", ")}
                {(execution.rebalance_dates_sample as string[]).length >= 12 ? " …" : ""}
              </p>
            )}
        </Section>
      )}

      <Section title={`vs ${benchmark}`}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Beta" value={rel.beta ?? candidate.beta} />
          <Kpi label="Alpha" value={rel.alpha ?? rel.alpha_annual ?? candidate.alpha ?? candidate.alpha_annual} />
          <Kpi label="Tracking err" value={rel.tracking_error ?? candidate.tracking_error} />
          <Kpi label="IR" value={rel.information_ratio ?? candidate.information_ratio} />
          <Kpi label="Up capture" value={rel.up_capture} />
          <Kpi label="Down capture" value={rel.down_capture} />
        </div>
      </Section>

      <Section title="Exposure">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="border-2 border-[var(--border)] bg-[#050508] p-3 text-sm">
            <div className="mb-2 text-dim">Asset class</div>
            {Object.entries(exposure.by_asset_class ?? {}).map(([k, v]) => (
              <div key={k} className="flex justify-between border-t border-[var(--border)] py-1">
                <span>{k}</span>
                <span className="text-neon">{(Number(v) * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
          <div className="border-2 border-[var(--border)] bg-[#050508] p-3 text-sm">
            <div className="mb-2 text-dim">Buckets (region)</div>
            {Object.entries(exposure.by_asset_bucket ?? {}).slice(0, 10).map(([k, v]) => (
              <div key={k} className="flex justify-between border-t border-[var(--border)] py-1">
                <span>{k}</span>
                <span className="text-[var(--cyan)]">{(Number(v) * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
          <div className="space-y-2 border-2 border-[var(--border)] bg-[#050508] p-3 text-sm">
            <Row label="Equity" value={exposure.equity_pct} />
            <Row label="Bond" value={exposure.bond_pct} />
            <Row label="Other" value={exposure.other_pct} />
            <Row label="Duration proxy (y)" value={exposure.duration_proxy_years} pct={false} />
          </div>
        </div>
      </Section>

      <Section title="Risk contribution (top)">
        <div className="max-h-56 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-dim">
              <tr>
                <th className="pb-2">Ticker</th>
                <th className="pb-2 text-right">Wt</th>
                <th className="pb-2 text-right">Risk %</th>
              </tr>
            </thead>
            <tbody>
              {rc.slice(0, 15).map((row) => (
                <tr key={row.ticker} className="border-t border-[var(--border)]">
                  <td className="py-1">{row.ticker}</td>
                  <td className="py-1 text-right">{(row.weight * 100).toFixed(2)}%</td>
                  <td className="py-1 text-right text-[var(--cyan)]">
                    {(row.risk_contrib * 100).toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Rolling Sharpe (252D)">
          <MiniLine data={rolling.rolling_sharpe ?? []} color="#00f5ff" />
        </Section>
        <Section title="Rolling vol (252D)">
          <MiniLine data={rolling.rolling_vol ?? []} color="#ff2bd6" pct />
        </Section>
      </div>

      <Section title="Drawdown curve">
        <MiniLine data={ddSeries} color="#f87171" pct />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={monthlyTitle}>
          {periodicInSample && (
            <p className="mb-2 text-xs text-dim">
              Selection and ranking use in-sample only; periods below exclude the holdout
              tail.
            </p>
          )}
          <ReturnTable rows={periodic.monthly ?? []} />
        </Section>
        <Section title={annualTitle}>
          <ReturnTable rows={periodic.annual ?? []} />
        </Section>
      </div>

      {periodicHoldout &&
        ((periodicHoldout.monthly?.length ?? 0) > 0 ||
          (periodicHoldout.annual?.length ?? 0) > 0) && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Section title={holdoutMonthlyTitle}>
              <ReturnTable rows={periodicHoldout.monthly ?? []} />
            </Section>
            <Section title={holdoutAnnualTitle}>
              <ReturnTable rows={periodicHoldout.annual ?? []} />
            </Section>
          </div>
        )}

      <Section title="Drawdown episodes">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-dim">
              <tr>
                <th className="pb-2">Start</th>
                <th className="pb-2">Trough</th>
                <th className="pb-2">End</th>
                <th className="pb-2 text-right">Depth</th>
                <th className="pb-2 text-right">Days</th>
              </tr>
            </thead>
            <tbody>
              {ddEps.map((ep, i) => (
                <tr key={i} className="border-t border-[var(--border)]">
                  <td className="py-1">{ep.start}</td>
                  <td className="py-1">{ep.trough}</td>
                  <td className="py-1">{ep.end}</td>
                  <td className="py-1 text-right text-[var(--magenta)]">
                    {(Number(ep.depth) * 100).toFixed(2)}%
                  </td>
                  <td className="py-1 text-right text-dim">{ep.days}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function HorizonRow({
  label,
  snap,
}: {
  label: string;
  snap: {
    sharpe?: number;
    cagr?: number;
    max_drawdown?: number;
    objective_value?: number;
  };
}) {
  return (
    <tr className="border-t border-[var(--border)]">
      <td className="py-1.5">{label}</td>
      <td className="py-1.5 text-right">{snap.sharpe?.toFixed(3) ?? "—"}</td>
      <td className="py-1.5 text-right">
        {snap.cagr != null ? `${(snap.cagr * 100).toFixed(2)}%` : "—"}
      </td>
      <td className="py-1.5 text-right text-[var(--magenta)]">
        {snap.max_drawdown != null
          ? `${(snap.max_drawdown * 100).toFixed(2)}%`
          : "—"}
      </td>
      <td className="py-1.5 text-right text-dim">
        {snap.objective_value?.toFixed(4) ?? "—"}
      </td>
    </tr>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pixel-panel">
      <h4 className="mb-3 font-pixel text-[8px] text-[var(--cyan)]">{title}</h4>
      {children}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value?: number | null }) {
  const v = value == null ? "—" : typeof value === "number" ? value.toFixed(3) : String(value);
  return (
    <div className="border-2 border-[var(--border)] bg-[#050508] p-2 text-center">
      <div className="text-xs text-dim">{label}</div>
      <div className="font-terminal text-lg text-neon">{v}</div>
    </div>
  );
}

function Row({
  label,
  value,
  pct = true,
}: {
  label: string;
  value?: number;
  pct?: boolean;
}) {
  const v =
    value == null ? "—" : pct ? `${(value * 100).toFixed(1)}%` : String(value);
  return (
    <div className="flex justify-between">
      <span className="text-dim">{label}</span>
      <span>{v}</span>
    </div>
  );
}

function MiniLine({
  data,
  color,
  pct = false,
}: {
  data: { date: string; value: number }[];
  color: string;
  pct?: boolean;
}) {
  if (!data.length) {
    return <p className="text-xs text-dim">Insufficient data</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data}>
        <CartesianGrid stroke="#1a3d1a" strokeDasharray="4 4" />
        <XAxis
          dataKey="date"
          stroke="#5a7a5a"
          fontSize={11}
          minTickGap={24}
          tickFormatter={(v) => String(v).slice(2)}
        />
        <YAxis
          stroke="#5a7a5a"
          fontSize={11}
          width={40}
          tickFormatter={(v) => (pct ? `${(Number(v) * 100).toFixed(0)}%` : String(v))}
        />
        <Tooltip
          content={<ChartTooltip valueIsPct={pct} valueDecimals={pct ? 2 : 3} />}
          labelFormatter={(label) => `date ${String(label)}`}
        />
        <Line type="monotone" dataKey="value" stroke={color} dot={false} strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function ReturnTable({ rows }: { rows: { period: string; return: number }[] }) {
  if (!rows.length) {
    return <p className="text-xs text-dim">No data</p>;
  }
  return (
    <div className="max-h-48 overflow-y-auto text-sm">
      <table className="w-full">
        <thead className="text-dim">
          <tr>
            <th className="pb-2 text-left">Period</th>
            <th className="pb-2 text-right">Return</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.period} className="border-t border-[var(--border)]">
              <td className="py-1">{r.period}</td>
              <td
                className={`py-1 text-right ${
                  r.return >= 0 ? "text-neon" : "text-[var(--magenta)]"
                }`}
              >
                {(r.return * 100).toFixed(2)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

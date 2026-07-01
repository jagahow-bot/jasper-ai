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
import { useI18n } from "@/lib/i18n";
import { chartTickFontSize } from "@/lib/benchmark-chart-scale";
import type { PortfolioCandidate } from "@/lib/types";

export function InstitutionalReport({
  candidate,
  benchmark = "SPY",
  analyticsNote,
  isLoadingAnalytics = false,
  loadingModelCode,
}: {
  candidate: PortfolioCandidate;
  benchmark?: string;
  analyticsNote?: string;
  isLoadingAnalytics?: boolean;
  loadingModelCode?: string;
}) {
  const { t } = useI18n();
  const a = candidate.analytics;
  const loadingSuffix = loadingModelCode
    ? ` ${t("institutional.loadingFor", { model: loadingModelCode })}`
    : "";
  if (!a) {
    if (isLoadingAnalytics) {
      return (
        <div className="space-y-5">
          <LoadingPlaceholder label={`${t("institutional.loadingAnalytics")}${loadingSuffix}`} />
        </div>
      );
    }
    return (
      <p className="ui-body text-dim">{t("institutional.noAnalytics")}</p>
    );
  }

  const rel = a.benchmark_relative ?? {};
  const periodic = a.periodic_returns ?? { monthly: [], annual: [] };
  const periodicHoldout = a.periodic_returns_holdout;
  const sampleMetrics = a.sample_metrics;
  // Full-period returns: merge the primary (in-sample or full-sample) series with
  // any out-of-sample holdout tail so we present a single continuous period.
  const fullMonthly = mergePeriodicReturns(periodic.monthly, periodicHoldout?.monthly);
  const fullAnnual = mergePeriodicReturns(periodic.annual, periodicHoldout?.annual);
  const rolling = a.rolling ?? { rolling_sharpe: [], rolling_vol: [] };
  const exposure = a.exposure ?? {};
  const rc = a.risk_contribution ?? [];
  const holdingStats = computeHoldingStats(
    a.weight_history ?? [],
    a.weight_history_tickers ?? [],
  );
  const ddEps = a.drawdown_episodes ?? [];
  const ddSeries = a.drawdown_series ?? [];
  const execution = (a as { execution?: Record<string, unknown> }).execution ?? {};
  const horizonIs = sampleMetrics?.in_sample;
  const horizonOos = sampleMetrics?.out_of_sample;
  const horizonFull = sampleMetrics?.full_sample;
  const horizonGap = sampleMetrics?.gap;
  const hasHorizonTable =
    horizonIs != null || horizonOos != null || horizonFull != null;
  const exposureEmpty =
    Object.keys(exposure.by_asset_class ?? {}).length === 0 &&
    Object.keys(exposure.by_asset_bucket ?? {}).length === 0 &&
    exposure.equity_pct == null &&
    exposure.bond_pct == null;

  return (
    <div className="space-y-5">
      {isLoadingAnalytics ? (
        <LoadingPlaceholder label={`${t("institutional.loadingAnalytics")}${loadingSuffix}`} />
      ) : null}
      {analyticsNote ? (
        <p className="ui-hint">{analyticsNote}</p>
      ) : null}
      {hasHorizonTable && (
        <Section title={t("institutional.horizonTitle")}>
          <p className="ui-hint mb-3">{t("institutional.horizonNote")}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-dim">
                <tr>
                  <th className="pb-2">{t("institutional.horizon")}</th>
                  <th className="pb-2 text-right">{t("common.sharpe")}</th>
                  <th className="pb-2 text-right">{t("common.cagr")}</th>
                  <th className="pb-2 text-right">{t("institutional.maxDd")}</th>
                  <th className="pb-2 text-right">{t("common.objective")}</th>
                </tr>
              </thead>
              <tbody>
                {horizonIs != null && (
                  <HorizonRow label={t("common.inSample")} snap={horizonIs} />
                )}
                {horizonOos != null && (
                  <HorizonRow label={t("common.outOfSample")} snap={horizonOos} />
                )}
                {horizonFull != null && (
                  <HorizonRow label={t("common.full")} snap={horizonFull} />
                )}
              </tbody>
            </table>
          </div>
          {horizonGap != null &&
            (horizonGap.sharpe != null || horizonGap.objective != null) && (
              <p className="ui-hint mt-2">
                {t("institutional.gapNote", {
                  objective: horizonGap.objective ?? "—",
                  sharpe: horizonGap.sharpe ?? "—",
                })}
              </p>
            )}
        </Section>
      )}

      {execution.rebalance_freq != null ? (
        <Section title={t("institutional.rebalanceExecution")}>
          <p className="text-sm">
            {t("institutional.freq")} <span className="text-neon">{String(execution.rebalance_freq)}</span>
            {" · "}
            {t("institutional.count")} <span className="text-neon">{String(execution.rebalance_count)}</span>
          </p>
          {Array.isArray(execution.rebalance_dates_sample) &&
            (execution.rebalance_dates_sample as string[]).length > 0 && (
              <p className="ui-hint mt-2">
                {t("institutional.sampleDates")}: {(execution.rebalance_dates_sample as string[]).join(", ")}
                {(execution.rebalance_dates_sample as string[]).length >= 12 ? " …" : ""}
              </p>
            )}
        </Section>
      ) : isLoadingAnalytics ? (
        <Section title={t("institutional.rebalanceExecution")}>
          <LoadingPlaceholder />
        </Section>
      ) : null}

      <Section title={t("institutional.vsBenchmark", { benchmark })}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label={t("common.beta")} value={rel.beta ?? candidate.beta} />
          <Kpi label={t("common.alpha")} value={rel.alpha ?? rel.alpha_annual ?? candidate.alpha ?? candidate.alpha_annual} />
          <Kpi label={t("institutional.trackingErr")} value={rel.tracking_error ?? candidate.tracking_error} />
          <Kpi label={t("institutional.ir")} value={rel.information_ratio ?? candidate.information_ratio} />
          <Kpi label={t("institutional.upCapture")} value={rel.up_capture} />
          <Kpi label={t("institutional.downCapture")} value={rel.down_capture} />
        </div>
      </Section>

      <Section title={t("institutional.exposure")}>
        {isLoadingAnalytics && exposureEmpty ? (
          <LoadingPlaceholder />
        ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="border-2 border-[var(--border)] bg-[#050508] p-3 text-sm">
            <div className="mb-2 text-dim">{t("institutional.assetClass")}</div>
            {Object.entries(exposure.by_asset_class ?? {}).map(([k, v]) => (
              <div key={k} className="flex justify-between border-t border-[var(--border)] py-1">
                <span>{k}</span>
                <span className="text-neon">{(Number(v) * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
          <div className="border-2 border-[var(--border)] bg-[#050508] p-3 text-sm">
            <div className="mb-2 text-dim">{t("institutional.bucketsRegion")}</div>
            {Object.entries(exposure.by_asset_bucket ?? {}).slice(0, 10).map(([k, v]) => (
              <div key={k} className="flex justify-between border-t border-[var(--border)] py-1">
                <span>{k}</span>
                <span className="text-[var(--cyan)]">{(Number(v) * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>
          <div className="space-y-2 border-2 border-[var(--border)] bg-[#050508] p-3 text-sm">
            <Row label={t("institutional.equity")} value={exposure.equity_pct} />
            <Row label={t("institutional.bond")} value={exposure.bond_pct} />
            <Row label={t("institutional.other")} value={exposure.other_pct} />
            <Row label={t("institutional.durationProxy")} value={exposure.duration_proxy_years} pct={false} />
          </div>
        </div>
        )}
      </Section>

      <Section title={t("institutional.coreHoldingsTitle")}>
        {isLoadingAnalytics && holdingStats.length === 0 && rc.length === 0 ? (
          <LoadingPlaceholder />
        ) : holdingStats.length > 0 ? (
          <>
            <p className="mb-3 text-xs text-dim">{t("institutional.coreHoldingsNote")}</p>
            <div className="max-h-56 overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-dim">
                  <tr>
                    <th className="pb-2">{t("common.ticker")}</th>
                    <th className="pb-2 text-right" title={t("institutional.avgWeightHint")}>
                      {t("institutional.avgWeight")}
                    </th>
                    <th className="pb-2 text-right" title={t("institutional.holdFrequencyHint")}>
                      {t("institutional.holdFrequency")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {holdingStats.slice(0, 15).map((row) => (
                    <tr key={row.ticker} className="border-t border-[var(--border)]">
                      <td className="py-1">{row.ticker}</td>
                      <td className="py-1 text-right">{(row.avgWeight * 100).toFixed(2)}%</td>
                      <td className="py-1 text-right text-[var(--cyan)]">
                        {(row.pctPeriodsHeld * 100).toFixed(0)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <>
            <p className="mb-3 text-xs text-dim">{t("institutional.coreHoldingsNote")}</p>
            <div className="max-h-56 overflow-y-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-dim">
                  <tr>
                    <th className="pb-2">{t("common.ticker")}</th>
                    <th className="pb-2 text-right">{t("institutional.weightShort")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rc.slice(0, 15).map((row) => (
                    <tr key={row.ticker} className="border-t border-[var(--border)]">
                      <td className="py-1">{row.ticker}</td>
                      <td className="py-1 text-right text-[var(--cyan)]">
                        {(row.weight * 100).toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("institutional.rollingSharpe")}>
          <MiniLine
            data={rolling.rolling_sharpe ?? []}
            color="#00f5ff"
            isLoading={isLoadingAnalytics}
          />
        </Section>
        <Section title={t("institutional.rollingVol")}>
          <MiniLine
            data={rolling.rolling_vol ?? []}
            color="#ff2bd6"
            pct
            isLoading={isLoadingAnalytics}
          />
        </Section>
      </div>

      <Section title={t("institutional.drawdownCurve")}>
        <MiniLine data={ddSeries} color="#f87171" pct isLoading={isLoadingAnalytics} />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("institutional.monthlyFull")}>
          <ReturnTable rows={fullMonthly} isLoading={isLoadingAnalytics} />
        </Section>
        <Section title={t("institutional.annualFull")}>
          <ReturnTable rows={fullAnnual} isLoading={isLoadingAnalytics} />
        </Section>
      </div>

      <Section title={t("institutional.drawdownEpisodes")}>
        {isLoadingAnalytics && ddEps.length === 0 ? (
          <LoadingPlaceholder />
        ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-dim">
              <tr>
                <th className="pb-2">{t("institutional.ddStart")}</th>
                <th className="pb-2">{t("institutional.ddTrough")}</th>
                <th className="pb-2">{t("institutional.ddEnd")}</th>
                <th className="pb-2 text-right">{t("institutional.ddDepth")}</th>
                <th className="pb-2 text-right">{t("institutional.ddDays")}</th>
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
        )}
      </Section>
    </div>
  );
}

type HoldingStat = {
  ticker: string;
  avgWeight: number;
  peakWeight: number;
  pctPeriodsHeld: number;
};

// A holding is counted as "held" on a rebalance date when its weight clears this
// floor (0.5%), filtering out negligible residual positions.
const HOLDING_PRESENT_EPS = 0.005;

/**
 * Summarise how a portfolio actually used each holding across its rebalance
 * history: how often it was held and how large it typically was. This replaces
 * the abstract "risk %" (marginal variance contribution) with numbers a retail
 * user can read directly. Weights come from `weight_history` (fractions summing
 * to ~1 per date); the trimmed `OTHER` bucket is ignored.
 */
function computeHoldingStats(
  weightHistory: ({ date: string } & Record<string, number | string>)[],
  tickers: string[],
): HoldingStat[] {
  if (!weightHistory.length || !tickers.length) return [];
  const stats = tickers
    .filter((tk) => tk && tk !== "OTHER")
    .map((tk) => {
      let sum = 0;
      let peak = 0;
      let held = 0;
      for (const row of weightHistory) {
        const w = Number(row[tk] ?? 0) || 0;
        sum += w;
        if (w > peak) peak = w;
        if (w > HOLDING_PRESENT_EPS) held += 1;
      }
      return {
        ticker: tk,
        avgWeight: sum / weightHistory.length,
        peakWeight: peak,
        pctPeriodsHeld: held / weightHistory.length,
      };
    })
    .filter((s) => s.peakWeight > HOLDING_PRESENT_EPS);
  stats.sort((a, b) => b.avgWeight - a.avgWeight);
  return stats;
}

type PeriodicRow = { period: string; return: number };

function mergePeriodicReturns(
  primary?: PeriodicRow[],
  extra?: PeriodicRow[],
): PeriodicRow[] {
  const byPeriod = new Map<string, number>();
  for (const row of primary ?? []) byPeriod.set(row.period, row.return);
  // Holdout (OOS) periods extend the primary series; keep primary on any overlap.
  for (const row of extra ?? []) {
    if (!byPeriod.has(row.period)) byPeriod.set(row.period, row.return);
  }
  return Array.from(byPeriod.entries())
    .map(([period, ret]) => ({ period, return: ret }))
    .sort((x, y) => x.period.localeCompare(y.period));
}

function LoadingPlaceholder({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <p className="flex items-center gap-2 text-xs text-dim">
      <span
        className="inline-block h-3 w-3 animate-spin rounded-full border border-[var(--amber)] border-t-transparent"
        aria-hidden
      />
      {t("common.loading")}{label ? ` ${label}` : ""}…
    </p>
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
      <h4 className="ui-panel-title mb-3 text-[var(--cyan)]">{title}</h4>
      {children}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value?: number | null }) {
  const v = value == null ? "—" : typeof value === "number" ? value.toFixed(3) : String(value);
  return (
    <div className="border-2 border-[var(--border)] bg-[#050508] p-2 text-center">
      <div className="ui-hint">{label}</div>
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
  isLoading = false,
}: {
  data: { date: string; value: number }[];
  color: string;
  pct?: boolean;
  isLoading?: boolean;
}) {
  const { t } = useI18n();
  const axisFont = chartTickFontSize();
  if (!data.length) {
    if (isLoading) return <LoadingPlaceholder />;
    return <p className="ui-hint">{t("institutional.insufficientData")}</p>;
  }
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data}>
        <CartesianGrid stroke="#1a3d1a" strokeDasharray="4 4" />
        <XAxis
          dataKey="date"
          stroke="#5a7a5a"
          fontSize={axisFont}
          minTickGap={24}
          tickFormatter={(v) => String(v).slice(2)}
        />
        <YAxis
          stroke="#5a7a5a"
          fontSize={axisFont}
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

function ReturnTable({
  rows,
  isLoading = false,
}: {
  rows: { period: string; return: number }[];
  isLoading?: boolean;
}) {
  const { t } = useI18n();
  if (!rows.length) {
    if (isLoading) return <LoadingPlaceholder />;
    return <p className="ui-hint">{t("institutional.noData")}</p>;
  }
  return (
    <div className="max-h-48 overflow-y-auto text-sm">
      <table className="w-full">
        <thead className="text-dim">
          <tr>
            <th className="pb-2 text-left">{t("common.period")}</th>
            <th className="pb-2 text-right">{t("common.return")}</th>
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

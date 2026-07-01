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
      <p className="text-sm text-dim">{t("institutional.noAnalytics")}</p>
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
        ? ` ${t("institutional.through", { date: trainEnd })}`
        : "";
  const monthlyTitle = periodicInSample
    ? t("institutional.monthlyInSample", { range: isRange })
    : t("institutional.monthlyFull");
  const annualTitle = periodicInSample
    ? t("institutional.annualInSample", { range: isRange })
    : t("institutional.annualFull");
  const holdoutMonthlyTitle = valStart
    ? t("institutional.monthlyOosFrom", { date: valStart })
    : t("institutional.monthlyOos");
  const holdoutAnnualTitle = valStart
    ? t("institutional.annualOosFrom", { date: valStart })
    : t("institutional.annualOos");
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
        <p className="text-xs text-dim">{analyticsNote}</p>
      ) : null}
      {hasHorizonTable && (
        <Section title={t("institutional.horizonTitle")}>
          <p className="mb-3 text-xs text-dim">{t("institutional.horizonNote")}</p>
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
              <p className="mt-2 text-xs text-dim">
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
              <p className="mt-2 text-xs text-dim">
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

      <Section title={t("institutional.riskContributionTop")}>
        {isLoadingAnalytics && rc.length === 0 ? (
          <LoadingPlaceholder />
        ) : (
        <div className="max-h-56 overflow-y-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-dim">
              <tr>
                <th className="pb-2">{t("common.ticker")}</th>
                <th className="pb-2 text-right">{t("institutional.weightShort")}</th>
                <th className="pb-2 text-right">{t("institutional.riskPct")}</th>
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
        <Section title={monthlyTitle}>
          {periodicInSample && (
            <p className="mb-2 text-xs text-dim">{t("institutional.inSampleNote")}</p>
          )}
          <ReturnTable rows={periodic.monthly ?? []} isLoading={isLoadingAnalytics} />
        </Section>
        <Section title={annualTitle}>
          <ReturnTable rows={periodic.annual ?? []} isLoading={isLoadingAnalytics} />
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
  isLoading = false,
}: {
  data: { date: string; value: number }[];
  color: string;
  pct?: boolean;
  isLoading?: boolean;
}) {
  const { t } = useI18n();
  if (!data.length) {
    if (isLoading) return <LoadingPlaceholder />;
    return <p className="text-xs text-dim">{t("institutional.insufficientData")}</p>;
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
    return <p className="text-xs text-dim">{t("institutional.noData")}</p>;
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

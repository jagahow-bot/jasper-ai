"use client";

import type { ReactNode } from "react";
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

import type { ProposalSlide } from "@/lib/proposal-slides";
import { useI18n } from "@/lib/i18n";

function SlideChrome({
  index,
  total,
  title,
  children,
  className = "",
}: {
  index: number;
  total: number;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`proposal-slide flex h-full flex-col bg-[#fbfdff] p-6 sm:p-8 ${className}`}
      role="group"
      aria-roledescription="slide"
      aria-label={title}
    >
      <header className="mb-4 flex items-baseline justify-between gap-3 border-b border-slate-200 pb-2">
        <h2
          tabIndex={-1}
          className="slide-title text-sm font-semibold uppercase tracking-[0.12em] text-slate-600"
        >
          <span className="mr-2 text-slate-400">
            {String(index + 1).padStart(2, "0")}
          </span>
          {title}
        </h2>
        <span className="tabular-nums text-xs text-slate-400">
          {index + 1}/{total}
        </span>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}

function CoverSlide({ slide }: { slide: Extract<ProposalSlide, { kind: "cover" }> }) {
  const { t } = useI18n();
  return (
    <section
      className="proposal-slide relative flex h-full flex-col justify-between overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 px-8 py-10 text-white"
      role="group"
      aria-roledescription="slide"
      aria-label={t(slide.titleKey)}
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(37,99,235,0.35),transparent_55%)]" />
      <div className="relative">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-200">
          {slide.brand} · {slide.firm}
        </p>
        <h1
          tabIndex={-1}
          className="slide-title mt-5 text-3xl font-semibold tracking-tight sm:text-4xl"
        >
          {t(slide.titleKey)}
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-200">
          {slide.strategyLine}
        </p>
      </div>
      <dl className="relative mt-8 grid gap-4 border-t border-white/15 pt-6 sm:grid-cols-2">
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-slate-400">
            {t("proposal.field.client")}
          </dt>
          <dd className="mt-1 text-lg font-medium">{slide.clientName}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-slate-400">
            {t("proposal.field.preparedBy")}
          </dt>
          <dd className="mt-1 text-lg font-medium">{slide.preparedBy}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-slate-400">
            {t("proposal.field.date")}
          </dt>
          <dd className="mt-1 text-base">{slide.dateLabel}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-slate-400">
            {t("proposal.field.investment")}
          </dt>
          <dd className="mt-1 text-base">{slide.investmentAmount}</dd>
        </div>
      </dl>
      <p className="relative mt-6 text-[11px] uppercase tracking-wider text-blue-200/80">
        {slide.confidential}
      </p>
    </section>
  );
}

function KvGridSlide({
  slide,
  index,
  total,
}: {
  slide: Extract<ProposalSlide, { kind: "kv-grid" }>;
  index: number;
  total: number;
}) {
  const { t } = useI18n();
  return (
    <SlideChrome index={index} total={total} title={t(slide.titleKey)}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {slide.rows.map((row) => (
          <div
            key={row.label}
            className="rounded-lg border border-slate-200 bg-white px-4 py-3"
          >
            <div className="text-[11px] uppercase tracking-wide text-slate-500">
              {row.label}
            </div>
            <div className="mt-1 text-base font-medium text-slate-900">
              {row.value}
            </div>
          </div>
        ))}
      </div>
    </SlideChrome>
  );
}

function GoalsSlide({
  slide,
  index,
  total,
}: {
  slide: Extract<ProposalSlide, { kind: "goals" }>;
  index: number;
  total: number;
}) {
  const { t } = useI18n();
  return (
    <SlideChrome index={index} total={total} title={t(slide.titleKey)}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: t("proposal.field.objective"), value: slide.goal },
          { label: t("proposal.field.horizon"), value: slide.horizon },
          { label: t("slides.s2.maxDd"), value: slide.maxDrawdown },
          {
            label: t("slides.s2.targetReturn"),
            value: slide.targetReturnIsReference
              ? `${slide.targetReturn} (${t("slides.s2.reference")})`
              : slide.targetReturn,
          },
        ].map((item) => (
          <div
            key={item.label}
            className="rounded-lg border border-slate-200 bg-white px-4 py-3"
          >
            <div className="text-[11px] uppercase tracking-wide text-slate-500">
              {item.label}
            </div>
            <div className="mt-1 text-sm font-medium text-slate-900">
              {item.value}
            </div>
          </div>
        ))}
      </div>
      {slide.targetReturnIsReference ? (
        <p className="mt-2 text-xs text-slate-500">
          {t("slides.s2.targetReturnNote")}
        </p>
      ) : null}
      <div className="mt-5 space-y-3">
        <div className="rounded-lg border border-amber-200/80 bg-amber-50/60 px-4 py-3 text-sm text-slate-800">
          {slide.driftLabel}
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800">
          {slide.concentrationLabel}
        </div>
        <p className="border-l-4 border-blue-600 pl-3 text-sm leading-relaxed text-slate-700">
          {slide.necessity}
        </p>
      </div>
    </SlideChrome>
  );
}

function MarketSlide({
  slide,
  index,
  total,
}: {
  slide: Extract<ProposalSlide, { kind: "market" }>;
  index: number;
  total: number;
}) {
  const { t } = useI18n();
  return (
    <SlideChrome index={index} total={total} title={t(slide.titleKey)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {t("slides.s3.houseView")}
        </span>
        {slide.stanceLabel ? (
          <span className="rounded bg-slate-800 px-2 py-0.5 text-xs font-medium text-white">
            {slide.stanceLabel}
          </span>
        ) : null}
      </div>
      <blockquote className="mt-3 border-l-4 border-blue-500 pl-4 text-base leading-relaxed text-slate-800">
        {slide.narrative}
      </blockquote>
      {slide.themes.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {slide.themes.map((theme) => (
            <span
              key={theme}
              className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-600"
            >
              #{theme}
            </span>
          ))}
        </div>
      ) : null}
      <ol className="mt-6 list-decimal space-y-2 pl-5 text-sm text-slate-800">
        {slide.bullets.map((b, i) => (
          <li key={`${i}-${b.slice(0, 24)}`} className="leading-relaxed">
            {b}
          </li>
        ))}
      </ol>
    </SlideChrome>
  );
}

function AllocationSlide({
  slide,
  index,
  total,
}: {
  slide: Extract<ProposalSlide, { kind: "asset-class-compare" }>;
  index: number;
  total: number;
}) {
  const { t } = useI18n();
  const showCurrent = slide.columns.current != null;
  return (
    <SlideChrome index={index} total={total} title={t(slide.titleKey)}>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 font-medium">{t("slides.s4.class")}</th>
              {showCurrent ? (
                <th className="px-3 py-2 text-right font-medium">
                  {slide.columns.current}
                </th>
              ) : null}
              <th className="px-3 py-2 text-right font-medium">
                {slide.columns.proposed}
              </th>
              {showCurrent ? (
                <th className="px-3 py-2 text-right font-medium">
                  {t("slides.s4.adjustment")}
                </th>
              ) : null}
              <th className="px-3 py-2 text-right font-medium">
                {t("slides.s4.amount")}
              </th>
            </tr>
          </thead>
          <tbody>
            {slide.rows.map((row) => (
              <tr key={row.cls} className="border-t border-slate-100">
                <td className="px-3 py-2.5 font-medium text-slate-900">
                  {row.label}
                </td>
                {showCurrent ? (
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                    {row.currentPct == null
                      ? "—"
                      : `${row.currentPct.toFixed(1)}%`}
                  </td>
                ) : null}
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">
                  {row.proposedPct.toFixed(1)}%
                </td>
                {showCurrent ? (
                  <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                    {row.deltaPp == null
                      ? "—"
                      : `${row.deltaPp > 0 ? "+" : ""}${row.deltaPp.toFixed(1)}pp`}
                  </td>
                ) : null}
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">
                  {row.amountLabel}
                </td>
              </tr>
            ))}
            <tr className="border-t border-slate-200 bg-slate-50 font-medium">
              <td className="px-3 py-2.5">{slide.totalLabel}</td>
              {showCurrent ? <td /> : null}
              <td />
              {showCurrent ? <td /> : null}
              <td className="px-3 py-2.5 text-right tabular-nums">
                {slide.totalAmount}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      {slide.footnote ? (
        <p className="mt-2 text-xs text-slate-500">{slide.footnote}</p>
      ) : null}
    </SlideChrome>
  );
}

function MetricsSlide({
  slide,
  index,
  total,
}: {
  slide: Extract<ProposalSlide, { kind: "metrics" }>;
  index: number;
  total: number;
}) {
  const { t } = useI18n();
  return (
    <SlideChrome index={index} total={total} title={t(slide.titleKey)}>
      <p className="mb-3 text-xs text-slate-500">{slide.periodLabel}</p>
      {slide.chartData && slide.chartData.length > 1 ? (
        <div className="mb-4 h-44 w-full print:h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={slide.chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} minTickGap={40} />
              <YAxis tick={{ fontSize: 10 }} domain={["auto", "auto"]} />
              <Tooltip />
              <Legend />
              {slide.anchorLabel ? (
                <Line
                  type="monotone"
                  dataKey="anchor"
                  name={slide.anchorLabel}
                  stroke="#64748b"
                  dot={false}
                  strokeWidth={1.5}
                />
              ) : null}
              <Line
                type="monotone"
                dataKey="customized"
                name={slide.customizedLabel}
                stroke="#1d4ed8"
                dot={false}
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 font-medium">
                {t("proposal.table.metric")}
              </th>
              {!slide.singleTrack ? (
                <th className="px-3 py-2 text-right font-medium">
                  {slide.anchorLabel ?? t("slides.s4.current")}
                </th>
              ) : null}
              <th className="px-3 py-2 text-right font-medium">
                {slide.customizedLabel}
              </th>
              {!slide.singleTrack ? (
                <th className="px-3 py-2 text-right font-medium">
                  {t("slides.s5.improvement")}
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {slide.metrics.map((row) => (
              <tr key={row.label} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-800">
                  {row.label}
                </td>
                {!slide.singleTrack ? (
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                    {row.anchor ?? "—"}
                  </td>
                ) : null}
                <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                  {row.customized}
                </td>
                {!slide.singleTrack ? (
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                    {row.delta ?? "—"}
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SlideChrome>
  );
}

function StressSlide({
  slide,
  index,
  total,
}: {
  slide: Extract<ProposalSlide, { kind: "stress" }>;
  index: number;
  total: number;
}) {
  const { t } = useI18n();
  const renderTable = (
    title: string,
    rows: {
      label: string;
      anchorDepth: string | null;
      customizedDepth: string;
      deltaLabel: string;
    }[],
  ) => (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
        {title}
      </div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
            <th className="px-3 py-2 font-medium">{t("slides.s6.window")}</th>
            {!slide.singleTrack ? (
              <th className="px-3 py-2 text-right font-medium">
                {t("slides.s4.current")}
              </th>
            ) : null}
            <th className="px-3 py-2 text-right font-medium">
              {t("slides.s4.proposed")}
            </th>
            {!slide.singleTrack ? (
              <th className="px-3 py-2 text-right font-medium">
                {t("slides.s6.defenseDelta")}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-slate-100">
              <td className="px-3 py-2 text-slate-800">{row.label}</td>
              {!slide.singleTrack ? (
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.anchorDepth ?? "—"}
                </td>
              ) : null}
              <td className="px-3 py-2 text-right tabular-nums">
                {row.customizedDepth}
              </td>
              {!slide.singleTrack ? (
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.deltaLabel}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <SlideChrome index={index} total={total} title={t(slide.titleKey)}>
      <div className="space-y-4">
        {slide.episodes.length > 0
          ? renderTable(
              slide.episodesTitle,
              slide.episodes.map((e) => ({
                label: e.window,
                anchorDepth: e.anchorDepth,
                customizedDepth: e.customizedDepth,
                deltaLabel: e.deltaLabel,
              })),
            )
          : null}
        {slide.scenarios.length > 0
          ? renderTable(
              slide.scenariosTitle,
              slide.scenarios.map((s) => ({
                label: s.scenario,
                anchorDepth: s.anchorDepth,
                customizedDepth: s.customizedDepth,
                deltaLabel: s.deltaLabel,
              })),
            )
          : null}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        {slide.honestyNote}
      </p>
    </SlideChrome>
  );
}

function TradeListSlide({
  slide,
  index,
  total,
}: {
  slide: Extract<ProposalSlide, { kind: "trade-list" }>;
  index: number;
  total: number;
}) {
  const { t } = useI18n();
  const table = (
    title: string,
    rows: typeof slide.sells,
  ) => (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <div className="bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
        {title}
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-sm text-slate-500">—</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-3 py-2 font-medium">
                {t("proposal.table.holding")}
              </th>
              <th className="px-3 py-2 font-medium">
                {t("slides.s7.isin")}
              </th>
              <th className="px-3 py-2 font-medium" title={slide.pendingDataNote}>
                {t("slides.s7.rr")}*
              </th>
              <th className="px-3 py-2 text-right font-medium">
                {t("proposal.table.pct")}
              </th>
              <th className="px-3 py-2 text-right font-medium">
                {t("proposal.table.amount")}
              </th>
              <th className="px-3 py-2 font-medium">{t("slides.s7.reason")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${title}-${row.ticker}`} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <div className="font-medium text-slate-900">{row.name}</div>
                  <div className="text-xs text-slate-500">{row.ticker}</div>
                </td>
                <td className="px-3 py-2 tabular-nums text-slate-700">
                  {row.isin}
                </td>
                <td className="px-3 py-2 text-slate-500">{row.rr}</td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.weightPct.toFixed(1)}%
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {row.amountLabel}
                </td>
                <td className="px-3 py-2 text-slate-700">{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <SlideChrome index={index} total={total} title={t(slide.titleKey)}>
      {slide.emptyLabel ? (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
          {slide.emptyLabel}
        </p>
      ) : (
        <div className="space-y-4">
          {table(t("slides.s7.sell"), slide.sells)}
          {table(t("slides.s7.buy"), slide.buys)}
        </div>
      )}
      <p className="mt-2 text-[11px] text-slate-400">
        * {slide.pendingDataNote}
      </p>
    </SlideChrome>
  );
}

function CostSlide({
  slide,
  index,
  total,
}: {
  slide: Extract<ProposalSlide, { kind: "cost" }>;
  index: number;
  total: number;
}) {
  const { t } = useI18n();
  return (
    <SlideChrome index={index} total={total} title={t(slide.titleKey)}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">
            {t("slides.s8.turnover")}
          </div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
            {slide.turnoverLabel}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">
            {t("slides.s8.totalCost")}
          </div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-slate-900">
            {slide.totalCostLabel}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {t("slides.s8.costPct")}: {slide.costPctLabel}
          </div>
        </div>
      </div>
      <p className="mt-4 text-sm text-slate-700">{slide.feeLabel}</p>
      <p className="mt-3 text-sm leading-relaxed text-slate-700">
        {slide.benefitNote}
      </p>
      <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
        {slide.assumptionNote}
      </p>
    </SlideChrome>
  );
}

function BulletsSlide({
  slide,
  index,
  total,
}: {
  slide: Extract<ProposalSlide, { kind: "bullets" }>;
  index: number;
  total: number;
}) {
  const { t } = useI18n();
  return (
    <SlideChrome index={index} total={total} title={t(slide.titleKey)}>
      <ol className="space-y-4">
        {slide.bullets.map((b, i) => (
          <li
            key={i}
            className="flex gap-3 rounded-lg border border-slate-200 bg-white px-4 py-4"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white">
              {i + 1}
            </span>
            <p className="text-sm leading-relaxed text-slate-800">{b}</p>
          </li>
        ))}
      </ol>
    </SlideChrome>
  );
}

function SignoffSlide({
  slide,
  index,
  total,
}: {
  slide: Extract<ProposalSlide, { kind: "signoff" }>;
  index: number;
  total: number;
}) {
  const { t } = useI18n();
  return (
    <SlideChrome index={index} total={total} title={t(slide.titleKey)}>
      <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
        {slide.warnings.map((w) => (
          <p key={w} className="text-xs leading-relaxed text-amber-950">
            {w}
          </p>
        ))}
      </div>
      <p className="mt-4 text-sm leading-relaxed text-slate-700">{slide.ackNote}</p>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {slide.signees.map((s) => (
          <div
            key={s.role}
            className="rounded-lg border border-slate-200 bg-white px-4 py-4"
          >
            <div className="text-[11px] uppercase tracking-wide text-slate-500">
              {s.role}
            </div>
            {s.name ? (
              <div className="mt-2 text-sm font-medium text-slate-800">
                {s.name}
              </div>
            ) : (
              <div className="mt-2 h-5" />
            )}
            <div className="mt-8 border-b border-slate-400" />
            <div className="mt-1 text-[10px] text-slate-400">
              {t("slides.s10.signatureLine")}
            </div>
          </div>
        ))}
      </div>
    </SlideChrome>
  );
}

export function SlideRenderer({
  slide,
  index,
  total,
}: {
  slide: ProposalSlide;
  index: number;
  total: number;
}) {
  switch (slide.kind) {
    case "cover":
      return <CoverSlide slide={slide} />;
    case "kv-grid":
      return <KvGridSlide slide={slide} index={index} total={total} />;
    case "goals":
      return <GoalsSlide slide={slide} index={index} total={total} />;
    case "market":
      return <MarketSlide slide={slide} index={index} total={total} />;
    case "asset-class-compare":
      return <AllocationSlide slide={slide} index={index} total={total} />;
    case "metrics":
      return <MetricsSlide slide={slide} index={index} total={total} />;
    case "stress":
      return <StressSlide slide={slide} index={index} total={total} />;
    case "trade-list":
      return <TradeListSlide slide={slide} index={index} total={total} />;
    case "cost":
      return <CostSlide slide={slide} index={index} total={total} />;
    case "bullets":
      return <BulletsSlide slide={slide} index={index} total={total} />;
    case "signoff":
      return <SignoffSlide slide={slide} index={index} total={total} />;
    default:
      return null;
  }
}

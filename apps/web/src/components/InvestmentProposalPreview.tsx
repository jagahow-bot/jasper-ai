"use client";

import { useMemo } from "react";
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

import {
  buildInvestmentProposalDocument,
  type ProposalSection,
} from "@/lib/investment-proposal";
import type { DemoClient } from "@/lib/clients";
import type { ClientOverlay } from "@/lib/overlay-schema";
import type { ModelPortfolio } from "@/lib/model-portfolios";
import { useI18n } from "@/lib/i18n";
import type { PersonalizationCompare } from "@/lib/types";
import { ComplianceBadge } from "@/components/ComplianceBadge";
import { useAiTalkingSummary } from "@/lib/use-ai-talking-summary";
import {
  buildHoldingsDiff,
  buildMetricCompareRows,
} from "@/lib/rm-report-utils";
import { resolveRunObjective } from "@/lib/resolve-run-objective";

type Props = {
  open: boolean;
  onClose: () => void;
  compare: PersonalizationCompare;
  overlay: ClientOverlay | null;
  anchorPortfolio: ModelPortfolio;
  client?: DemoClient | null;
  /** Selected trial on the RM report; defaults to champion. */
  customizedModelCode?: string | null;
};

function SectionHeading({
  index,
  title,
}: {
  index: number;
  title: string;
}) {
  return (
    <h3 className="border-b border-slate-200 pb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
      <span className="mr-2 text-slate-400">{String(index).padStart(2, "0")}</span>
      {title}
    </h3>
  );
}

function AllocationTable({
  rows,
  totalLabel,
  totalMonetary,
  columns,
}: {
  rows: {
    ticker: string;
    name: string;
    weightPct: number;
    monetaryLabel: string;
  }[];
  totalLabel?: string;
  totalMonetary?: string;
  columns: {
    fund: string;
    pct: string;
    amount: string;
  };
}) {
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
            <th className="px-3 py-2 font-medium">{columns.fund}</th>
            <th className="px-3 py-2 text-right font-medium">{columns.pct}</th>
            <th className="px-3 py-2 text-right font-medium">{columns.amount}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.ticker}-${row.name}`} className="border-t border-slate-100">
              <td className="px-3 py-2.5">
                <div className="font-medium text-slate-900">{row.name}</div>
                <div className="text-xs text-slate-500">{row.ticker}</div>
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">
                {row.weightPct.toFixed(1)}%
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-slate-800">
                {row.monetaryLabel}
              </td>
            </tr>
          ))}
          {totalLabel && (
            <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
              <td className="px-3 py-2.5 text-slate-900">{totalLabel}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">
                {rows.reduce((s, r) => s + r.weightPct, 0).toFixed(1)}%
              </td>
              <td className="px-3 py-2.5 text-right tabular-nums text-slate-900">
                {totalMonetary}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function renderSection(
  section: ProposalSection,
  index: number,
  t: (key: string, params?: Record<string, string | number>) => string,
  anchorLabel: string,
  customizedLabel: string,
) {
  const title = t(section.titleKey);
  const heading = <SectionHeading index={index} title={title} />;

  switch (section.kind) {
    case "narrative":
      return (
        <section key={section.id} className="break-inside-avoid space-y-3">
          {heading}
          {section.paragraphs.map((p, i) => (
            <p key={i} className="text-[15px] leading-relaxed text-slate-700">
              {p}
            </p>
          ))}
          {section.bullets && section.bullets.length > 0 && (
            <ul className="list-disc space-y-1.5 pl-5 text-[14px] text-slate-700">
              {section.bullets.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          )}
        </section>
      );

    case "profile":
      return (
        <section key={section.id} className="break-inside-avoid space-y-3">
          {heading}
          <dl className="grid gap-2 sm:grid-cols-2">
            {section.rows.map((row) => (
              <div
                key={row.label}
                className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2"
              >
                <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  {row.label}
                </dt>
                <dd className="mt-0.5 text-sm text-slate-800">{row.value}</dd>
              </div>
            ))}
          </dl>
          {section.notes && section.notes.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
              {section.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </section>
      );

    case "holdings":
      return (
        <section key={section.id} className="break-inside-avoid space-y-2">
          {heading}
          <AllocationTable
            rows={section.rows}
            columns={{
              fund: t("proposal.table.holding"),
              pct: t("proposal.table.pct"),
              amount: t("proposal.table.amount"),
            }}
          />
          {section.footnote && (
            <p className="text-xs text-slate-500">{section.footnote}</p>
          )}
        </section>
      );

    case "allocation":
      return (
        <section key={section.id} className="break-inside-avoid space-y-2">
          {heading}
          <AllocationTable
            rows={section.rows}
            totalLabel={section.totalLabel}
            totalMonetary={section.totalMonetary}
            columns={{
              fund: t("proposal.table.fund"),
              pct: t("proposal.table.pct"),
              amount: t("proposal.table.amount"),
            }}
          />
          {section.footnote && (
            <p className="text-xs text-slate-500">{section.footnote}</p>
          )}
        </section>
      );

    case "talking":
      return (
        <section key={section.id} className="break-inside-avoid space-y-3">
          {heading}
          <ul className="space-y-2">
            {section.bullets.map((b, i) => (
              <li
                key={i}
                className="rounded-lg border border-slate-100 bg-white px-3 py-2.5 text-[14px] leading-relaxed text-slate-700 shadow-sm"
              >
                <span className="mr-2 font-semibold text-slate-400">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {b}
              </li>
            ))}
          </ul>
        </section>
      );

    case "performance":
      return (
        <section key={section.id} className="space-y-4">
          {heading}
          <p className="text-[14px] leading-relaxed text-slate-700">
            {section.chartCaption}
          </p>
          {section.chartData && section.chartData.length > 1 && (
            <div className="h-56 w-full rounded-lg border border-slate-200 bg-white p-2 print:h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={section.chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    minTickGap={40}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    domain={["auto", "auto"]}
                    width={42}
                  />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="anchor"
                    name={anchorLabel}
                    stroke="#94a3b8"
                    strokeWidth={1.5}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="customized"
                    name={customizedLabel}
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-3 py-2 font-medium">{t("proposal.table.metric")}</th>
                  <th className="px-3 py-2 text-right font-medium">{anchorLabel}</th>
                  <th className="px-3 py-2 text-right font-medium">{customizedLabel}</th>
                  <th className="px-3 py-2 text-right font-medium">{t("proposal.table.delta")}</th>
                </tr>
              </thead>
              <tbody>
                {section.metrics.map((m) => (
                  <tr key={m.label} className="border-t border-slate-100">
                    <td className="px-3 py-2 text-slate-800">{m.label}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {m.anchor}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-900">
                      {m.customized}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {m.delta}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-slate-700">{section.riskNote}</p>
          {section.holdingChanges.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 font-medium">{t("proposal.table.fund")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("proposal.table.anchorPct")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("proposal.table.customPct")}</th>
                    <th className="px-3 py-2 text-right font-medium">{t("rm.holdings.change")}</th>
                  </tr>
                </thead>
                <tbody>
                  {section.holdingChanges.map((h) => (
                    <tr key={h.ticker} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-900">{h.name}</div>
                        <div className="text-xs text-slate-500">{h.ticker}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {h.anchorPct.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {h.customizedPct.toFixed(1)}%
                      </td>
                      <td className="px-3 py-2 text-right text-slate-600">
                        {h.changeLabel} ({h.deltaPct > 0 ? "+" : ""}
                        {h.deltaPct.toFixed(1)} pp)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-slate-500">{section.validationNote}</p>
        </section>
      );

    case "implementation":
      return (
        <section key={section.id} className="break-inside-avoid space-y-3">
          {heading}
          <ol className="list-decimal space-y-2 pl-5 text-[14px] leading-relaxed text-slate-700">
            {section.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ol>
        </section>
      );

    case "disclaimers":
      return (
        <section key={section.id} className="break-inside-avoid space-y-3">
          {heading}
          <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-3">
            {section.warnings.map((w, i) => (
              <p key={i} className="text-xs font-medium leading-relaxed text-amber-950">
                {w}
              </p>
            ))}
          </div>
          <ul className="list-disc space-y-1.5 pl-5 text-xs leading-relaxed text-slate-600">
            {section.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </section>
      );
  }
}

export function InvestmentProposalPreview({
  open,
  onClose,
  compare,
  overlay,
  anchorPortfolio,
  client = null,
  customizedModelCode = null,
}: Props) {
  const { t, lang } = useI18n();
  const pick = useMemo(
    () => (customizedModelCode ? { customizedModelCode } : undefined),
    [customizedModelCode],
  );
  const metrics = useMemo(
    () =>
      buildMetricCompareRows(
        compare.baseResult,
        compare.adjustedResult,
        {
          cagr: t("compare.metric.cagr"),
          sharpe: t("compare.metric.sharpe"),
          mdd: t("compare.metric.mdd"),
          vol: t("compare.metric.vol"),
        },
        pick,
      ),
    [compare.baseResult, compare.adjustedResult, pick, t],
  );
  const holdingsDiff = useMemo(
    () =>
      buildHoldingsDiff(
        compare.baseResult,
        compare.adjustedResult,
        anchorPortfolio.holdings,
        pick,
      ),
    [compare.baseResult, compare.adjustedResult, anchorPortfolio.holdings, pick],
  );
  const talkingSummary = useAiTalkingSummary({
    metrics,
    holdingsDiff,
    overlay,
    adjustedResult: compare.adjustedResult,
    anchorLabel: compare.anchorLabel,
    objectiveKey: resolveRunObjective(
      compare.adjustedRequest,
      compare.adjustedResult.narrative_facts,
    ),
    lang,
    t,
    customizedModelCode,
    benchmark: anchorPortfolio.benchmark,
  });
  const doc = useMemo(
    () =>
      buildInvestmentProposalDocument({
        compare,
        overlay,
        anchorPortfolio,
        client,
        lang,
        t,
        customizedModelCode,
        talkingPoints: talkingSummary.summary,
      }),
    [
      compare,
      overlay,
      anchorPortfolio,
      client,
      lang,
      t,
      customizedModelCode,
      talkingSummary.summary,
    ],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/45 p-4 print:static print:bg-transparent print:p-0"
      role="dialog"
      aria-modal="true"
      aria-labelledby="proposal-title"
    >
      <div className="proposal-print my-6 w-full max-w-3xl overflow-hidden rounded-2xl border border-slate-200 bg-[#fbfdff] shadow-xl print:my-0 print:max-w-none print:rounded-none print:border-0 print:bg-white print:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 print:hidden">
          <div>
            <h2 id="proposal-title" className="text-base font-semibold text-slate-900">
              {t("proposal.title")}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">{t("proposal.subtitle")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--primary-hover)]"
              onClick={() => window.print()}
            >
              {t("proposal.print")}
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              onClick={onClose}
            >
              {t("proposal.close")}
            </button>
          </div>
        </div>

        <article className="px-6 py-7 print:px-0 print:py-0">
          {/* Cover */}
          <header className="relative mb-8 overflow-hidden rounded-xl bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 px-7 py-10 text-white print:break-after-page">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(37,99,235,0.35),transparent_55%)]" />
            <div className="relative">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-200">
                {doc.cover.brand} · {doc.cover.firmName}
              </p>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
                {doc.cover.docTitle}
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-200">
                {doc.cover.strategyLine}
              </p>
              <dl className="mt-8 grid gap-4 border-t border-white/15 pt-6 sm:grid-cols-2">
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-slate-400">
                    {t("proposal.field.client")}
                  </dt>
                  <dd className="mt-1 text-lg font-medium">{doc.cover.clientName}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-slate-400">
                    {t("proposal.field.preparedBy")}
                  </dt>
                  <dd className="mt-1 text-lg font-medium">{doc.cover.preparedBy}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-slate-400">
                    {t("proposal.field.date")}
                  </dt>
                  <dd className="mt-1 text-base">{doc.cover.dateLabel}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wider text-slate-400">
                    {t("proposal.field.investment")}
                  </dt>
                  <dd className="mt-1 text-base">{doc.cover.investmentAmount}</dd>
                </div>
              </dl>
              <p className="mt-8 inline-flex rounded-full border border-white/20 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-blue-100">
                {doc.cover.confidential}
              </p>
            </div>
          </header>

          <div className="mb-6 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950 print:border-slate-300 print:bg-slate-50 print:text-slate-700">
            <span>{t("proposal.draftBanner")}</span>
            <ComplianceBadge variant="compact" />
          </div>

          {/* Letter */}
          <section className="mb-8 space-y-3 border-b border-slate-200 pb-8">
            {doc.letter.map((line, i) => (
              <p
                key={i}
                className={`text-[15px] leading-relaxed text-slate-700 ${
                  i === doc.letter.length - 1 ? "font-medium text-slate-900" : ""
                }`}
              >
                {line}
              </p>
            ))}
          </section>

          {/* TOC */}
          <nav className="mb-8 break-inside-avoid rounded-xl border border-slate-200 bg-white px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {t("proposal.toc")}
            </p>
            <ol className="mt-3 space-y-1.5">
              {doc.toc.map((item, i) => (
                <li
                  key={item.id}
                  className="flex items-baseline justify-between gap-3 text-sm text-slate-700"
                >
                  <span>
                    <span className="mr-2 tabular-nums text-slate-400">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {t(item.titleKey)}
                  </span>
                  <span className="hidden flex-1 border-b border-dotted border-slate-200 sm:block" />
                </li>
              ))}
            </ol>
          </nav>

          <div className="space-y-10">
            {doc.sections.map((section, i) =>
              renderSection(
                section,
                i + 1,
                t,
                compare.anchorLabel,
                compare.customizedLabel,
              ),
            )}
          </div>

          <footer className="mt-10 border-t border-slate-200 pt-4 text-center text-[11px] text-slate-400">
            {doc.cover.brand} · {doc.cover.docTitle} · {doc.cover.dateLabel} ·{" "}
            {doc.cover.confidential}
          </footer>
        </article>
      </div>
    </div>
  );
}

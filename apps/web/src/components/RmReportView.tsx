"use client";

import { useEffect, useMemo, useState } from "react";
import { AskEvidencePanel } from "@/components/AskEvidencePanel";
import { AiParamsDisclosureBlock } from "@/components/AiParamsDisclosure";
import { BenchmarkComparePanel } from "@/components/BenchmarkComparePanel";
import { ComplianceBadge } from "@/components/ComplianceBadge";
import { InvestmentProposalPreview } from "@/components/InvestmentProposalPreview";
import { NeedsFulfillmentPanel } from "@/components/NeedsFulfillmentPanel";
import { AuditRawDataPanel } from "@/components/AuditRawDataPanel";
import { ProResultsWithTabs } from "@/components/ProResultsWithTabs";
import { ResultsDashboard } from "@/components/ResultsDashboard";
import { formatOverlaySummary } from "@/lib/overlay-schema";
import type { ClientOverlay } from "@/lib/overlay-schema";
import type { DemoClient } from "@/lib/clients";
import type { ModelPortfolio } from "@/lib/model-portfolios";
import { useI18n } from "@/lib/i18n";
import {
  candidateModelKey,
  candidateRowKey,
  dedupeCandidatesForPerformanceChart,
  resolveChampionModelKey,
  resolveDefaultSelectedRowKey,
} from "@/lib/performance-compare-chart";
import { buildDisplayProposalSet, normalizeProposalLabel } from "@/lib/proposal-set";
import { resolveRunObjective } from "@/lib/resolve-run-objective";
import { formatWeightPct } from "@/lib/candidate-weights";
import {
  buildHoldingsDiff,
  buildMetricCompareRows,
} from "@/lib/rm-report-utils";
import { useAiTalkingSummary } from "@/lib/use-ai-talking-summary";
import { resolveTickerDisplayName } from "@/lib/ticker-display-name";
import {
  pendingCapabilitiesBadgeLabel,
  pendingSupervisorCapabilities,
  proposalPrintBlockedMessage,
  proposalRequiresSupervisorSignoff,
} from "@/lib/proposal-capability-badge";
import type {
  BacktestRequest,
  BacktestResult,
  PersonalizationCompare,
  PortfolioCandidate,
} from "@/lib/types";

type TabId = "rm" | "quant" | "audit";

type Props = {
  compare: PersonalizationCompare;
  overlay: ClientOverlay | null;
  anchorPortfolio: ModelPortfolio;
  client?: DemoClient | null;
  result: BacktestResult;
  narrative: string;
  request: BacktestRequest;
  onRerun: () => void;
  onExport: () => void;
  onQuickTweak: (next: BacktestRequest, label: string) => void;
  onQuickTweakAndRun: (next: BacktestRequest, label: string) => void;
  onContinueRefinement?: (options: {
    extraRefinementRounds: number;
    extraTrialsPerRound: number;
    extraTrials?: number;
  }) => void;
  continueLoading?: boolean;
  onPromoteTickers?: (tickers: string[]) => void;
};

function changeLabel(
  change: string,
  t: (key: string) => string,
): string {
  const keys: Record<string, string> = {
    added: "rm.holdings.added",
    removed: "rm.holdings.removed",
    increased: "rm.holdings.increased",
    decreased: "rm.holdings.decreased",
  };
  return t(keys[change] ?? "rm.holdings.unchanged");
}

function proposalLabelI18nKey(label: string): string | null {
  const normalized = normalizeProposalLabel(label);
  if (
    normalized === "recommended" ||
    normalized === "defensive" ||
    normalized === "growth" ||
    normalized === "alternative" ||
    normalized === "anchor_close" ||
    normalized === "full_drift" ||
    normalized === "theme"
  ) {
    return `results.proposalLabel.${normalized}`;
  }
  return null;
}

function metricValue(
  candidate: PortfolioCandidate | null | undefined,
  key: "sharpe" | "cagr" | "max_drawdown",
): number | null {
  if (!candidate) return null;
  const v = candidate[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function RmReportView({
  compare,
  overlay,
  anchorPortfolio,
  client = null,
  result,
  narrative,
  request,
  onRerun,
  onExport,
  onQuickTweak,
  onQuickTweakAndRun,
  onContinueRefinement,
  continueLoading = false,
  onPromoteTickers,
}: Props) {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<TabId>("rm");
  const [proposalOpen, setProposalOpen] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [talkingOpen, setTalkingOpen] = useState(false);

  const candidateEpoch = useMemo(
    () =>
      `${compare.adjustedResult.job_id}\0${compare.adjustedResult.candidates
        .map((c, i) => candidateRowKey(c, i))
        .join("\0")}`,
    [compare.adjustedResult.job_id, compare.adjustedResult.candidates],
  );

  const [selectedRowKey, setSelectedRowKey] = useState("");

  const proposalCards = useMemo(
    () =>
      buildDisplayProposalSet(
        compare.adjustedResult.proposal_set,
        compare.adjustedResult.candidates,
      ),
    [compare.adjustedResult.proposal_set, compare.adjustedResult.candidates],
  );

  const primaryRecommendationCode = useMemo(() => {
    const rec = proposalCards.find((p) => p.is_recommended);
    return (rec?.model_code || "").toUpperCase() || null;
  }, [proposalCards]);

  const pendingCaps = useMemo(
    () =>
      pendingSupervisorCapabilities(
        compare.adjustedResult.capabilities_used ?? null,
      ),
    [compare.adjustedResult.capabilities_used],
  );
  const blockProposalPrint = proposalRequiresSupervisorSignoff(
    compare.adjustedResult.capabilities_used ?? null,
  );

  useEffect(() => {
    // Prefer proposal_set recommended (= search champion) as the single default.
    if (primaryRecommendationCode) {
      const raw = compare.adjustedResult.candidates;
      const idx = raw.findIndex(
        (c) => candidateModelKey(c).toUpperCase() === primaryRecommendationCode,
      );
      if (idx >= 0) {
        setSelectedRowKey(candidateRowKey(raw[idx], idx));
        return;
      }
    }
    setSelectedRowKey(
      resolveDefaultSelectedRowKey(
        compare.adjustedResult.candidates,
        compare.adjustedResult.narrative_facts,
      ),
    );
  }, [
    candidateEpoch,
    compare.adjustedResult.candidates,
    compare.adjustedResult.narrative_facts,
    primaryRecommendationCode,
  ]);

  const championModelKey = useMemo(
    () =>
      primaryRecommendationCode ??
      resolveChampionModelKey(
        compare.adjustedResult.candidates,
        compare.adjustedResult.narrative_facts,
      ),
    [
      primaryRecommendationCode,
      compare.adjustedResult.candidates,
      compare.adjustedResult.narrative_facts,
    ],
  );

  const candidateOptions = useMemo(() => {
    const raw = compare.adjustedResult.candidates;
    const deduped = dedupeCandidatesForPerformanceChart(raw, championModelKey);
    return deduped.flatMap((slim) => {
      let i = raw.findIndex((c) => c === (slim as (typeof raw)[number]));
      if (i < 0) {
        const code = (slim.model_code || "").toUpperCase();
        i = raw.findIndex(
          (c) => candidateModelKey(c).toUpperCase() === code,
        );
      }
      if (i < 0) return [];
      const c = raw[i]!;
      return [{ c, i, rowKey: candidateRowKey(c, i) }];
    });
  }, [compare.adjustedResult.candidates, championModelKey]);

  const selectedOption = useMemo(() => {
    const exact = candidateOptions.find((o) => o.rowKey === selectedRowKey);
    if (exact) return exact;
    // Clones may have been collapsed; keep the surviving row for the same model.
    const code = selectedRowKey.split("-r")[0]?.toUpperCase();
    if (code) {
      const byCode = candidateOptions.find(
        (o) => candidateModelKey(o.c).toUpperCase() === code,
      );
      if (byCode) return byCode;
    }
    return candidateOptions[0] ?? null;
  }, [candidateOptions, selectedRowKey]);

  const selectedCandidate = selectedOption?.c ?? null;
  const selectedModelCode = selectedCandidate?.model_code ?? null;

  const candidatePick = useMemo(
    () => ({ customizedModelCode: selectedModelCode }),
    [selectedModelCode],
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
        candidatePick,
      ),
    [compare.baseResult, compare.adjustedResult, candidatePick, t],
  );

  const holdingsDiff = useMemo(
    () =>
      buildHoldingsDiff(
        compare.baseResult,
        compare.adjustedResult,
        anchorPortfolio.holdings,
        candidatePick,
      ),
    [
      compare.baseResult,
      compare.adjustedResult,
      anchorPortfolio.holdings,
      candidatePick,
    ],
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
    customizedModelCode: selectedModelCode,
    benchmark: anchorPortfolio.benchmark,
  });

  const clientSummary = overlay
    ? formatOverlaySummary(overlay, lang)
    : null;

  const overlayBullets = useMemo(
    () => (clientSummary ? clientSummary.split("\n").filter(Boolean) : []),
    [clientSummary],
  );

  const signedAt = overlay?.audit.rm_sign_off?.signed_at;

  const needs = selectedCandidate?.needs_attainment ?? null;

  const sharpe = metricValue(selectedCandidate, "sharpe");
  const cagr = metricValue(selectedCandidate, "cagr");
  const mdd = metricValue(selectedCandidate, "max_drawdown");
  const selectedProposal = useMemo(() => {
    const code = (selectedModelCode || "").toUpperCase();
    if (!code) return null;
    return (
      proposalCards.find((p) => p.model_code.toUpperCase() === code) ?? null
    );
  }, [proposalCards, selectedModelCode]);
  const isPrimaryRecommendation =
    selectedModelCode != null &&
    primaryRecommendationCode != null &&
    selectedModelCode.toUpperCase() === primaryRecommendationCode;
  const isChampion = isPrimaryRecommendation;

  const selectedProposalLabelText = useMemo(() => {
    if (!selectedProposal) return t("results.proposalLabel.alternative");
    const key = proposalLabelI18nKey(selectedProposal.label);
    return key ? t(key) : selectedProposal.label;
  }, [selectedProposal, t]);

  const quantDashboard =
    result.pro_rounds && result.pro_rounds.length > 0 ? (
      <ProResultsWithTabs
        result={result}
        narrative={narrative}
        request={request}
        onRerun={onRerun}
        onExport={onExport}
        onQuickTweak={onQuickTweak}
        onQuickTweakAndRun={onQuickTweakAndRun}
        onContinueRefinement={onContinueRefinement}
        continueLoading={continueLoading}
        variant="rm"
        anchorBenchmarkTicker={anchorPortfolio.benchmark}
        anchorPortfolio={anchorPortfolio}
        anchorBaselineResult={compare.baseResult}
        anchorBaselineLabel={compare.anchorLabel}
        selectedRowKey={selectedRowKey}
        onSelectedRowKeyChange={setSelectedRowKey}
        onPromoteTickers={onPromoteTickers}
      />
    ) : (
      <ResultsDashboard
        result={result}
        narrative={narrative}
        request={request}
        onRerun={onRerun}
        onExport={onExport}
        onQuickTweak={onQuickTweak}
        onQuickTweakAndRun={onQuickTweakAndRun}
        onContinueRefinement={onContinueRefinement}
        continueLoading={continueLoading}
        showRunObjectiveBanner={false}
        variant="rm"
        anchorBenchmarkTicker={anchorPortfolio.benchmark}
        anchorPortfolio={anchorPortfolio}
        anchorBaselineResult={compare.baseResult}
        anchorBaselineLabel={compare.anchorLabel}
        selectedRowKey={selectedRowKey}
        onSelectedRowKeyChange={setSelectedRowKey}
        onPromoteTickers={onPromoteTickers}
      />
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-sm">
        <div>
          <h2 className="ui-panel-title">{t("rm.report.title")}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setTab("rm")}
            className={`pixel-chip ${tab === "rm" ? "pixel-chip-active !border-[var(--neon)] !text-[var(--neon)]" : ""}`}
          >
            {t("rm.report.tabRm")}
          </button>
          <button
            type="button"
            onClick={() => setTab("quant")}
            className={`pixel-chip ${tab === "quant" ? "pixel-chip-active" : ""}`}
          >
            {t("rm.report.tabQuant")}
          </button>
          <button
            type="button"
            onClick={() => setTab("audit")}
            className={`pixel-chip ${tab === "audit" ? "pixel-chip-active" : ""}`}
          >
            {t("rm.report.tabAudit")}
          </button>
        </div>
      </div>

      {tab === "quant" ? (
        <div className="space-y-4">{quantDashboard}</div>
      ) : tab === "audit" ? (
        <AuditRawDataPanel
          result={result}
          request={request}
          overlay={overlay}
        />
      ) : (
        <div className="space-y-5">
          <ComplianceBadge />
          {pendingCaps.length > 0 ? (
            <div
              role="status"
              className="border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-950"
            >
              <strong>
                {pendingCapabilitiesBadgeLabel(
                  pendingCaps.length,
                  lang === "en" || lang === "ko" ? lang : "zh",
                )}
              </strong>
              <ul className="mt-1 list-disc pl-5 text-xs">
                {pendingCaps.map((c) => (
                  <li key={`${c.stage}-${c.implementation_id}`}>
                    {c.stage}/{c.implementation_id}@{c.version}
                  </li>
                ))}
              </ul>
              {blockProposalPrint ? (
                <p className="mt-2 text-xs">
                  {proposalPrintBlockedMessage(
                    lang === "en" || lang === "ko" ? lang : "zh",
                  )}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* 1. Recommended portfolio — one conclusion */}
          <section className="pixel-panel border-2 border-[var(--primary)]/35 bg-[var(--primary)]/5">
            <div>
              <p className="ui-hint text-[var(--primary)]">
                {isPrimaryRecommendation
                  ? t("rm.report.heroEyebrow")
                  : t("rm.report.heroEyebrowViewing", {
                      label: selectedProposalLabelText,
                    })}
              </p>
              <h3 className="ui-panel-title mt-1 text-[var(--primary)]">
                {t("rm.report.heroTitle", {
                  code: selectedModelCode ?? "—",
                  star: isChampion ? " ★" : "",
                })}
              </h3>
              {isPrimaryRecommendation ? (
                <p className="ui-hint mt-1">
                  {t("rm.report.heroHint", { anchor: compare.anchorLabel })}
                </p>
              ) : null}
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                <div className="ui-hint text-dim">{t("compare.metric.sharpe")}</div>
                <div className="ui-panel-title mt-1 tabular-nums">
                  {sharpe != null ? sharpe.toFixed(3) : "—"}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                <div className="ui-hint text-dim">{t("compare.metric.cagr")}</div>
                <div className="ui-panel-title mt-1 tabular-nums">
                  {cagr != null ? `${(cagr * 100).toFixed(2)}%` : "—"}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                <div className="ui-hint text-dim">{t("compare.metric.mdd")}</div>
                <div className="ui-panel-title mt-1 tabular-nums">
                  {mdd != null ? `${(mdd * 100).toFixed(2)}%` : "—"}
                </div>
              </div>
            </div>

            {!client && candidateOptions.length > 1 ? (
              <label className="ui-body mt-4 flex flex-wrap items-center gap-2 text-dim">
                <span>{t("rm.report.candidateLabel")}</span>
                <select
                  value={selectedOption?.rowKey ?? selectedRowKey}
                  onChange={(e) => setSelectedRowKey(e.target.value)}
                  className="pixel-input ui-body min-w-[8rem] py-1"
                >
                  {candidateOptions.map(({ c, rowKey }) => (
                    <option key={rowKey} value={rowKey}>
                      {c.model_code ?? `M?${c.rank}`}
                      {candidateModelKey(c) === championModelKey
                        ? ` ${t("rm.report.candidateChampion")}`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {selectedCandidate ? (
              <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
                <AiParamsDisclosureBlock
                  candidate={selectedCandidate}
                  candidates={compare.adjustedResult.candidates}
                  proposals={compare.adjustedResult.proposal_set}
                  baselineCode={primaryRecommendationCode}
                  showExpand={false}
                />
              </div>
            ) : null}
          </section>

          {/* Laptop / tablet: primary story left, supporting panels right */}
          <div className="grid gap-5 lg:grid-cols-12 lg:items-start">
            <div className="min-w-0 space-y-5 lg:col-span-7">
              <BenchmarkComparePanel
                anchorLabel={compare.anchorLabel}
                customizedLabel={compare.customizedLabel}
                baseResult={compare.baseResult}
                adjustedResult={compare.adjustedResult}
                request={request}
                candidatePick={candidatePick}
              />

              {holdingsDiff.length > 0 && (
                <section className="pixel-panel">
                  <h3 className="ui-panel-title">{t("rm.report.holdingsTitle")}</h3>
                  <p className="ui-hint mt-1">{t("rm.report.holdingsHint")}</p>
                  <p className="ui-hint mt-0.5 text-xs opacity-80">
                    {t("rm.report.holdingsPrecisionHint")}
                  </p>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left ui-body">
                      <thead className="text-dim">
                        <tr>
                          <th className="pb-2 pr-3">{t("common.ticker")}</th>
                          <th className="pb-2 pr-3">{t("common.name")}</th>
                          <th className="pb-2 pr-3 text-right">{compare.anchorLabel}</th>
                          <th className="pb-2 pr-3 text-right">{compare.customizedLabel}</th>
                          <th className="pb-2 pr-3 text-right">{t("compare.col.delta")}</th>
                          <th className="pb-2">{t("rm.holdings.change")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {holdingsDiff.slice(0, 12).map((row) => (
                          <tr key={row.ticker} className="border-t border-[var(--border)]">
                            <td className="py-2 pr-3 font-medium">{row.ticker}</td>
                            <td className="py-2 pr-3 text-dim">
                              {resolveTickerDisplayName(row.ticker, lang)}
                            </td>
                            <td className="py-2 pr-3 text-right text-dim">
                              {row.anchorPct > 0.1 ? formatWeightPct(row.anchorPct) : "—"}
                            </td>
                            <td className="py-2 pr-3 text-right text-[var(--primary)]">
                              {row.customizedPct > 0.1
                                ? formatWeightPct(row.customizedPct)
                                : "—"}
                            </td>
                            <td
                              className={`py-2 pr-3 text-right ${
                                row.deltaPct > 0 ? "text-emerald-600" : "text-red-600"
                              }`}
                            >
                              {row.deltaPct > 0 ? "+" : ""}
                              {formatWeightPct(row.deltaPct)}
                            </td>
                            <td className="py-2 text-dim">
                              {changeLabel(row.change, t)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>

            <div className="min-w-0 space-y-5 lg:col-span-5">
              <AskEvidencePanel
                overlay={overlay}
                weights={selectedCandidate?.weights}
                needs={needs}
                objective={resolveRunObjective(
                  compare.adjustedRequest,
                  compare.adjustedResult.narrative_facts,
                )}
                client={client}
              />
              <NeedsFulfillmentPanel needs={needs} />

              {overlay && overlayBullets.length > 0 ? (
                <section className="pixel-panel border-emerald-100 bg-emerald-50/30">
                  <button
                    type="button"
                    onClick={() => setOverlayOpen((v) => !v)}
                    className="flex w-full flex-wrap items-center justify-between gap-2 text-left"
                  >
                    <div>
                      <h3 className="ui-panel-title text-[var(--primary)]">
                        {t("rm.report.overlayTitle")}
                      </h3>
                      <p className="ui-hint mt-1">{t("rm.report.overlayHint")}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {signedAt ? (
                        <span className="pixel-badge-cyan text-xs">
                          {t("rm.report.overlaySigned", {
                            date: new Date(signedAt).toLocaleString(
                              lang === "zh" ? "zh-TW" : lang === "ko" ? "ko-KR" : "en-US",
                              { dateStyle: "medium", timeStyle: "short" },
                            ),
                          })}
                        </span>
                      ) : null}
                      <span className="ui-hint text-dim">
                        {overlayOpen ? t("rm.report.collapse") : t("rm.report.expand")}
                      </span>
                    </div>
                  </button>
                  {overlayOpen ? (
                    <ul className="ui-body mt-3 list-disc space-y-1.5 pl-5">
                      {overlayBullets.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ui-hint mt-2 line-clamp-2 text-dim">
                      {overlayBullets.slice(0, 2).join(" · ")}
                    </p>
                  )}
                </section>
              ) : null}

              <section className="pixel-panel">
                <button
                  type="button"
                  onClick={() => setTalkingOpen((v) => !v)}
                  className="flex w-full items-center justify-between gap-2 text-left"
                >
                  <h3 className="ui-panel-title text-[var(--primary)]">
                    {t("rm.report.talkingTitle")}
                    {talkingSummary.source === "kimi" && (
                      <span className="ml-2 rounded-full bg-[var(--primary)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--primary)]">
                        AI
                      </span>
                    )}
                  </h3>
                  <span className="ui-hint text-dim">
                    {talkingOpen ? t("rm.report.collapse") : t("rm.report.expand")}
                  </span>
                </button>
                {talkingOpen ? (
                  <>
                    {talkingSummary.loading && (
                      <p className="ui-hint mt-3 text-dim">{t("rm.report.talkingLoading")}</p>
                    )}
                    {talkingSummary.error && !talkingSummary.loading && (
                      <p className="ui-hint mt-3 text-red-600">{talkingSummary.error}</p>
                    )}
                    {talkingSummary.rerunRecommended && (
                      <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                        <p className="text-sm font-medium text-red-800">
                          {t("rm.report.performanceFlag")}
                        </p>
                        {talkingSummary.rerunReason && (
                          <p className="mt-1 text-xs text-red-700">
                            {talkingSummary.rerunReason}
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={onRerun}
                          className="mt-2 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
                        >
                          {t("rm.report.rerun")}
                        </button>
                      </div>
                    )}
                    <ul
                      className="ui-body mt-3 list-disc space-y-2 pl-5"
                      key={`talking-${selectedRowKey || selectedModelCode || "champ"}`}
                    >
                      {talkingSummary.summary.map((point, i) => (
                        <li key={`${selectedRowKey}-${i}`}>{point}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="ui-hint mt-2 line-clamp-2 text-dim">
                    {talkingSummary.summary[0] ?? t("rm.report.talkingCollapsedHint")}
                  </p>
                )}
              </section>

              <section className="pixel-panel border-2 border-[var(--primary)]/30 bg-[var(--primary)]/5">
                <h3 className="ui-panel-title text-[var(--primary)]">
                  {t("proposal.ctaTitle")}
                </h3>
                <p className="ui-hint mt-1">{t("proposal.ctaHint")}</p>
                <button
                  type="button"
                  onClick={() => setProposalOpen(true)}
                  className="pixel-btn mt-4 min-w-[14rem]"
                >
                  {t("proposal.generate")}
                </button>
              </section>
            </div>
          </div>

          <section className="saas-inset">
            <details>
              <summary className="ui-section-title cursor-pointer text-dim">
                {t("rm.report.disclaimerTitle")}
              </summary>
              <p className="ui-hint mt-2">{t("rm.report.disclaimerBody")}</p>
            </details>
          </section>

          <div className="flex flex-wrap gap-3">
            <details className="group w-full sm:w-auto">
              <summary className="cursor-pointer list-none rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm font-medium text-[var(--ui-color-body)] hover:bg-[var(--surface-2)] [&::-webkit-details-marker]:hidden">
                {t("rm.report.moreActions")}
                <span className="ml-2 text-xs font-normal text-[var(--text-dim)]">
                  {t("rm.report.moreActionsHint")}
                </span>
              </summary>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={onExport}
                  className="pixel-btn border border-[var(--border)] bg-white text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
                >
                  {t("results.exportCsv")}
                </button>
                <button
                  type="button"
                  onClick={() => setTab("quant")}
                  className="pixel-btn border border-[var(--border)] bg-white text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
                >
                  {t("rm.report.openQuant")}
                </button>
                <button
                  type="button"
                  onClick={onRerun}
                  className="pixel-btn border border-[var(--border)] bg-white text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
                >
                  {t("rm.report.revise")}
                </button>
              </div>
            </details>
          </div>
        </div>
      )}

      <InvestmentProposalPreview
        open={proposalOpen}
        onClose={() => setProposalOpen(false)}
        compare={compare}
        overlay={overlay}
        anchorPortfolio={anchorPortfolio}
        client={client}
        customizedModelCode={selectedModelCode}
      />
    </div>
  );
}

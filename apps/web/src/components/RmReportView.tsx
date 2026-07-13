"use client";

import { useEffect, useMemo, useState } from "react";
import { BenchmarkComparePanel } from "@/components/BenchmarkComparePanel";
import { ProResultsWithTabs } from "@/components/ProResultsWithTabs";
import { ResultsDashboard } from "@/components/ResultsDashboard";
import { formatOverlaySummary } from "@/lib/overlay-schema";
import type { ClientOverlay } from "@/lib/overlay-schema";
import type { ModelPortfolio } from "@/lib/model-portfolios";
import { useI18n } from "@/lib/i18n";
import {
  candidateModelKey,
  candidateRowKey,
  resolveChampionModelKey,
  resolveDefaultSelectedRowKey,
} from "@/lib/performance-compare-chart";
import { resolveRunObjective } from "@/lib/resolve-run-objective";
import {
  buildHoldingsDiff,
  buildMetricCompareRows,
  buildTalkingPoints,
} from "@/lib/rm-report-utils";
import type {
  BacktestRequest,
  BacktestResult,
  PersonalizationCompare,
} from "@/lib/types";

type TabId = "rm" | "quant";

type Props = {
  compare: PersonalizationCompare;
  overlay: ClientOverlay | null;
  anchorPortfolio: ModelPortfolio;
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

export function RmReportView({
  compare,
  overlay,
  anchorPortfolio,
  result,
  narrative,
  request,
  onRerun,
  onExport,
  onQuickTweak,
  onQuickTweakAndRun,
  onContinueRefinement,
  continueLoading = false,
}: Props) {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<TabId>("rm");

  const candidateEpoch = useMemo(
    () =>
      `${compare.adjustedResult.job_id}\0${compare.adjustedResult.candidates
        .map((c, i) => candidateRowKey(c, i))
        .join("\0")}`,
    [compare.adjustedResult.job_id, compare.adjustedResult.candidates],
  );

  const [selectedRowKey, setSelectedRowKey] = useState("");

  useEffect(() => {
    setSelectedRowKey(
      resolveDefaultSelectedRowKey(
        compare.adjustedResult.candidates,
        compare.adjustedResult.narrative_facts,
      ),
    );
  }, [candidateEpoch, compare.adjustedResult.candidates, compare.adjustedResult.narrative_facts]);

  const championModelKey = useMemo(
    () =>
      resolveChampionModelKey(
        compare.adjustedResult.candidates,
        compare.adjustedResult.narrative_facts,
      ),
    [compare.adjustedResult.candidates, compare.adjustedResult.narrative_facts],
  );

  const candidateOptions = useMemo(
    () =>
      compare.adjustedResult.candidates.map((c, i) => ({
        c,
        i,
        rowKey: candidateRowKey(c, i),
      })),
    [compare.adjustedResult.candidates],
  );

  const selectedModelCode = useMemo(() => {
    const match = candidateOptions.find((o) => o.rowKey === selectedRowKey);
    return match?.c.model_code ?? null;
  }, [candidateOptions, selectedRowKey]);

  const candidatePick = useMemo(
    () => ({ customizedModelCode: selectedModelCode }),
    [selectedModelCode],
  );

  const showCandidateSelector = compare.adjustedResult.candidates.length > 1;

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

  const talkingPoints = useMemo(
    () =>
      buildTalkingPoints({
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
      }),
    [
      metrics,
      holdingsDiff,
      overlay,
      compare.adjustedResult,
      compare.adjustedRequest,
      compare.anchorLabel,
      lang,
      t,
      selectedModelCode,
    ],
  );

  const clientSummary = overlay
    ? formatOverlaySummary(overlay, lang)
    : null;

  const overlayBullets = useMemo(
    () => (clientSummary ? clientSummary.split("\n").filter(Boolean) : []),
    [clientSummary],
  );

  const signedAt = overlay?.audit.rm_sign_off?.signed_at;

  const executiveBullets = useMemo(() => {
    const bullets: string[] = [];

    const cagr = metrics.find((m) => m.key === "cagr");
    const mdd = metrics.find((m) => m.key === "mdd");
    if (cagr && mdd) {
      bullets.push(
        t("rm.report.metricsSummary", {
          cagrDelta: cagr.deltaDisplay,
          mddDelta: mdd.deltaDisplay,
          anchor: compare.anchorLabel,
        }),
      );
    }

    bullets.push(...talkingPoints.slice(0, 2));
    return bullets.slice(0, 5);
  }, [metrics, talkingPoints, t, compare.anchorLabel]);

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
        selectedRowKey={selectedRowKey}
        onSelectedRowKeyChange={setSelectedRowKey}
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
        selectedRowKey={selectedRowKey}
        onSelectedRowKeyChange={setSelectedRowKey}
      />
    );

  const candidateSelector = showCandidateSelector ? (
    <section className="pixel-panel">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="ui-panel-title">{t("rm.report.candidateTitle")}</h3>
          <p className="ui-hint mt-1">{t("rm.report.candidateHint")}</p>
        </div>
        <label className="ui-body flex items-center gap-2 text-dim">
          {t("results.model")}
          <select
            value={selectedRowKey}
            onChange={(e) => setSelectedRowKey(e.target.value)}
            className="pixel-input ui-body py-1"
          >
            {candidateOptions.map(({ c, i, rowKey }) => (
              <option key={rowKey} value={rowKey}>
                {c.model_code ?? `M?${c.rank}`}
                {candidateModelKey(c) === championModelKey
                  ? ` ${t("rm.report.candidateChampion")}`
                  : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      {candidateOptions.length <= 8 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {candidateOptions.map(({ c, i, rowKey }) => {
            const isChampion = candidateModelKey(c) === championModelKey;
            const active = rowKey === selectedRowKey;
            return (
              <button
                key={rowKey}
                type="button"
                onClick={() => setSelectedRowKey(rowKey)}
                className={`pixel-chip ${active ? "pixel-chip-active !border-[var(--neon)] !text-[var(--neon)]" : ""}`}
              >
                {c.model_code ?? `M?${c.rank}`}
                {isChampion ? (
                  <span className="ml-1 text-[var(--amber)]" aria-hidden>
                    ★
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  ) : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-sm">
        <h2 className="ui-panel-title">{t("rm.report.title")}</h2>
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
        </div>
      </div>

      {tab === "quant" ? (
        quantDashboard
      ) : (
        <div className="space-y-5">
          {overlay && overlayBullets.length > 0 ? (
            <section className="pixel-panel border-emerald-100 bg-emerald-50/30">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="ui-panel-title text-[var(--primary)]">
                  {t("rm.report.overlayTitle")}
                </h3>
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
              </div>
              <p className="ui-hint mt-1">{t("rm.report.overlayHint")}</p>
              <ul className="ui-body mt-3 list-disc space-y-1.5 pl-5">
                {overlayBullets.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Executive summary */}
          <section className="pixel-panel border-indigo-100 bg-indigo-50/50">
            <h3 className="ui-panel-title text-[var(--primary)]">
              {t("rm.report.executiveTitle")}
            </h3>
            <p className="ui-hint mt-1">{t("rm.report.executiveHint")}</p>
            <ul className="ui-body mt-4 list-none space-y-3">
              {executiveBullets.map((bullet, i) => (
                <li key={i} className="flex gap-3 border-l-2 border-[var(--primary)] pl-3">
                  <span className="text-xs font-semibold tabular-nums text-[var(--amber)]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          </section>

          {candidateSelector}

          {/* Anchor vs customized comparison */}
          <BenchmarkComparePanel
            anchorLabel={compare.anchorLabel}
            customizedLabel={compare.customizedLabel}
            baseResult={compare.baseResult}
            adjustedResult={compare.adjustedResult}
            request={request}
            candidatePick={candidatePick}
          />

          {/* Holdings diff */}
          {holdingsDiff.length > 0 && (
            <section className="pixel-panel">
              <h3 className="ui-panel-title">{t("rm.report.holdingsTitle")}</h3>
              <p className="ui-hint mt-1">{t("rm.report.holdingsHint")}</p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[420px] text-left ui-body">
                  <thead className="text-dim">
                    <tr>
                      <th className="pb-2 pr-3">{t("common.ticker")}</th>
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
                        <td className="py-2 pr-3 text-right text-dim">
                          {row.anchorPct > 0.1 ? `${row.anchorPct.toFixed(1)}%` : "—"}
                        </td>
                        <td className="py-2 pr-3 text-right text-[var(--primary)]">
                          {row.customizedPct > 0.1
                            ? `${row.customizedPct.toFixed(1)}%`
                            : "—"}
                        </td>
                        <td
                          className={`py-2 pr-3 text-right ${
                            row.deltaPct > 0 ? "text-emerald-600" : "text-red-600"
                          }`}
                        >
                          {row.deltaPct > 0 ? "+" : ""}
                          {row.deltaPct.toFixed(1)}%
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

          {/* Client meeting talking points */}
          <section className="pixel-panel border-amber-200 bg-amber-50/40">
            <h3 className="ui-panel-title text-[var(--amber)]">
              {t("rm.report.talkingTitle")}
            </h3>
            <p className="ui-hint mt-1">{t("rm.report.talkingHint")}</p>
            <ul className="ui-body mt-3 list-disc space-y-2 pl-5">
              {talkingPoints.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          </section>

          {/* AI narrative for client-ready section */}
          {narrative && (
            <section className="pixel-panel">
              <h3 className="ui-panel-title">{t("rm.report.narrativeTitle")}</h3>
              <p className="ui-hint mt-1">{t("rm.report.narrativeHint")}</p>
              <div className="ui-body mt-3 whitespace-pre-wrap">
                {narrative}
              </div>
            </section>
          )}

          {/* Compliance disclaimer */}
          <section className="saas-inset">
            <p className="ui-section-title text-dim">{t("rm.report.disclaimerTitle")}</p>
            <p className="ui-hint mt-2">{t("rm.report.disclaimerBody")}</p>
            <p className="ui-hint mt-2 opacity-70">
              {t("results.disclaimer")}{" "}
              {String(result.narrative_facts.data_source ?? t("common.unknown"))}.
            </p>
          </section>

          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={onExport} className="pixel-btn">
              {t("results.exportCsv")}
            </button>
            <button
              type="button"
              onClick={() => setTab("quant")}
              className="pixel-btn border border-[var(--border)] bg-white text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
            >
              {t("rm.report.openQuant")}
            </button>
            <button type="button" onClick={onRerun} className="pixel-btn pixel-btn-amber">
              {t("rm.report.revise")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

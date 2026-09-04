"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  buildAuditChampionParams,
  buildAuditClientContext,
  buildAuditConstraintFields,
  buildAuditDataProvenance,
  buildAuditFinalWeights,
  buildAuditPerformanceEvidence,
  buildAuditProRoundSummaries,
  buildAuditRunSummary,
  buildAuditUniverse,
  buildAuditWeightHistorySummary,
  filterByDateRange,
  filterTickersByQuery,
  paginateSlice,
  resolveAuditChampion,
} from "@/lib/audit-raw-data";
import { formatWeightPct } from "@/lib/candidate-weights";
import {
  formatStageImplementations,
  hasEngineCapabilityReviewContent,
  isLegacyEnginePin,
} from "@/lib/engine-capability-review";
import { useI18n } from "@/lib/i18n";
import type { ClientOverlay } from "@/lib/overlay-schema";
import type { BacktestRequest, BacktestResult } from "@/lib/types";

type Props = {
  result: BacktestResult;
  request: BacktestRequest;
  overlay?: ClientOverlay | null;
};

function formatMetricDisplay(key: string, value: string | number | null): string {
  if (value == null || value === "") return "—";
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value);
  if (
    key === "cagr" ||
    key === "max_drawdown" ||
    key === "volatility" ||
    key === "win_rate" ||
    key === "turnover_avg" ||
    key === "var_95" ||
    key === "cvar_95"
  ) {
    return `${(value * 100).toFixed(2)}%`;
  }
  return value.toFixed(4);
}

function MetaGrid({
  rows,
}: {
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => (
        <div
          key={row.label}
          className="saas-inset rounded-lg px-3 py-2"
        >
          <dt className="ui-hint">{row.label}</dt>
          <dd className="ui-body mt-0.5 break-all font-medium">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="pixel-panel space-y-3">
      <div>
        <h3 className="ui-panel-title">{title}</h3>
        {hint ? <p className="ui-hint mt-1">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function SimpleTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: Array<Array<string | number>>;
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full ui-body text-left">
        <thead>
          <tr className="border-b border-[var(--border)]">
            {headers.map((h) => (
              <th key={h} className="px-2 py-1.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-[var(--border)]/60 last:border-0"
            >
              {row.map((cell, j) => (
                <td key={j} className="px-2 py-1.5 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Pager({
  page,
  totalPages,
  total,
  onPage,
  label,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (p: number) => void;
  label: string;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 ui-hint">
      <span>
        {label} · {page}/{totalPages} ({total})
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className="pixel-chip"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          ‹
        </button>
        <button
          type="button"
          className="pixel-chip"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          ›
        </button>
      </div>
    </div>
  );
}

export function AuditRawDataPanel({ result, request, overlay = null }: Props) {
  const { t } = useI18n();
  const [tickerQuery, setTickerQuery] = useState("");
  const [equityStart, setEquityStart] = useState("");
  const [equityEnd, setEquityEnd] = useState("");
  const [equityPage, setEquityPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [universePage, setUniversePage] = useState(1);

  const champion = useMemo(() => resolveAuditChampion(result), [result]);
  const runSummary = useMemo(
    () => buildAuditRunSummary(result, request),
    [result, request],
  );
  const constraints = useMemo(
    () => buildAuditConstraintFields(request),
    [request],
  );
  const universe = useMemo(
    () => buildAuditUniverse(result, request),
    [result, request],
  );
  const params = useMemo(() => buildAuditChampionParams(champion), [champion]);
  const proRounds = useMemo(
    () => buildAuditProRoundSummaries(result.pro_rounds),
    [result.pro_rounds],
  );
  const provenance = useMemo(
    () => buildAuditDataProvenance(result),
    [result],
  );
  const weights = useMemo(() => buildAuditFinalWeights(champion), [champion]);
  const weightHistory = useMemo(
    () => buildAuditWeightHistorySummary(champion),
    [champion],
  );
  const performance = useMemo(
    () => buildAuditPerformanceEvidence(result, champion),
    [result, champion],
  );
  const clientCtx = useMemo(
    () =>
      buildAuditClientContext(
        request,
        overlay?.audit
          ? (overlay.audit as unknown as Record<string, unknown>)
          : null,
      ),
    [request, overlay],
  );

  const filteredUniverseTickers = useMemo(
    () => filterTickersByQuery(universe.universeTickers, tickerQuery),
    [universe.universeTickers, tickerQuery],
  );
  const filteredHoldings = useMemo(
    () => filterTickersByQuery(universe.holdings, tickerQuery),
    [universe.holdings, tickerQuery],
  );
  const universeSlice = useMemo(() => {
    const combined = [
      ...filteredHoldings.map((tkr) => ({ kind: "holding" as const, tkr })),
      ...filteredUniverseTickers
        .filter((tkr) => !filteredHoldings.includes(tkr))
        .map((tkr) => ({ kind: "universe" as const, tkr })),
    ];
    return paginateSlice(combined, universePage, 40);
  }, [filteredHoldings, filteredUniverseTickers, universePage]);

  const equityFiltered = useMemo(
    () => filterByDateRange(performance.equityCurve, equityStart, equityEnd),
    [performance.equityCurve, equityStart, equityEnd],
  );
  const equitySlice = useMemo(
    () => paginateSlice(equityFiltered, equityPage, 50),
    [equityFiltered, equityPage],
  );
  const historySlice = useMemo(
    () => paginateSlice(weightHistory.rows, historyPage, 25),
    [weightHistory.rows, historyPage],
  );

  const constrainedScenarios = Array.isArray(
    result.narrative_facts?.constrained_scenarios,
  )
    ? (result.narrative_facts.constrained_scenarios as unknown[])
    : [];

  return (
    <div className="space-y-4">
      <p className="ui-hint">{t("results.audit.intro")}</p>

      <Section
        title={t("results.audit.runSummary")}
        hint={t("results.audit.runSummaryHint")}
      >
        <MetaGrid
          rows={[
            { label: t("results.audit.jobId"), value: runSummary.jobId },
            {
              label: t("results.audit.period"),
              value: `${runSummary.startDate} → ${runSummary.endDate}`,
            },
            {
              label: t("results.audit.objective"),
              value: runSummary.objective,
            },
            { label: t("results.audit.engine"), value: runSummary.engine },
            {
              label: t("results.audit.optimizationMode"),
              value: runSummary.optimizationMode,
            },
            {
              label: t("results.audit.dataSource"),
              value: runSummary.dataSource,
            },
            {
              label: t("results.audit.champion"),
              value: runSummary.championModel,
            },
            {
              label: t("results.audit.scenario"),
              value: runSummary.scenarioId,
            },
            {
              label: t("results.audit.backtestMode"),
              value: runSummary.backtestMode,
            },
          ]}
        />
      </Section>

      <Section
        title={t("results.audit.request")}
        hint={t("results.audit.requestHint")}
      >
        <SimpleTable
          headers={[
            t("results.audit.field"),
            t("results.audit.value"),
          ]}
          rows={constraints.map((f) => [f.key, formatParamCell(f.value)])}
        />
        <details className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
          <summary className="cursor-pointer ui-body font-medium">
            {t("results.audit.fullRequestJson")}
          </summary>
          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all ui-hint">
            {JSON.stringify(request, null, 2)}
          </pre>
        </details>
      </Section>

      <Section
        title={t("results.audit.universe")}
        hint={t("results.audit.universeHint")}
      >
        <MetaGrid
          rows={[
            {
              label: t("results.audit.benchmark"),
              value: universe.benchmark,
            },
            {
              label: t("results.audit.tradableCount"),
              value:
                universe.tradableCount != null
                  ? String(universe.tradableCount)
                  : "—",
            },
            {
              label: t("results.audit.universeSize"),
              value:
                universe.universeSize != null
                  ? String(universe.universeSize)
                  : "—",
            },
            {
              label: t("results.audit.assetClasses"),
              value: universe.assetClasses.join(", ") || "—",
            },
            {
              label: t("results.audit.supplements"),
              value: universe.supplements.join(", ") || "—",
            },
          ]}
        />
        {universe.filterText ? (
          <p className="ui-hint">
            {t("results.audit.filterText")}: {universe.filterText}
          </p>
        ) : null}
        {universe.filterPrompts.length > 0 ? (
          <ul className="list-inside list-disc ui-hint">
            {universe.filterPrompts.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap items-end gap-2">
          <label className="ui-hint flex flex-col gap-1">
            {t("results.audit.tickerFilter")}
            <input
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 ui-body"
              value={tickerQuery}
              onChange={(e) => {
                setTickerQuery(e.target.value);
                setUniversePage(1);
              }}
              placeholder="SPY"
            />
          </label>
        </div>
        <SimpleTable
          headers={[
            t("results.audit.ticker"),
            t("results.audit.role"),
          ]}
          rows={universeSlice.items.map((row) => [
            row.tkr,
            row.kind === "holding"
              ? t("results.audit.roleHolding")
              : t("results.audit.roleUniverse"),
          ])}
        />
        <Pager
          page={universeSlice.page}
          totalPages={universeSlice.totalPages}
          total={universeSlice.total}
          onPage={setUniversePage}
          label={t("results.audit.tickers")}
        />
      </Section>

      <Section
        title={t("results.audit.modelParams")}
        hint={t("results.audit.modelParamsHint")}
      >
        {params.length > 0 ? (
          <SimpleTable
            headers={[
              t("results.audit.field"),
              t("results.audit.value"),
            ]}
            rows={params.map((r) => [r.key, r.value])}
          />
        ) : (
          <p className="ui-hint">{t("results.audit.noParams")}</p>
        )}
        {proRounds.length > 0 ? (
          <details className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
            <summary className="cursor-pointer ui-body font-medium">
              {t("results.audit.proRounds")}
            </summary>
            <div className="mt-2">
              <SimpleTable
                headers={[
                  t("results.audit.round"),
                  t("results.audit.improved"),
                  t("results.audit.trials"),
                  t("results.audit.winner"),
                  t("results.audit.score"),
                ]}
                rows={proRounds.map((r) => [
                  r.round,
                  r.improved
                    ? t("results.audit.yes")
                    : t("results.audit.no"),
                  r.trialsInRound,
                  r.winnerCode ?? "—",
                  r.score != null ? r.score.toFixed(4) : "—",
                ])}
              />
            </div>
          </details>
        ) : null}
        {constrainedScenarios.length > 0 ? (
          <details className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
            <summary className="cursor-pointer ui-body font-medium">
              {t("results.audit.scenarios")}
            </summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all ui-hint">
              {JSON.stringify(constrainedScenarios, null, 2)}
            </pre>
          </details>
        ) : null}
      </Section>

      <Section
        title={t("results.audit.provenance")}
        hint={t("results.audit.provenanceHint")}
      >
        <MetaGrid
          rows={[
            {
              label: t("results.audit.dataSource"),
              value: provenance.dataSource,
            },
            {
              label: t("results.audit.rowsCols"),
              value:
                provenance.rows != null && provenance.columns != null
                  ? `${provenance.rows} × ${provenance.columns}`
                  : "—",
            },
            {
              label: t("results.audit.requestedStart"),
              value: provenance.requestedStart ?? "—",
            },
            {
              label: t("results.audit.effectiveStart"),
              value: provenance.effectiveStart ?? "—",
            },
            {
              label: t("results.audit.panelEnd"),
              value: provenance.end ?? "—",
            },
            {
              label: t("results.audit.warmupStart"),
              value: provenance.warmupDownloadStart ?? "—",
            },
            {
              label: t("results.audit.warmupCovers"),
              value:
                provenance.warmupCoversStart == null
                  ? "—"
                  : provenance.warmupCoversStart
                    ? t("results.audit.yes")
                    : t("results.audit.no"),
            },
            {
              label: t("results.audit.excludedCount"),
              value:
                provenance.excludedCount != null
                  ? String(provenance.excludedCount)
                  : "—",
            },
          ]}
        />
        {provenance.warning ? (
          <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 ui-hint">
            {provenance.warning}
          </p>
        ) : null}
        {provenance.excludedLateListings.length > 0 ? (
          <p className="ui-hint">
            {t("results.audit.excludedListings")}:{" "}
            {provenance.excludedLateListings.join(", ")}
          </p>
        ) : null}
        <p className="ui-hint">{t("results.audit.noPricePanelNote")}</p>
      </Section>

      <Section
        title={t("results.audit.weights")}
        hint={t("results.audit.weightsHint")}
      >
        <SimpleTable
          headers={[
            t("results.audit.ticker"),
            t("results.audit.weightPct"),
          ]}
          rows={weights.map((w) => [w.ticker, formatWeightPct(w.pct)])}
        />
        {weightHistory.available ? (
          <>
            <MetaGrid
              rows={[
                {
                  label: t("results.audit.rebalanceCount"),
                  value: String(weightHistory.rebalanceCount),
                },
                {
                  label: t("results.audit.rebalanceSpan"),
                  value:
                    weightHistory.firstDate && weightHistory.lastDate
                      ? `${weightHistory.firstDate} → ${weightHistory.lastDate}`
                      : "—",
                },
              ]}
            />
            <SimpleTable
              headers={[
                t("results.audit.date"),
                t("results.audit.holdingsCount"),
                t("results.audit.topHoldings"),
              ]}
              rows={historySlice.items.map((r) => [
                r.date,
                r.holdingsCount,
                r.topTickers.join(", ") || "—",
              ])}
            />
            <Pager
              page={historySlice.page}
              totalPages={historySlice.totalPages}
              total={historySlice.total}
              onPage={setHistoryPage}
              label={t("results.audit.rebalances")}
            />
          </>
        ) : (
          <p className="ui-hint">{t("results.audit.noWeightHistory")}</p>
        )}
      </Section>

      <Section
        title={t("results.audit.performance")}
        hint={t("results.audit.performanceHint")}
      >
        <SimpleTable
          headers={[
            t("results.audit.metric"),
            t("results.audit.value"),
          ]}
          rows={performance.metrics
            .filter((m) => m.value != null)
            .map((m) => [m.key, formatMetricDisplay(m.key, m.value)])}
        />
        <div className="flex flex-wrap items-end gap-2">
          <label className="ui-hint flex flex-col gap-1">
            {t("results.audit.dateFrom")}
            <input
              type="date"
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 ui-body"
              value={equityStart}
              onChange={(e) => {
                setEquityStart(e.target.value);
                setEquityPage(1);
              }}
            />
          </label>
          <label className="ui-hint flex flex-col gap-1">
            {t("results.audit.dateTo")}
            <input
              type="date"
              className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 ui-body"
              value={equityEnd}
              onChange={(e) => {
                setEquityEnd(e.target.value);
                setEquityPage(1);
              }}
            />
          </label>
        </div>
        <SimpleTable
          headers={[
            t("results.audit.date"),
            t("results.audit.equityValue"),
          ]}
          rows={equitySlice.items.map((p) => [
            p.date,
            Number.isFinite(p.value) ? p.value.toFixed(6) : "—",
          ])}
        />
        <Pager
          page={equitySlice.page}
          totalPages={equitySlice.totalPages}
          total={equitySlice.total}
          onPage={setEquityPage}
          label={t("results.audit.equitySeries")}
        />
      </Section>

      {clientCtx.present ? (
        <Section
          title={t("results.audit.clientContext")}
          hint={t("results.audit.clientContextHint")}
        >
          <MetaGrid
            rows={[
              {
                label: t("results.audit.clientRef"),
                value: clientCtx.clientRef ?? "—",
              },
              {
                label: t("results.audit.anchorPortfolio"),
                value: clientCtx.anchorPortfolioId ?? "—",
              },
              {
                label: t("results.audit.anchorJob"),
                value: clientCtx.anchorJobId ?? "—",
              },
            ]}
          />
          {clientCtx.clientContext ? (
            <details
              open
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2"
            >
              <summary className="cursor-pointer ui-body font-medium">
                {t("results.audit.clientContextJson")}
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all ui-hint">
                {JSON.stringify(clientCtx.clientContext, null, 2)}
              </pre>
            </details>
          ) : null}
          {clientCtx.overlayAudit ? (
            <details className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
              <summary className="cursor-pointer ui-body font-medium">
                {t("results.audit.overlayAuditJson")}
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all ui-hint">
                {JSON.stringify(clientCtx.overlayAudit, null, 2)}
              </pre>
            </details>
          ) : null}
        </Section>
      ) : null}

      {hasEngineCapabilityReviewContent(result, overlay) ? (
        <EngineCapabilityReviewBlock result={result} overlay={overlay} />
      ) : null}

      <details className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
        <summary className="cursor-pointer ui-body font-medium">
          {t("results.audit.fullNarrativeFacts")}
        </summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all ui-hint">
          {JSON.stringify(result.narrative_facts ?? {}, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function EngineCapabilityReviewBlock({
  result,
  overlay,
}: {
  result: BacktestResult;
  overlay?: ClientOverlay | null;
}) {
  const { t } = useI18n();
  const stageRows = formatStageImplementations(result.stage_implementations);
  const caps = result.capabilities_used ?? [];
  const gaps = overlay?.capability_gaps ?? [];

  return (
    <details className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
      <summary className="cursor-pointer ui-body font-medium">
        {t("results.audit.engineCapabilities")}
      </summary>
      <p className="ui-hint mt-2">{t("results.audit.engineCapabilitiesHint")}</p>
      {isLegacyEnginePin(result) ? (
        <p className="ui-body mt-2 text-amber-800">
          {t("results.audit.engineLegacyNote")}
        </p>
      ) : null}
      <div className="mt-3">
        <MetaGrid
          rows={[
            {
              label: t("results.audit.stageCatalogVersion"),
              value: result.stage_catalog_version ?? "—",
            },
            {
              label: t("results.audit.paramCatalogVersion"),
              value:
                result.param_catalog_version != null
                  ? String(result.param_catalog_version)
                  : "—",
            },
          ]}
        />
      </div>
      {stageRows.length > 0 ? (
        <div className="mt-3 space-y-1">
          <p className="ui-hint font-medium">
            {t("results.audit.stageImplementations")}
          </p>
          <ul className="list-inside list-disc ui-body">
            {stageRows.map((row) => (
              <li key={row.stage}>
                <span className="text-dim">{row.stage}</span>: {row.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {caps.length > 0 ? (
        <div className="mt-3 space-y-1">
          <p className="ui-hint font-medium">
            {t("results.audit.capabilitiesUsed")}
          </p>
          <ul className="list-inside list-disc ui-body">
            {caps.map((cap) => (
              <li key={`${cap.stage}-${cap.implementation_id}-${cap.version}`}>
                {cap.stage}/{cap.implementation_id}@{cap.version}
                {cap.pending_supervisor_signoff
                  ? ` · ${t("results.audit.capabilityPendingSignoff")}`
                  : ` · ${cap.status}`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {gaps.length > 0 ? (
        <div className="mt-3 space-y-1">
          <p className="ui-hint font-medium">
            {t("results.audit.capabilityGaps")}
          </p>
          <ul className="space-y-2">
            {gaps.map((gap, i) => (
              <li
                key={`${gap.stage}-${gap.missing_capability}-${i}`}
                className="rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 ui-body"
              >
                <div className="font-medium">
                  {gap.stage} · {gap.missing_capability}
                  <span className="ml-1 text-dim">({gap.severity})</span>
                </div>
                <p className="ui-hint mt-0.5">{gap.summary}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </details>
  );
}

function formatParamCell(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

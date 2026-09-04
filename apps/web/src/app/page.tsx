"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { ConstraintsPanel } from "@/components/ConstraintsPanel";
import { CustomizationScopePanel } from "@/components/CustomizationScopePanel";
import { LaunchScopeConfirm } from "@/components/LaunchScopeConfirm";
import { RmRunPanel } from "@/components/RmRunPanel";
import { RmReportView } from "@/components/RmReportView";
import { RmWizardStepIndicator } from "@/components/RmWizardStepIndicator";
import { OptimizationObjectiveBanner } from "@/components/OptimizationObjectiveBanner";
import { OverlayConversationPanel } from "@/components/OverlayConversationPanel";
import { OverlayContextSummary } from "@/components/OverlayContextSummary";
import { DualProgressPanel } from "@/components/DualProgressPanel";
import { ProgressPanel } from "@/components/ProgressPanel";
import { ProResultsWithTabs } from "@/components/ProResultsWithTabs";
import { ResultsDashboard } from "@/components/ResultsDashboard";
import { ResultsWithAuditTabs } from "@/components/ResultsWithAuditTabs";
import {
  continueJob,
  createJob,
  downloadCsv,
  fetchApiHealth,
  getJobProgress,
  getJobRequest,
  getJobResult,
} from "@/lib/api";
import {
  findLocalHistoryEntry,
  recordCompletedBacktest,
} from "@/lib/backtest-history";
import {
  applyScopeToBacktestRequest,
  buildScopeHoldings,
  defaultCustomizationPortfolioName,
  effectiveScopeGroupIds,
  getDemoClientById,
  getClientHoldingsGroups,
  holdingDisplayName,
  holdingsGroupLabel,
  holdingsGroupWeight,
  localizedText,
  requestHasCashCustomization,
  resolveAnchorIdFromScope,
  scopeCashWeight,
  type DemoClient,
} from "@/lib/clients";
import { DEFAULT_ASSET_CLASSES } from "@/lib/constants";
import {
  DEFAULT_BACKTEST_START,
  lastCompletedMonthEnd,
} from "@/lib/default-backtest-dates";
import { parseGoalHandoffFromSearch } from "@/lib/financial-goal";
import { seedOverlayFromFinancialGoals } from "@/lib/financial-goal-handoff";
import { loadGoalInsights } from "@/lib/financial-goal-store";
import { buildJobNarrativeFacts } from "@/lib/narrative-slim";
import { resolveChampionCandidateIndex } from "@/lib/performance-compare-chart";
import { etfDisplayName } from "@/lib/etf-display-name";
import { useI18n } from "@/lib/i18n";
import { flushLlmAuditLogs, pushLlmAuditLog, type LlmAuditEntry } from "@/lib/llm-audit";
import {
  buildAnchorBacktestRequest,
  buildCurrentHoldingsAnchor,
  CURRENT_HOLDINGS_ANCHOR_ID,
  getAnchorPortfolioById,
  getCustomizedVsAnchorLabel,
  getPortfolioLabel,
  isSkipBaselineAnchorId,
  SKIP_BASELINE_ANCHOR,
  SKIP_BASELINE_ANCHOR_ID,
  SPY_ANCHOR,
  SPY_ANCHOR_ID,
  type ModelPortfolio,
} from "@/lib/model-portfolios";
import {
  getManagedPortfolioById,
  getSelectableAnchorPortfolios,
  readManagedPortfolios,
  type ManagedModelPortfolio,
} from "@/lib/model-portfolios-store";
import { readInvestmentPool } from "@/lib/investment-pool";
import {
  attachDriftSyncAudit,
  overlayToBacktestRequest,
  type ClientOverlay,
  type OverlayConversationMessage,
} from "@/lib/overlay-schema";
import {
  computeOverlayDriftHints,
  driftSyncActionForConfirm,
} from "@/lib/overlay-drift-sync";
import {
  clearProposedTickers,
  overlayAlreadyShowsProposedTickers,
  overlayPromptsKey,
} from "@/lib/overlay-filter-proposals";
import { resolveOverlayUniverse } from "@/lib/resolve-overlay-universe";
import { uniqueTickers } from "@/lib/locked-universe";
import type {
  BacktestRequest,
  BacktestResult,
  JobProgress,
  PersonalizationCompare,
  WizardPhase,
} from "@/lib/types";

/** Stable empty transcript — avoids `[]` identity churn in overlay two-way sync. */
const EMPTY_OVERLAY_MESSAGES: OverlayConversationMessage[] = [];

function asModelPortfolio(
  p: ModelPortfolio & { conflict_tickers?: string[]; enabled?: boolean },
): ModelPortfolio {
  const rest: Record<string, unknown> = { ...p };
  delete rest.conflict_tickers;
  delete rest.enabled;
  return rest as ModelPortfolio;
}

function buildDefaultRequest(): BacktestRequest {
  return {
    scenario_id: "custom",
    max_weight: 0.5,
    min_weight: 0.005,
    objective: "max_sharpe",
    regime_adaptive: false,
    backtest_mode: "static",
    start_date: DEFAULT_BACKTEST_START,
    end_date: lastCompletedMonthEnd(),
    trials: 50,
    top_models: 5,
    asset_classes: [...DEFAULT_ASSET_CLASSES],
    enable_oos: true,
    train_ratio: 0.7,
    fee_bps: 10,
    rebalance_freq: "QE",
    max_holdings: 30,
    max_turnover: 1.0,
    customization_drift: 0.5,
    anchor_weights: null,
    objective_custom_text: "",
    param_controls: {},
    optimization_mode: "standard",
    enable_iterative_refinement: false,
    refinement_batch_size: 5,
    refinement_challengers_per_round: 4,
    refinement_max_rounds: 8,
    refinement_min_improvement: 0.01,
    benchmark_ticker: "SPY",
  };
}

export default function HomePage() {
  const { t, lang } = useI18n();
  const [phase, setPhase] = useState<WizardPhase>("overlay");
  const [anchorPortfolioId, setAnchorPortfolioId] = useState(SPY_ANCHOR_ID);
  const [activeClient, setActiveClient] = useState<DemoClient | null>(null);
  const [scopeGroupIds, setScopeGroupIds] = useState<string[]>([]);
  const [portfolioName, setPortfolioName] = useState("");
  /** True when launched via ?client= from the dashboard (confirm-first handoff). */
  const [launchedFromDashboard, setLaunchedFromDashboard] = useState(false);
  const [scopeEditorsOpen, setScopeEditorsOpen] = useState(true);
  /** Dashboard launch: scope/anchor context acknowledged — show the overlay chat. */
  const [scopeConfirmed, setScopeConfirmed] = useState(false);
  const [signedOverlay, setSignedOverlay] = useState<ClientOverlay | null>(null);
  const [overlaySession, setOverlaySession] = useState<ClientOverlay | null>(null);
  const [overlayMessages, setOverlayMessages] =
    useState<OverlayConversationMessage[]>(EMPTY_OVERLAY_MESSAGES);
  const [driftSyncNotice, setDriftSyncNotice] = useState<{
    from: number;
    to: number;
    requiresSupervisor: boolean;
  } | null>(null);

  const [personalizationCompare, setPersonalizationCompare] =
    useState<PersonalizationCompare | null>(null);
  const [request, setRequest] = useState<BacktestRequest | null>(
    buildDefaultRequest(),
  );
  const [jobId, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [anchorProgress, setAnchorProgress] = useState<JobProgress | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [narrative, setNarrative] = useState("");
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState<
    boolean | null
  >(null);
  const [continueLoading, setContinueLoading] = useState(false);
  const clientLaunchApplied = useRef(false);
  /** Prefill Overlay after client/anchor deep-link (survives the reset effect). */
  const pendingGoalHandoffRef =
    useRef<ReturnType<typeof parseGoalHandoffFromSearch>>(null);
  /** Prompts fingerprint after suggestions were shown (chat or filter interrupt). */
  const filterProposalsSurfacedKeyRef = useRef<string | null>(null);

  // Reset the overlay conversation when the client or anchor model changes,
  // so we do not carry a stale dialogue into a new customization.
  useEffect(() => {
    setOverlaySession(null);
    setOverlayMessages(EMPTY_OVERLAY_MESSAGES);
    filterProposalsSurfacedKeyRef.current = null;
  }, [activeClient?.client_id, anchorPortfolioId]);

  // Chat/AI (or a prior filter interrupt) already listed proposed_tickers — treat
  // that prompts fingerprint as surfaced so a later confirm cannot re-open the gate
  // after the RM acknowledges and clears the list.
  useEffect(() => {
    if (!overlaySession || !overlayAlreadyShowsProposedTickers(overlaySession)) {
      return;
    }
    filterProposalsSurfacedKeyRef.current = overlayPromptsKey(overlaySession);
  }, [overlaySession]);
  const scopeGroups = useMemo(
    () => (activeClient ? getClientHoldingsGroups(activeClient) : []),
    [activeClient],
  );

  const scopeHoldings = useMemo(() => {
    if (!activeClient) return [];
    const ids = effectiveScopeGroupIds(scopeGroups, scopeGroupIds);
    return buildScopeHoldings(scopeGroups, ids);
  }, [activeClient, scopeGroupIds, scopeGroups]);

  const currentHoldingsAnchor = useMemo(
    () => (activeClient ? buildCurrentHoldingsAnchor(scopeHoldings) : null),
    [activeClient, scopeHoldings],
  );

  const anchorPortfolio = useMemo(() => {
    if (isSkipBaselineAnchorId(anchorPortfolioId)) {
      return SKIP_BASELINE_ANCHOR;
    }
    if (anchorPortfolioId === CURRENT_HOLDINGS_ANCHOR_ID) {
      // Pure cash → current-holdings cannot be built; do not silently show SPY.
      return (
        currentHoldingsAnchor ??
        (scopeCashWeight(scopeHoldings) > 0
          ? SKIP_BASELINE_ANCHOR
          : SPY_ANCHOR)
      );
    }
    const managed = getManagedPortfolioById(anchorPortfolioId);
    if (managed) {
      return asModelPortfolio(managed);
    }
    return getAnchorPortfolioById(anchorPortfolioId) ?? SPY_ANCHOR;
  }, [anchorPortfolioId, currentHoldingsAnchor, scopeHoldings]);

  const customizedLabel = useMemo(() => {
    const trimmed = portfolioName.trim();
    if (trimmed) return trimmed;
    return getCustomizedVsAnchorLabel(anchorPortfolio, lang);
  }, [portfolioName, anchorPortfolio, lang]);

  const selectedScopeGroups = useMemo(() => {
    const ids = effectiveScopeGroupIds(scopeGroups, scopeGroupIds);
    const selected = new Set(ids);
    return scopeGroups
      .filter((group) => selected.has(group.id))
      .map((group) => {
        const groupTotal = holdingsGroupWeight(group);
        const holdings = group.holdings
          .filter((holding) => holding.weight > 0)
          .sort((a, b) => b.weight - a.weight)
          .map((holding) => ({
            id: `${group.id}-${holding.ticker}`,
            ticker: holding.ticker.toUpperCase(),
            label: holdingDisplayName(holding, t, lang),
            weightLabel:
              groupTotal > 0
                ? `${((holding.weight / groupTotal) * 100).toFixed(1)}%`
                : "0.0%",
          }));
        return {
          id: group.id,
          name: holdingsGroupLabel(group, lang, t),
          holdings,
        };
      })
      .filter((group) => group.holdings.length > 0);
  }, [scopeGroups, scopeGroupIds, t, lang]);

  const [managedAnchors, setManagedAnchors] = useState<ManagedModelPortfolio[]>([]);

  useEffect(() => {
    const pool = readInvestmentPool();
    setManagedAnchors(readManagedPortfolios(pool));
  }, []);

  const overlayAnchorOptions = useMemo(() => {
    const selectable = getSelectableAnchorPortfolios();
    const catalogSource =
      managedAnchors.length === 0
        ? selectable
        : managedAnchors.filter(
            (p) => p.enabled && p.conflict_tickers.length === 0,
          );
    const catalog = catalogSource.map((p) => ({
      id: p.id,
      label: getPortfolioLabel(p, lang),
    }));
    const cashInScope = scopeCashWeight(scopeHoldings) > 0;
    const skipOption = cashInScope
      ? [
          {
            id: SKIP_BASELINE_ANCHOR_ID,
            label: getPortfolioLabel(SKIP_BASELINE_ANCHOR, lang),
          },
        ]
      : [];
    if (currentHoldingsAnchor) {
      return [
        {
          id: CURRENT_HOLDINGS_ANCHOR_ID,
          label: getPortfolioLabel(currentHoldingsAnchor, lang),
        },
        ...skipOption,
        ...catalog,
      ];
    }
    // Pure cash: skip-baseline is the primary non-model choice (not SPY).
    return [...skipOption, ...catalog];
  }, [managedAnchors, currentHoldingsAnchor, lang, scopeHoldings]);

  const anchorLabel = useMemo(
    () => getPortfolioLabel(anchorPortfolio, lang),
    [anchorPortfolio, lang],
  );

  const anchorPositions = useMemo(() => {
    // Skip-baseline keeps an engine-only SPY seed — never show it as holdings chips.
    if (isSkipBaselineAnchorId(anchorPortfolio.id)) return [];
    return anchorPortfolio.holdings
      .filter((holding) => holding.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .map((holding) => ({
        id: `${holding.ticker}-${holding.name}`,
        ticker: holding.ticker.toUpperCase(),
        label: etfDisplayName(holding.ticker, lang),
        weightLabel: `${(holding.weight * 100).toFixed(1)}%`,
      }));
  }, [anchorPortfolio, lang]);

  const syncRequestFromAnchor = useCallback(
    (portfolio: ModelPortfolio = anchorPortfolio) => {
      setRequest(buildAnchorBacktestRequest(portfolio, buildDefaultRequest()));
    },
    [anchorPortfolio],
  );

  // Keep the synthetic baseline in sync when the RM changes which sleeves are in scope.
  useEffect(() => {
    if (phase !== "overlay") return;

    const cashInScope = scopeCashWeight(scopeHoldings) > 0;

    if (isSkipBaselineAnchorId(anchorPortfolioId)) {
      if (cashInScope) {
        syncRequestFromAnchor(SKIP_BASELINE_ANCHOR);
        return;
      }
      // Cash no longer in play — skip option is unavailable; pick a real baseline.
      if (currentHoldingsAnchor) {
        setAnchorPortfolioId(CURRENT_HOLDINGS_ANCHOR_ID);
        syncRequestFromAnchor(currentHoldingsAnchor);
      } else {
        const portfolio =
          getSelectableAnchorPortfolios()[0] ??
          getAnchorPortfolioById(SPY_ANCHOR_ID) ??
          SPY_ANCHOR;
        setAnchorPortfolioId(portfolio.id);
        syncRequestFromAnchor(asModelPortfolio(portfolio));
      }
      return;
    }

    if (anchorPortfolioId !== CURRENT_HOLDINGS_ANCHOR_ID) return;
    if (currentHoldingsAnchor) {
      syncRequestFromAnchor(currentHoldingsAnchor);
      return;
    }
    // Scope became cash-only: migrate off CURRENT_HOLDINGS so the UI does not
    // silently show SPY as the selected baseline.
    if (cashInScope) {
      setAnchorPortfolioId(SKIP_BASELINE_ANCHOR_ID);
      syncRequestFromAnchor(SKIP_BASELINE_ANCHOR);
    }
  }, [
    phase,
    anchorPortfolioId,
    currentHoldingsAnchor,
    scopeHoldings,
    syncRequestFromAnchor,
  ]);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const health = await fetchApiHealth();
      if (cancelled) return;
      setApiOnline(health?.status === "ok");
      setEmailNotificationsEnabled(
        health?.email_notifications === "configured" ? true : health ? false : null,
      );
    };
    void check();
    const interval = setInterval(() => void check(), 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const presentResult = useCallback(
    async (
      id: string,
      res: BacktestResult,
      req: BacktestRequest,
      compare?: PersonalizationCompare | null,
    ) => {
      const local = findLocalHistoryEntry(id);
      const clientId =
        req.client_ref?.trim() ||
        local?.clientId ||
        local?.signedOverlay?.audit.client_ref ||
        null;
      if (clientId) {
        const client = getDemoClientById(clientId);
        if (client) setActiveClient(client);
      }
      if (local?.signedOverlay) {
        setSignedOverlay(local.signedOverlay);
      }
      const anchorId = req.anchor_portfolio_id?.trim();
      if (anchorId) {
        setAnchorPortfolioId(anchorId);
      }

      let resolvedCompare = compare ?? local?.personalizationCompare ?? null;
      if (!resolvedCompare && req.anchor_job_id) {
        try {
          const [baseRes, baseReqStored] = await Promise.all([
            getJobResult(req.anchor_job_id),
            getJobRequest(req.anchor_job_id).catch(() => null),
          ]);
          const portfolioId =
            anchorId ||
            local?.personalizationCompare?.anchorPortfolioId ||
            CURRENT_HOLDINGS_ANCHOR_ID;
          const managed = getManagedPortfolioById(portfolioId);
          const catalog = getAnchorPortfolioById(portfolioId);
          const portfolio =
            portfolioId === CURRENT_HOLDINGS_ANCHOR_ID
              ? null
              : managed
                ? asModelPortfolio(managed)
                : catalog;
          resolvedCompare = {
            anchorPortfolioId: portfolioId,
            anchorLabel:
              local?.personalizationCompare?.anchorLabel ||
              (portfolio ? getPortfolioLabel(portfolio, lang) : portfolioId),
            customizedLabel:
              local?.personalizationCompare?.customizedLabel ||
              getCustomizedVsAnchorLabel(
                portfolio ?? SPY_ANCHOR,
                lang,
              ),
            baseResult: baseRes,
            baseRequest: baseReqStored ?? req,
            adjustedResult: res,
            adjustedRequest: req,
          };
        } catch {
          resolvedCompare = null;
        }
      }

      const effectiveReq = resolvedCompare
        ? {
            ...req,
            benchmark_ticker:
              req.benchmark_ticker ??
              resolvedCompare.baseRequest.benchmark_ticker ??
              resolvedCompare.adjustedRequest.benchmark_ticker,
          }
        : req;
      recordCompletedBacktest(id, effectiveReq, res, {
        personalizationCompare: resolvedCompare ?? undefined,
        signedOverlay: local?.signedOverlay ?? (compare ? signedOverlay : null),
        clientId,
      });
      setJobId(id);
      setRequest(effectiveReq);
      setResult(res);
      setPersonalizationCompare(resolvedCompare);
      // Job-level narrative is generated reactively (see effect below) so it
      // regenerates in the active language when the user switches locale.
      setNarrative("");
      setPhase("results");
    },
    [lang, signedOverlay],
  );

  // Regenerate the job-level AI narrative whenever the result or the active
  // language changes, so zh/ko users get the summary in their language.
  useEffect(() => {
    if (!result || result.candidates.length === 0) {
      setNarrative("");
      return;
    }
    let cancelled = false;
    const championIdx = resolveChampionCandidateIndex(
      result.candidates,
      result.narrative_facts,
    );
    const champion =
      championIdx >= 0 ? result.candidates[championIdx] : result.candidates[0];
    const narrFacts = champion
      ? buildJobNarrativeFacts(result.narrative_facts, champion)
      : result.narrative_facts;
    void (async () => {
      try {
        const narrRes = await fetch("/api/narrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ facts: narrFacts, lang }),
        });
        const narrJson = (await narrRes.json()) as {
          narrative: string;
          llm_log?: LlmAuditEntry;
        };
        if (!cancelled) setNarrative(narrJson.narrative);
        pushLlmAuditLog(narrJson.llm_log);
        if (jobId) await flushLlmAuditLogs(jobId);
      } catch {
        /* keep prior narrative on failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [result, lang, jobId]);

  const pollJob = useCallback(
    async (id: string) => {
      const prog = await getJobProgress(id);
      setProgress(prog);
      if (prog.status === "completed") {
        const res = await getJobResult(id);
        const req = (await getJobRequest(id).catch(() => null)) ?? request;
        if (req) {
          await presentResult(id, res, req);
        } else {
          setResult(res);
          setPhase("results");
        }
        return true;
      }
      if (prog.status === "failed") {
        setPhase("constraints");
        return true;
      }
      return false;
    },
    [presentResult, request],
  );

  const loadHistoricalJob = useCallback(
    async (id: string) => {
      try {
        const local = findLocalHistoryEntry(id);
        if (local?.result && local.request) {
          await presentResult(id, local.result, local.request);
          return;
        }

        try {
          const prog = await getJobProgress(id);
          if (prog.status !== "completed") {
            return;
          }
          const [res, req] = await Promise.all([getJobResult(id), getJobRequest(id)]);
          await presentResult(id, res, req);
        } catch {
          if (local?.result && local.request) {
            await presentResult(id, local.result, local.request);
            return;
          }
        }
      } catch {
        /* deep-link load is best-effort */
      }
    },
    [presentResult],
  );

  // Deep link from notification emails: /?job=<id> auto-loads that job's
  // results on first mount so recipients land straight on their report.
  // Client Dashboard launch: /?client=<id>&anchor=<id> prefills context.
  const deepLinkLoaded = useRef(false);
  useEffect(() => {
    if (deepLinkLoaded.current) return;
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const jobParam = params.get("job");
    if (jobParam) {
      deepLinkLoaded.current = true;
      const clientFromLink = params.get("client");
      if (clientFromLink) {
        const client = getDemoClientById(clientFromLink);
        if (client) setActiveClient(client);
      }
      void loadHistoricalJob(jobParam);
      return;
    }

    if (clientLaunchApplied.current) return;
    const clientId = params.get("client");
    const anchorParam = params.get("anchor");
    const groupsParam = params.get("groups");
    const portfolioNameParam = params.get("portfolioName");
    const goalHandoff = parseGoalHandoffFromSearch(params);
    if (!clientId && !anchorParam && !goalHandoff) return;
    clientLaunchApplied.current = true;
    if (goalHandoff) {
      pendingGoalHandoffRef.current = goalHandoff;
    }

    const client = clientId ? getDemoClientById(clientId) : null;
    if (client) {
      setActiveClient(client);
      setLaunchedFromDashboard(true);
      setScopeEditorsOpen(false);
      const groups = getClientHoldingsGroups(client);
      const parsedGroups = groupsParam
        ? groupsParam
            .split(",")
            .map((s) => s.trim())
            .filter((id) => groups.some((g) => g.id === id))
        : [];
      const initialScopeIds =
        parsedGroups.length > 0 ? parsedGroups : groups.map((g) => g.id);
      setScopeGroupIds(initialScopeIds);
      setPortfolioName(
        portfolioNameParam?.trim() ||
          defaultCustomizationPortfolioName(client, lang),
      );
      const scopeH = buildScopeHoldings(groups, initialScopeIds);
      const liveCurrent = buildCurrentHoldingsAnchor(scopeH);
      const fallbackAnchor = liveCurrent
        ? CURRENT_HOLDINGS_ANCHOR_ID
        : scopeCashWeight(scopeH) > 0
          ? SKIP_BASELINE_ANCHOR_ID
          : (getSelectableAnchorPortfolios()[0]?.id ?? SPY_ANCHOR_ID);
      const anchorId =
        anchorParam ||
        resolveAnchorIdFromScope(groups, initialScopeIds, fallbackAnchor);
      if (isSkipBaselineAnchorId(anchorId)) {
        setAnchorPortfolioId(SKIP_BASELINE_ANCHOR_ID);
        syncRequestFromAnchor(SKIP_BASELINE_ANCHOR);
      } else if (anchorId === CURRENT_HOLDINGS_ANCHOR_ID) {
        if (liveCurrent) {
          setAnchorPortfolioId(CURRENT_HOLDINGS_ANCHOR_ID);
          syncRequestFromAnchor(liveCurrent);
        } else if (scopeCashWeight(scopeH) > 0) {
          setAnchorPortfolioId(SKIP_BASELINE_ANCHOR_ID);
          syncRequestFromAnchor(SKIP_BASELINE_ANCHOR);
        } else {
          const portfolio =
            getSelectableAnchorPortfolios()[0] ??
            getAnchorPortfolioById(SPY_ANCHOR_ID) ??
            SPY_ANCHOR;
          setAnchorPortfolioId(portfolio.id);
          syncRequestFromAnchor(asModelPortfolio(portfolio));
        }
      } else {
        const portfolio =
          getManagedPortfolioById(anchorId) ??
          getAnchorPortfolioById(anchorId) ??
          SPY_ANCHOR;
        setAnchorPortfolioId(portfolio.id);
        syncRequestFromAnchor(asModelPortfolio(portfolio));
      }
    } else if (anchorParam) {
      if (isSkipBaselineAnchorId(anchorParam)) {
        setAnchorPortfolioId(SKIP_BASELINE_ANCHOR_ID);
        syncRequestFromAnchor(SKIP_BASELINE_ANCHOR);
      } else if (anchorParam === CURRENT_HOLDINGS_ANCHOR_ID) {
        setAnchorPortfolioId(CURRENT_HOLDINGS_ANCHOR_ID);
      } else {
        const portfolio =
          getManagedPortfolioById(anchorParam) ??
          getAnchorPortfolioById(anchorParam);
        if (portfolio) {
          setAnchorPortfolioId(portfolio.id);
          syncRequestFromAnchor(asModelPortfolio(portfolio));
        }
      }
    }
  }, [loadHistoricalJob, lang, syncRequestFromAnchor]);

  // Apply goal-simulator handoff after client/anchor reset clears overlay state.
  useEffect(() => {
    const pending = pendingGoalHandoffRef.current;
    if (!pending?.goals.length || !activeClient) return;
    pendingGoalHandoffRef.current = null;
    const seeded = seedOverlayFromFinancialGoals(
      pending.goals,
      pending.assumptions,
      activeClient.client_id,
      lang,
      loadGoalInsights(activeClient.client_id),
    );
    setOverlaySession(seeded.overlay);
    setOverlayMessages(seeded.messages);
    setPhase("overlay");
  }, [activeClient?.client_id, anchorPortfolioId, lang, activeClient]);

  const runBacktest = useCallback(
    async (reqOverride?: BacktestRequest) => {
      const req = reqOverride ?? request;
      if (!req) return;

      setRequest(req);
      setPhase("running");
      setResult(null);
      setNarrative("");
      setPersonalizationCompare(null);
      setAnchorProgress(null);

      try {
        const { job_id } = await createJob({
          ...req,
          experiment: undefined,
          report_language: lang,
        });
        setJobId(job_id);
        void flushLlmAuditLogs(job_id);

        let done = false;
        while (!done) {
          done = await pollJob(job_id);
          if (!done) await new Promise((r) => setTimeout(r, 400));
        }
      } catch {
        setPhase("constraints");
      }
    },
    [pollJob, request, lang],
  );

  const runPersonalizationBacktest = useCallback(
    async (reqOverride?: BacktestRequest) => {
      const anchor = anchorPortfolio;
      const baseReq = buildAnchorBacktestRequest(
        anchor,
        reqOverride ?? request ?? buildDefaultRequest(),
      );
      // Lock scope into holdings before overlay add/exclude (do not re-apply
      // scope after overlay — that would reintroduce excluded tickers).
      const scopedBase = applyScopeToBacktestRequest(baseReq, scopeHoldings);
      // Always re-derive the locked universe from the signed overlay so a
      // mutated constraints request cannot reopen the full fund pool.
      const lockedOverlayReq = signedOverlay
        ? overlayToBacktestRequest(scopedBase, signedOverlay, {
            scenarioId: `customized-${signedOverlay.audit.session_id}`,
            reportLanguage: lang,
          })
        : null;
      const adjustedReq = signedOverlay
        ? {
            ...(reqOverride ?? request ?? lockedOverlayReq!),
            universe_tickers: lockedOverlayReq!.universe_tickers,
            universe_supplement_tickers:
              lockedOverlayReq!.universe_supplement_tickers,
            max_holdings: lockedOverlayReq!.max_holdings,
            max_weight: lockedOverlayReq!.max_weight,
            // Overlay/scope cash sleeve must win over a stale constraints request
            // that may still have cash_reserve_pct=0 / missing client_context.
            cash_reserve_pct: lockedOverlayReq!.cash_reserve_pct,
            cash_return_mode: lockedOverlayReq!.cash_return_mode,
            client_context: lockedOverlayReq!.client_context,
            deployment_months: lockedOverlayReq!.deployment_months,
            deployment_tranches: lockedOverlayReq!.deployment_tranches,
            benchmark_ticker: anchor.benchmark,
            client_ref:
              activeClient?.client_id ??
              signedOverlay.audit.client_ref ??
              null,
            anchor_portfolio_id: anchor.id,
          }
        : scopedBase;

      setRequest(adjustedReq);
      setPhase("running");
      setResult(null);
      setNarrative("");
      setPersonalizationCompare(null);
      setAnchorProgress(null);

      const skipAnchorCompare =
        Boolean((reqOverride ?? request)?.skip_anchor_compare) &&
        requestHasCashCustomization(adjustedReq, signedOverlay);

      // Cash customization with "不對標基準投組": single customized job only —
      // no anchor static-replay leg and no dual-track RmReportView compare.
      // Market ticker (benchmark_ticker) remains for risk metrics / charts.
      if (skipAnchorCompare) {
        try {
          const soloJob = await createJob({
            ...adjustedReq,
            anchor_job_id: null,
            experiment: undefined,
            report_language: lang,
          });
          void flushLlmAuditLogs(soloJob.job_id);
          const initialProg = await getJobProgress(soloJob.job_id);
          setProgress(initialProg);
          setJobId(soloJob.job_id);

          let done = false;
          let failed = false;
          while (!done) {
            const prog = await getJobProgress(soloJob.job_id);
            setProgress(prog);
            if (prog.status === "completed") done = true;
            if (prog.status === "failed") {
              failed = true;
              done = true;
            }
            if (!done) await new Promise((r) => setTimeout(r, 400));
          }
          if (failed) {
            setPhase("constraints");
            return;
          }

          const [soloRes, soloReqStored] = await Promise.all([
            getJobResult(soloJob.job_id),
            getJobRequest(soloJob.job_id).catch(() => adjustedReq),
          ]);
          const storedReq = {
            ...soloReqStored,
            client_ref: adjustedReq.client_ref,
            anchor_portfolio_id: anchor.id,
            skip_anchor_compare: true,
          };
          recordCompletedBacktest(soloJob.job_id, storedReq, soloRes, {
            signedOverlay,
            clientId:
              activeClient?.client_id ?? signedOverlay?.audit.client_ref,
          });
          await presentResult(soloJob.job_id, soloRes, storedReq, null);
        } catch {
          setPhase("constraints");
        }
        return;
      }

      const anchorLabelForRun = getPortfolioLabel(anchor, lang);

      try {
        // Run anchor (static replay) first so customized Optuna does not overlap peak RAM on API.
        // Do not email for the anchor leg — only the customized job notifies.
        // Carry the cash sleeve into the anchor replay so the baseline
        // reflects the client's actual cash drag (dual-track consistency).
        // Prefer overlay-mapped reserve (max of scope + overlay) when present.
        const baseJob = await createJob({
          ...baseReq,
          cash_reserve_pct:
            lockedOverlayReq?.cash_reserve_pct ?? scopedBase.cash_reserve_pct,
          cash_return_mode:
            lockedOverlayReq?.cash_return_mode ?? scopedBase.cash_return_mode,
          notify_email: null,
          experiment: undefined,
          report_language: lang,
        });
        setAnchorProgress(await getJobProgress(baseJob.job_id));

        let baseDone = false;
        let baseFailed = false;
        while (!baseDone) {
          const prog = await getJobProgress(baseJob.job_id);
          setAnchorProgress(prog);
          if (prog.status === "completed") baseDone = true;
          if (prog.status === "failed") {
            baseFailed = true;
            baseDone = true;
          }
          if (!baseDone) await new Promise((r) => setTimeout(r, 400));
        }

        const adjustedWithAnchor: BacktestRequest = {
          ...adjustedReq,
          anchor_job_id: baseJob.job_id,
        };
        setRequest(adjustedWithAnchor);

        const adjustedJob = await createJob({
          ...adjustedWithAnchor,
          experiment: undefined,
          report_language: lang,
        });
        void flushLlmAuditLogs(adjustedJob.job_id);
        const initialCustomProg = await getJobProgress(adjustedJob.job_id);
        setProgress(initialCustomProg);
        setJobId(adjustedJob.job_id);

        let adjustedDone = false;
        let adjustedFailed = false;

        while (!adjustedDone) {
          const prog = await getJobProgress(adjustedJob.job_id);
          setProgress(prog);
          if (prog.status === "completed") adjustedDone = true;
          if (prog.status === "failed") {
            adjustedFailed = true;
            adjustedDone = true;
          }
          if (!adjustedDone) await new Promise((r) => setTimeout(r, 400));
        }

        if (adjustedFailed) {
          setPhase("constraints");
          return;
        }

        // Failed anchor jobs have no result payload — fetching them 500s and
        // would abort the whole compare even when customized succeeded.
        if (baseFailed) {
          const [adjustedRes, adjustedReqStored] = await Promise.all([
            getJobResult(adjustedJob.job_id),
            getJobRequest(adjustedJob.job_id).catch(() => adjustedWithAnchor),
          ]);
          await presentResult(
            adjustedJob.job_id,
            adjustedRes,
            {
              ...adjustedReqStored,
              client_ref: adjustedWithAnchor.client_ref,
              anchor_job_id: baseJob.job_id,
              anchor_portfolio_id: anchor.id,
            },
            null,
          );
          return;
        }

        const [baseRes, adjustedRes, baseReqStored, adjustedReqStored] =
          await Promise.all([
            getJobResult(baseJob.job_id),
            getJobResult(adjustedJob.job_id),
            getJobRequest(baseJob.job_id).catch(() => baseReq),
            getJobRequest(adjustedJob.job_id).catch(() => adjustedWithAnchor),
          ]);

        const compare: PersonalizationCompare = {
          anchorPortfolioId: anchor.id,
          anchorLabel: anchorLabelForRun,
          customizedLabel,
          baseResult: baseRes,
          baseRequest: baseReqStored,
          adjustedResult: adjustedRes,
          adjustedRequest: {
            ...adjustedReqStored,
            client_ref: adjustedWithAnchor.client_ref,
            anchor_job_id: baseJob.job_id,
            anchor_portfolio_id: anchor.id,
          },
        };

        recordCompletedBacktest(baseJob.job_id, baseReqStored, baseRes);
        recordCompletedBacktest(
          adjustedJob.job_id,
          compare.adjustedRequest,
          adjustedRes,
          {
            personalizationCompare: compare,
            signedOverlay,
            clientId:
              activeClient?.client_id ?? signedOverlay?.audit.client_ref,

          },
        );
        await presentResult(
          adjustedJob.job_id,
          adjustedRes,
          compare.adjustedRequest,
          compare,
        );
      } catch {
        setPhase("constraints");
      }
    },
    [
      anchorPortfolio,
      signedOverlay,
      request,
      lang,
      presentResult,
      scopeHoldings,
      customizedLabel,
      activeClient,
    ],
  );

  const onRun = useCallback(() => {
    if (signedOverlay) {
      void runPersonalizationBacktest();
    } else {
      void runBacktest();
    }
  }, [runBacktest, runPersonalizationBacktest, signedOverlay]);

  const onAnchorSelect = useCallback((portfolio: ModelPortfolio) => {
    setAnchorPortfolioId(portfolio.id);
    syncRequestFromAnchor(portfolio);
  }, [syncRequestFromAnchor]);

  const onOverlayAnchorChange = useCallback(
    (id: string) => {
      if (isSkipBaselineAnchorId(id)) {
        onAnchorSelect(SKIP_BASELINE_ANCHOR);
        return;
      }
      if (id === CURRENT_HOLDINGS_ANCHOR_ID) {
        if (currentHoldingsAnchor) {
          onAnchorSelect(currentHoldingsAnchor);
        } else if (scopeCashWeight(scopeHoldings) > 0) {
          onAnchorSelect(SKIP_BASELINE_ANCHOR);
        }
        return;
      }
      const portfolio =
        getManagedPortfolioById(id) ??
        getAnchorPortfolioById(id) ??
        SPY_ANCHOR;
      // Choosing a real model clears the skip flag (RmRunPanel can re-enable).
      const asModel = asModelPortfolio(portfolio);
      setAnchorPortfolioId(asModel.id);
      setRequest(
        buildAnchorBacktestRequest(
          asModel,
          { ...buildDefaultRequest(), skip_anchor_compare: false },
        ),
      );
    },
    [currentHoldingsAnchor, onAnchorSelect, scopeHoldings],
  );

  const onScopeConfirm = useCallback(() => {
    syncRequestFromAnchor();
    setScopeConfirmed(true);
  }, [syncRequestFromAnchor]);

  const onOverlayConfirm = useCallback(
    async (overlay: ClientOverlay): Promise<boolean | ClientOverlay> => {
      const base = buildAnchorBacktestRequest(
        anchorPortfolio,
        request ?? buildDefaultRequest(),
      );
      // Scope first so overlay add/exclude applies on top of locked holdings.
      const scoped = applyScopeToBacktestRequest(base, scopeHoldings);
      const reportLanguage = lang === "zh" ? "zh-TW" : lang;
      // Sign-off never opens a filter/propose pass — chat ProposedTickersPanel is
      // the only suggestion UI. Skipping the LLM filter also avoids stale novel
      // tickers reappearing after「確認 Overlay」.
      const { request: resolved } = await resolveOverlayUniverse(scoped, overlay, {
        scenarioId: `customized-${overlay.audit.session_id}`,
        reportLanguage,
        skipFilterProposals: true,
      });

      const anchorWeights = Object.fromEntries(
        anchorPortfolio.holdings
          .filter((h) => h.weight > 0)
          .map((h) => [h.ticker.toUpperCase(), h.weight]),
      );
      let finalized = clearProposedTickers(overlay);
      const beforeDrift = resolved.customization_drift ?? 0.5;
      const hints = computeOverlayDriftHints(finalized, {
        anchorWeights,
        currentDrift: beforeDrift,
      });
      const action = driftSyncActionForConfirm(hints, beforeDrift);
      if (action.kind === "raise") {
        resolved.customization_drift = action.to;
        const driftCtl = resolved.param_controls?.customization_drift_actual;
        if (driftCtl?.mode === "fixed") {
          resolved.param_controls = {
            ...resolved.param_controls,
            customization_drift_actual: { ...driftCtl, fixed: action.to },
          };
        }
        resolved.overlay_drift_floor = hints.minRequiredDrift;
        setDriftSyncNotice({
          from: action.from,
          to: action.to,
          requiresSupervisor: action.requiresSupervisor,
        });
      } else {
        if (hints.minRequiredDrift > 0) {
          resolved.overlay_drift_floor = hints.minRequiredDrift;
        }
        setDriftSyncNotice(null);
      }
      finalized = attachDriftSyncAudit(
        finalized,
        hints,
        resolved.customization_drift ?? 0.5,
        beforeDrift,
      );

      // Keep prompts fingerprint so returning to overlay (e.g. rerun) cannot
      // reopen a propose gate for the same rules.
      filterProposalsSurfacedKeyRef.current = overlayPromptsKey(finalized);
      // Sync working session so remounting overlay does not revive proposed_tickers.
      setOverlaySession(finalized);
      setSignedOverlay(finalized);
      // Step-1 skip-baseline (or an earlier RmRunPanel toggle) stays checked.
      if (
        isSkipBaselineAnchorId(anchorPortfolio.id) ||
        Boolean(request?.skip_anchor_compare)
      ) {
        resolved.skip_anchor_compare = true;
      }
      setRequest(resolved);
      setPhase("constraints");
      return true;
    },
    [anchorPortfolio, request, lang, scopeHoldings],
  );

  const onPromoteTickers = useCallback(
    (tickers: string[]) => {
      const normalized = uniqueTickers(tickers);
      if (!normalized.length) return;

      if (signedOverlay) {
        const updatedOverlay: ClientOverlay = {
          ...signedOverlay,
          universe: {
            ...signedOverlay.universe,
            supplement_tickers: uniqueTickers([
              ...(signedOverlay.universe.supplement_tickers ?? []),
              ...normalized,
            ]),
          },
        };
        setSignedOverlay(updatedOverlay);
        void runPersonalizationBacktest();
        return;
      }

      const next: BacktestRequest = {
        ...(request ?? buildDefaultRequest()),
        universe_supplement_tickers: uniqueTickers([
          ...(request?.universe_supplement_tickers ?? []),
          ...normalized,
        ]),
      };
      void runBacktest(next);
    },
    [signedOverlay, request, runPersonalizationBacktest, runBacktest],
  );

  const onSkipOverlay = useCallback(() => {
    setSignedOverlay(null);
    setOverlaySession(null);
    setOverlayMessages(EMPTY_OVERLAY_MESSAGES);
    setDriftSyncNotice(null);
    filterProposalsSurfacedKeyRef.current = null;
    const base = buildAnchorBacktestRequest(
      anchorPortfolio,
      request ?? buildDefaultRequest(),
    );
    setRequest(applyScopeToBacktestRequest(base, scopeHoldings));
    setPhase("constraints");
  }, [anchorPortfolio, request, scopeHoldings]);

  const onQuickTweak = useCallback((next: BacktestRequest) => {
    setRequest(next);
  }, []);

  const onQuickTweakAndRun = useCallback(
    (next: BacktestRequest) => {
      if (signedOverlay) {
        void runPersonalizationBacktest(next);
      } else {
        void runBacktest(next);
      }
    },
    [runBacktest, runPersonalizationBacktest, signedOverlay],
  );

  const onContinueRefinement = useCallback(
    async (options: {
      extraRefinementRounds: number;
      extraTrialsPerRound: number;
      extraTrials?: number;
    }) => {
      if (!result?.job_id) return;
      setContinueLoading(true);
      setPhase("running");
      setResult(null);
      setNarrative("");
      try {
        const { job_id, continued_from } = await continueJob(result.job_id, {
          extra_refinement_rounds: options.extraRefinementRounds,
          extra_trials_per_round: options.extraTrialsPerRound,
          extra_trials: options.extraTrials ?? null,
        });
        const priorReq = await getJobRequest(continued_from);
        setRequest(priorReq);
        setJobId(job_id);
        void flushLlmAuditLogs(job_id);
        let done = false;
        while (!done) {
          done = await pollJob(job_id);
          if (!done) await new Promise((r) => setTimeout(r, 400));
        }
      } catch {
        setPhase("constraints");
      } finally {
        setContinueLoading(false);
      }
    },
    [pollJob, result?.job_id],
  );

  const header = useMemo(() => {
    const labels: Record<WizardPhase, string> = {
      scenario: t("header.phase.scenario"),
      overlay: t("header.phase.overlay"),
      constraints: t("header.phase.constraints"),
      running: t("header.phase.running"),
      results: t("header.phase.results"),
      export: t("header.phase.export"),
    };
    return labels[phase];
  }, [phase, t]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppNav
        subtitle={header}
        extraBadges={
          <>
            {apiOnline === false && (
              <span
                className="pixel-badge pixel-badge-warn max-w-xs"
                title={t("header.apiOfflineHint")}
              >
                {t("header.apiOffline")}
              </span>
            )}
            {apiOnline === true && (
              <span className="pixel-badge pixel-badge-cyan">{t("header.apiLinked")}</span>
            )}
          </>
        }
      />

      <main className="mx-auto max-w-7xl space-y-5 px-6 py-6">
        <RmWizardStepIndicator
          phase={phase}
          hasOverlay={Boolean(signedOverlay) || phase === "overlay"}
          onStepSelect={(step) => {
            if (step === "overlay") {
              setDriftSyncNotice(null);
              setPhase("overlay");
            } else if (step === "execute") setPhase("constraints");
          }}
          contextSlot={
            !activeClient ? (
              <>
                <span className="text-dim">{t("clients.noClientBanner")}</span>
                <Link
                  href="/clients"
                  className="font-medium text-[var(--primary)] hover:underline"
                >
                  {t("clients.noClientBannerCta")}
                </Link>
              </>
            ) : (
              <>
                <span className="text-dim">
                  {t("clients.contextBanner", {
                    name: localizedText(activeClient.display_name, lang),
                  })}
                </span>
                <Link
                  href={`/clients/${activeClient.client_id}`}
                  className="text-[var(--primary)] hover:underline"
                >
                  {t("clients.viewDashboard")}
                </Link>
              </>
            )
          }
        />

        {activeClient &&
        phase === "overlay" &&
        launchedFromDashboard &&
        !scopeEditorsOpen &&
        !scopeConfirmed ? (
          <LaunchScopeConfirm
            title={t("customization.confirmTitle")}
            hint={t("customization.confirmHint")}
            groupsLabel={t("customization.scopeGroupsLabel")}
            groupsValue={
              selectedScopeGroups.length > 0
                ? selectedScopeGroups.map((g) => g.name).join(" · ")
                : "—"
            }
            anchorLabel={t("customization.scopeAnchorLabel")}
            anchorValue={anchorLabel}
            nameLabel={t("customization.scopeNameLabel")}
            nameValue={portfolioName}
            confirmLabel={t("customization.confirmContinue")}
            editLabel={t("customization.editScope")}
            onConfirm={onScopeConfirm}
            onEdit={() => setScopeEditorsOpen(true)}
          />
        ) : null}

        {activeClient &&
        phase === "overlay" &&
        (!launchedFromDashboard || scopeEditorsOpen) ? (
          <>
            <CustomizationScopePanel
              client={activeClient}
              selectedGroupIds={scopeGroupIds}
              onSelectedGroupIdsChange={setScopeGroupIds}
              portfolioName={portfolioName}
              onPortfolioNameChange={setPortfolioName}
            />
            {launchedFromDashboard ? (
              <div className="flex justify-end">
                <button
                  type="button"
                  className="ui-hint text-[var(--primary)] hover:underline"
                  onClick={() => setScopeEditorsOpen(false)}
                >
                  {t("customization.collapseScope")}
                </button>
              </div>
            ) : null}
          </>
        ) : null}

        {phase === "overlay" &&
        !(
          activeClient &&
          launchedFromDashboard &&
          !scopeEditorsOpen &&
          !scopeConfirmed
        ) ? (
          <div className="space-y-3">
            <OverlayContextSummary
              groups={scopeGroups}
              selectedGroupIds={scopeGroupIds}
              onSelectedGroupIdsChange={setScopeGroupIds}
              anchorId={anchorPortfolioId}
              anchorLabel={anchorLabel}
              anchorHoldings={anchorPositions}
              anchorOptions={overlayAnchorOptions}
              onAnchorChange={onOverlayAnchorChange}
              asOfDate={activeClient?.as_of_date}
            />
            <OverlayConversationPanel
              baseScenarioId={`anchor-${anchorPortfolioId}`}
              clientRef={activeClient?.client_id}
              customizationDrift={request?.customization_drift ?? 0.5}
              onRaiseDrift={(drift) => {
                setRequest((prev) => ({
                  ...(prev ?? buildDefaultRequest()),
                  customization_drift: drift,
                }));
              }}
              onConfirm={onOverlayConfirm}
              selectedGroups={selectedScopeGroups}
              anchorPositions={anchorPositions}
              anchorLabel={anchorLabel}
              initialMessages={overlayMessages}
              onMessagesChange={setOverlayMessages}
              initialOverlay={overlaySession}
              onOverlayChange={setOverlaySession}
            />
            <button
              type="button"
              onClick={onSkipOverlay}
              className="pixel-btn w-full border border-[var(--border)] bg-white text-sm text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
            >
              {t("overlay.skipToConfig")}
            </button>
          </div>
        ) : null}

        {phase === "constraints" && request && (
          signedOverlay ? (
            <RmRunPanel
              overlay={signedOverlay}
              anchorPortfolio={anchorPortfolio}
              request={request}
              onChange={setRequest}
              onRun={onRun}
              apiOnline={apiOnline}
              emailNotificationsEnabled={emailNotificationsEnabled}
              driftSyncNotice={driftSyncNotice}
              onDismissDriftSyncNotice={() => setDriftSyncNotice(null)}
            />
          ) : (
            <ConstraintsPanel
              value={request}
              onChange={setRequest}
              onRun={onRun}
              apiOnline={apiOnline}
              emailNotificationsEnabled={emailNotificationsEnabled}
            />
          )
        )}

        {phase === "running" && signedOverlay && anchorProgress && progress ? (
          <DualProgressPanel
            anchorProgress={anchorProgress}
            customizedProgress={progress}
          />
        ) : (
          phase === "running" && progress && <ProgressPanel progress={progress} />
        )}

        {phase === "results" && result && request && (
          personalizationCompare ? (
            <RmReportView
              compare={personalizationCompare}
              overlay={signedOverlay}
              anchorPortfolio={anchorPortfolio}
              client={activeClient}
              result={result}
              narrative={narrative}
              request={request}
              onRerun={() => {
                setDriftSyncNotice(null);
                setPhase("overlay");
              }}
              onExport={() => downloadCsv(result, "portfolio")}
              onQuickTweak={onQuickTweak}
              onQuickTweakAndRun={onQuickTweakAndRun}
              onContinueRefinement={onContinueRefinement}
              continueLoading={continueLoading}
              onPromoteTickers={onPromoteTickers}
            />
          ) : (
          <>
            <OptimizationObjectiveBanner
              request={request}
              narrativeFacts={result.narrative_facts}
            />
            <ResultsWithAuditTabs
              result={result}
              request={request}
              overlay={signedOverlay}
            >
              {result.pro_rounds && result.pro_rounds.length > 0 ? (
                <ProResultsWithTabs
                  result={result}
                  narrative={narrative}
                  request={request}
                  onRerun={() => {
                    setPhase("constraints");
                  }}
                  onExport={() => downloadCsv(result, "portfolio")}
                  onQuickTweak={onQuickTweak}
                  onQuickTweakAndRun={onQuickTweakAndRun}
                  onContinueRefinement={onContinueRefinement}
                  continueLoading={continueLoading}
                  showRunObjectiveBanner={false}
                  onPromoteTickers={onPromoteTickers}
                />
              ) : (
                <ResultsDashboard
                  result={result}
                  narrative={narrative}
                  request={request}
                  onRerun={() => {
                    setPhase("constraints");
                  }}
                  onExport={() => downloadCsv(result, "portfolio")}
                  onQuickTweak={onQuickTweak}
                  onQuickTweakAndRun={onQuickTweakAndRun}
                  onContinueRefinement={onContinueRefinement}
                  continueLoading={continueLoading}
                  showRunObjectiveBanner={false}
                  onPromoteTickers={onPromoteTickers}
                />
              )}
            </ResultsWithAuditTabs>
          </>
          )
        )}
      </main>
    </div>
  );
}

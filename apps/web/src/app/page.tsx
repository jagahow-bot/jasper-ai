"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnchorPortfolioSelector } from "@/components/AnchorPortfolioSelector";
import { BacktestHistoryPanel } from "@/components/BacktestHistoryPanel";
import { BenchmarkComparePanel } from "@/components/BenchmarkComparePanel";
import { ChatLog, type ChatMessage } from "@/components/ChatLog";
import { FontSizeControl } from "@/components/FontSizeControl";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ConstraintsPanel } from "@/components/ConstraintsPanel";
import { LiveStatusCard } from "@/components/LiveStatusCard";
import { OverlayConversationPanel } from "@/components/OverlayConversationPanel";
import { DualProgressPanel } from "@/components/DualProgressPanel";
import { ProgressPanel } from "@/components/ProgressPanel";
import { ProResultsWithTabs } from "@/components/ProResultsWithTabs";
import { ResultsDashboard } from "@/components/ResultsDashboard";
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
import { DEFAULT_ASSET_CLASSES } from "@/lib/constants";
import { buildJobNarrativeFacts } from "@/lib/narrative-slim";
import { resolveChampionCandidateIndex } from "@/lib/performance-compare-chart";
import { getUniverseMeta } from "@/lib/universe";
import { useI18n } from "@/lib/i18n";
import { translateProgress } from "@/lib/progress-i18n";
import {
  buildAnchorBacktestRequest,
  getAnchorPortfolioById,
  getCustomizedVsAnchorLabel,
  getPortfolioLabel,
  SPY_ANCHOR,
  SPY_ANCHOR_ID,
  type ModelPortfolio,
} from "@/lib/model-portfolios";
import { resolveResultBenchmarkTicker } from "@/lib/resolve-result-benchmark";
import {
  overlayToBacktestRequest,
  type ClientOverlay,
} from "@/lib/overlay-schema";
import type {
  BacktestRequest,
  BacktestResult,
  JobProgress,
  PersonalizationCompare,
  WizardPhase,
} from "@/lib/types";

function pushMessage(
  set: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  role: ChatMessage["role"],
  content: string,
) {
  set((prev) => [
    ...prev,
    { id: crypto.randomUUID(), role, content },
  ]);
}

function buildDefaultRequest(): BacktestRequest {
  return {
    scenario_id: "custom",
    max_weight: 0.5,
    min_weight: 0.005,
    objective: "max_sharpe",
    regime_adaptive: false,
    backtest_mode: "static",
    start_date: "2018-01-01",
    end_date: "2024-12-31",
    trials: 50,
    top_models: 5,
    asset_classes: [...DEFAULT_ASSET_CLASSES],
    enable_oos: true,
    train_ratio: 0.7,
    fee_bps: 10,
    rebalance_freq: "QE",
    max_holdings: 30,
    max_turnover: 1.0,
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
  const [phase, setPhase] = useState<WizardPhase>("anchor");
  const [anchorPortfolioId, setAnchorPortfolioId] = useState(SPY_ANCHOR_ID);
  const [signedOverlay, setSignedOverlay] = useState<ClientOverlay | null>(null);
  const [personalizationCompare, setPersonalizationCompare] =
    useState<PersonalizationCompare | null>(null);
  const [request, setRequest] = useState<BacktestRequest | null>(
    buildDefaultRequest(),
  );
  const [, setJobId] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [historyLoadingId, setHistoryLoadingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [anchorProgress, setAnchorProgress] = useState<JobProgress | null>(null);
  const [statusFeed, setStatusFeed] = useState<string[]>([]);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [narrative, setNarrative] = useState("");
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [emailNotificationsEnabled, setEmailNotificationsEnabled] = useState<
    boolean | null
  >(null);
  const [continueLoading, setContinueLoading] = useState(false);
  const universeMeta = useMemo(() => getUniverseMeta(), []);

  const anchorPortfolio = useMemo(
    () => getAnchorPortfolioById(anchorPortfolioId) ?? SPY_ANCHOR,
    [anchorPortfolioId],
  );

  const syncRequestFromAnchor = useCallback(
    (portfolio: ModelPortfolio = anchorPortfolio) => {
      setRequest(buildAnchorBacktestRequest(portfolio, buildDefaultRequest()));
    },
    [anchorPortfolio],
  );

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: t("chat.welcome", { count: universeMeta.count }),
    },
  ]);
  const lastProgressMsg = useRef("");
  const lastRoundRef = useRef(0);

  useEffect(() => {
    void fetchApiHealth().then((health) => {
      setApiOnline(health?.status === "ok");
      setEmailNotificationsEnabled(
        health?.email_notifications === "configured" ? true : health ? false : null,
      );
    });
  }, []);

  // Keep the initial welcome line in the active language. The messages state is
  // seeded once (before the stored locale loads), so re-localize it whenever the
  // language changes while it's still the untouched welcome message.
  useEffect(() => {
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === "welcome"
          ? { ...msg, content: t("chat.welcome", { count: universeMeta.count }) }
          : msg,
      ),
    );
  }, [lang, t, universeMeta.count]);

  const presentResult = useCallback(
    async (
      id: string,
      res: BacktestResult,
      req: BacktestRequest,
      compare?: PersonalizationCompare | null,
    ) => {
      recordCompletedBacktest(id, req, res);
      setActiveJobId(id);
      setJobId(id);
      setRequest(req);
      setResult(res);
      setPersonalizationCompare(compare ?? null);
      const championIdx = resolveChampionCandidateIndex(
        res.candidates,
        res.narrative_facts,
      );
      const champion =
        championIdx >= 0 ? res.candidates[championIdx] : res.candidates[0];
      // Job-level narrative is generated reactively (see effect below) so it
      // regenerates in the active language when the user switches locale.
      setNarrative("");
      setPhase("results");
      const best = champion ?? res.candidates[0];
      const bm = resolveResultBenchmarkTicker(req, res.narrative_facts);
      pushMessage(
        setMessages,
        "assistant",
        t("chat.complete", {
          model: best.model_code ?? "M?",
          benchmark: bm,
          sharpe: best.sharpe,
          mdd: (best.max_drawdown * 100).toFixed(2),
          cagr: (best.cagr * 100).toFixed(2),
        }),
      );
    },
    [t],
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
        const narrJson = (await narrRes.json()) as { narrative: string };
        if (!cancelled) setNarrative(narrJson.narrative);
      } catch {
        /* keep prior narrative on failure */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [result, lang]);

  const pollJob = useCallback(
    async (id: string) => {
      const prog = await getJobProgress(id);
      setProgress(prog);
      // Live progress goes to the prominent status card (not the chat log) so
      // long runs don't flood the conversation with one line per trial. Only
      // round transitions are surfaced as chat milestones.
      if (prog.status === "running" && prog.message) {
        if (prog.message !== lastProgressMsg.current) {
          lastProgressMsg.current = prog.message;
          setStatusFeed((prev) => [prog.message, ...prev].slice(0, 12));
        }
        const round = prog.refinement_round ?? 0;
        if (round > lastRoundRef.current) {
          lastRoundRef.current = round;
          if (round > 1) {
            pushMessage(setMessages, "assistant", translateProgress(prog.message, t));
          }
        }
      }
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
        pushMessage(setMessages, "system", prog.message);
        setPhase("constraints");
        return true;
      }
      return false;
    },
    [presentResult, request, t],
  );

  const loadHistoricalJob = useCallback(
    async (id: string) => {
      setHistoryLoadingId(id);
      try {
        const local = findLocalHistoryEntry(id);
        if (local?.result && local.request) {
          pushMessage(setMessages, "user", t("chat.loadHistory", { id: id.slice(0, 8) }));
          await presentResult(id, local.result, local.request);
          return;
        }

        try {
          const prog = await getJobProgress(id);
          if (prog.status !== "completed") {
            pushMessage(
              setMessages,
              "system",
              t("chat.jobNotCompleted", { id: id.slice(0, 8), status: prog.status }),
            );
            return;
          }
          const [res, req] = await Promise.all([getJobResult(id), getJobRequest(id)]);
          pushMessage(setMessages, "user", t("chat.loadHistory", { id: id.slice(0, 8) }));
          await presentResult(id, res, req);
        } catch {
          if (local?.result && local.request) {
            pushMessage(
              setMessages,
              "user",
              t("chat.loadHistoryLocal", { id: id.slice(0, 8) }),
            );
            await presentResult(id, local.result, local.request);
            return;
          }
          throw new Error(t("chat.jobNotFound"));
        }
      } catch (e) {
        pushMessage(
          setMessages,
          "system",
          e instanceof Error ? e.message : t("chat.historyLoadFailed"),
        );
      } finally {
        setHistoryLoadingId(null);
      }
    },
    [presentResult, t],
  );

  // Deep link from notification emails: /?job=<id> auto-loads that job's
  // results on first mount so recipients land straight on their report.
  const deepLinkLoaded = useRef(false);
  useEffect(() => {
    if (deepLinkLoaded.current) return;
    if (typeof window === "undefined") return;
    const jobParam = new URLSearchParams(window.location.search).get("job");
    if (!jobParam) return;
    deepLinkLoaded.current = true;
    void loadHistoricalJob(jobParam);
  }, [loadHistoricalJob]);

  const runBacktest = useCallback(
    async (reqOverride?: BacktestRequest) => {
      const req = reqOverride ?? request;
      if (!req) return;

      setRequest(req);
      setPhase("running");
      setResult(null);
      setNarrative("");
      setPersonalizationCompare(null);
      setStatusFeed([]);
      setAnchorProgress(null);
      lastProgressMsg.current = "";
      lastRoundRef.current = 0;

      try {
        const { job_id } = await createJob({
          ...req,
          experiment: undefined,
          report_language: lang,
        });
        setJobId(job_id);
        setActiveJobId(job_id);

        let done = false;
        while (!done) {
          done = await pollJob(job_id);
          if (!done) await new Promise((r) => setTimeout(r, 400));
        }
      } catch (e) {
        pushMessage(
          setMessages,
          "system",
          e instanceof Error ? e.message : t("chat.runFailed"),
        );
        setPhase("constraints");
      }
    },
    [pollJob, request, t, lang],
  );

  const runPersonalizationBacktest = useCallback(
    async (reqOverride?: BacktestRequest) => {
      const anchor = getAnchorPortfolioById(anchorPortfolioId) ?? SPY_ANCHOR;
      const baseReq = buildAnchorBacktestRequest(
        anchor,
        reqOverride ?? request ?? buildDefaultRequest(),
      );
      const adjustedReq = signedOverlay
        ? overlayToBacktestRequest(baseReq, signedOverlay, {
            scenarioId: `customized-${signedOverlay.audit.session_id}`,
            reportLanguage: lang,
          })
        : baseReq;

      setRequest(adjustedReq);
      setPhase("running");
      setResult(null);
      setNarrative("");
      setPersonalizationCompare(null);
      setStatusFeed([]);
      setAnchorProgress(null);
      lastProgressMsg.current = "";
      lastRoundRef.current = 0;

      const anchorLabel = getPortfolioLabel(anchor, lang);
      const customizedLabel = getCustomizedVsAnchorLabel(anchor, lang);
      pushMessage(
        setMessages,
        "assistant",
        lang === "zh"
          ? `執行雙軌回測：基準「${anchorLabel}」vs「${customizedLabel}」。`
          : lang === "ko"
            ? `이중 백테스트 실행: 기준「${anchorLabel}」vs「${customizedLabel}」.`
            : `Running dual backtest: anchor "${anchorLabel}" vs "${customizedLabel}".`,
      );

      try {
        // Run anchor (static replay) first so customized Optuna does not overlap peak RAM on API.
        const baseJob = await createJob({
          ...baseReq,
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

        const adjustedJob = await createJob({
          ...adjustedReq,
          experiment: undefined,
          report_language: lang,
        });
        const initialCustomProg = await getJobProgress(adjustedJob.job_id);
        setProgress(initialCustomProg);
        setJobId(adjustedJob.job_id);
        setActiveJobId(adjustedJob.job_id);

        let adjustedDone = false;
        let adjustedFailed = false;

        while (!adjustedDone) {
          const prog = await getJobProgress(adjustedJob.job_id);
          setProgress(prog);
          if (prog.status === "running" && prog.message) {
            if (prog.message !== lastProgressMsg.current) {
              lastProgressMsg.current = prog.message;
              setStatusFeed((prev) => [prog.message, ...prev].slice(0, 12));
            }
          }
          if (prog.status === "completed") adjustedDone = true;
          if (prog.status === "failed") {
            adjustedFailed = true;
            adjustedDone = true;
            pushMessage(setMessages, "system", prog.message);
          }
          if (!adjustedDone) await new Promise((r) => setTimeout(r, 400));
        }

        if (adjustedFailed) {
          setPhase("constraints");
          return;
        }

        const [baseRes, adjustedRes, baseReqStored, adjustedReqStored] =
          await Promise.all([
            getJobResult(baseJob.job_id),
            getJobResult(adjustedJob.job_id),
            getJobRequest(baseJob.job_id).catch(() => baseReq),
            getJobRequest(adjustedJob.job_id).catch(() => adjustedReq),
          ]);

        const compare: PersonalizationCompare = {
          anchorPortfolioId: anchor.id,
          anchorLabel,
          customizedLabel,
          baseResult: baseRes,
          baseRequest: baseReqStored,
          adjustedResult: adjustedRes,
          adjustedRequest: adjustedReqStored,
        };

        if (baseFailed) {
          pushMessage(
            setMessages,
            "system",
            lang === "zh"
              ? "基準回測失敗，僅顯示客製化結果。"
              : "Anchor backtest failed; showing customized result only.",
          );
          await presentResult(adjustedJob.job_id, adjustedRes, adjustedReqStored, null);
          return;
        }

        recordCompletedBacktest(baseJob.job_id, baseReqStored, baseRes);
        await presentResult(
          adjustedJob.job_id,
          adjustedRes,
          adjustedReqStored,
          compare,
        );
      } catch (e) {
        pushMessage(
          setMessages,
          "system",
          e instanceof Error ? e.message : t("chat.runFailed"),
        );
        setPhase("constraints");
      }
    },
    [
      anchorPortfolioId,
      signedOverlay,
      request,
      lang,
      presentResult,
      t,
    ],
  );

  const onRun = useCallback(() => {
    const isPro = request?.optimization_mode === "pro_auto";
    pushMessage(
      setMessages,
      "user",
      isPro ? t("chat.userRunPro") : t("chat.userRunStandard"),
    );
    pushMessage(
      setMessages,
      "assistant",
      isPro ? t("chat.ackPro") : t("chat.ackStandard"),
    );
    if (signedOverlay) {
      void runPersonalizationBacktest();
    } else {
      void runBacktest();
    }
  }, [runBacktest, runPersonalizationBacktest, request?.optimization_mode, signedOverlay, t]);

  const onAnchorSelect = useCallback((portfolio: ModelPortfolio) => {
    setAnchorPortfolioId(portfolio.id);
    syncRequestFromAnchor(portfolio);
  }, [syncRequestFromAnchor]);

  const onAnchorContinue = useCallback(() => {
    const label = getPortfolioLabel(anchorPortfolio, lang);
    pushMessage(
      setMessages,
      "user",
      lang === "zh"
        ? `選擇基準配置：${label}`
        : lang === "ko"
          ? `기준 구성 선택: ${label}`
          : `Selected anchor: ${label}`,
    );
    pushMessage(
      setMessages,
      "assistant",
      lang === "zh"
        ? "請以自然語言描述客戶需求，JASPER 將產出客製化配置草案。"
        : lang === "ko"
          ? "고객 니즈를 자연어로 설명해 주세요. JASPER가 맞춤 구성 초안을 만듭니다."
          : "Describe client needs in natural language; JASPER will draft a customized configuration.",
    );
    syncRequestFromAnchor();
    setPhase("overlay");
  }, [anchorPortfolio, lang, syncRequestFromAnchor]);

  const onOverlayConfirm = useCallback(
    (overlay: ClientOverlay) => {
      setSignedOverlay(overlay);
      const base = buildAnchorBacktestRequest(
        anchorPortfolio,
        request ?? buildDefaultRequest(),
      );
      setRequest(
        overlayToBacktestRequest(base, overlay, {
          scenarioId: `customized-${overlay.audit.session_id}`,
          reportLanguage: lang,
        }),
      );
      pushMessage(
        setMessages,
        "assistant",
        lang === "zh"
          ? "Overlay 已簽核。可檢視回測設定後執行「基準 vs 客製化」雙軌回測。"
          : "Overlay signed off. Review setup, then run the anchor vs customized dual backtest.",
      );
      setPhase("constraints");
    },
    [anchorPortfolio, request, lang],
  );

  const onSkipOverlay = useCallback(() => {
    setSignedOverlay(null);
    syncRequestFromAnchor();
    setPhase("constraints");
  }, [syncRequestFromAnchor]);

  const onQuickTweak = useCallback(
    (next: BacktestRequest, label: string) => {
      setRequest(next);
      pushMessage(setMessages, "user", t("chat.tweak", { label }));
      pushMessage(setMessages, "assistant", t("chat.tweakApplied"));
    },
    [t],
  );

  const onQuickTweakAndRun = useCallback(
    (next: BacktestRequest, label: string) => {
      pushMessage(setMessages, "user", t("chat.tweakRerun", { label }));
      pushMessage(setMessages, "assistant", t("chat.ackRerun"));
      if (signedOverlay) {
        void runPersonalizationBacktest(next);
      } else {
        void runBacktest(next);
      }
    },
    [runBacktest, runPersonalizationBacktest, signedOverlay, t],
  );

  const onContinueRefinement = useCallback(
    async (options: {
      extraRefinementRounds: number;
      extraTrialsPerRound: number;
      extraTrials?: number;
    }) => {
      if (!result?.job_id) return;
      setContinueLoading(true);
      pushMessage(setMessages, "user", t("chat.continueRefinementUser"));
      pushMessage(setMessages, "assistant", t("chat.continueRefinementAck"));
      setPhase("running");
      setResult(null);
      setNarrative("");
      setStatusFeed([]);
      lastProgressMsg.current = "";
      lastRoundRef.current = 0;
      try {
        const { job_id, continued_from } = await continueJob(result.job_id, {
          extra_refinement_rounds: options.extraRefinementRounds,
          extra_trials_per_round: options.extraTrialsPerRound,
          extra_trials: options.extraTrials ?? null,
        });
        const priorReq = await getJobRequest(continued_from);
        setRequest(priorReq);
        setJobId(job_id);
        setActiveJobId(job_id);
        let done = false;
        while (!done) {
          done = await pollJob(job_id);
          if (!done) await new Promise((r) => setTimeout(r, 400));
        }
      } catch (e) {
        pushMessage(
          setMessages,
          "system",
          e instanceof Error ? e.message : t("chat.runFailed"),
        );
        setPhase("constraints");
      } finally {
        setContinueLoading(false);
      }
    },
    [pollJob, result?.job_id, t],
  );

  const header = useMemo(() => {
    const labels: Record<WizardPhase, string> = {
      scenario: t("header.phase.scenario"),
      anchor: t("header.phase.anchor"),
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
      <header className="sticky top-0 z-40 border-b-2 border-[var(--border)] bg-[var(--surface)] shadow-[0_4px_24px_rgba(0,0,0,0.45)]">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6 sm:py-4">
          <div className="min-w-0">
            <h1 className="font-pixel text-sm glow-title text-neon md:text-base">
              JASPER.AI
            </h1>
            <p className="mt-1 font-terminal text-lg text-[var(--cyan)]">
              {`> ${header}`}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <LanguageSwitcher />
            <FontSizeControl />
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
            <span className="pixel-badge">
              {t("header.etfs", { count: universeMeta.count })}
            </span>
            <a
              href="/lab/objective-switch"
              className="pixel-badge pixel-badge-link"
            >
              {t("header.objectiveLab")}
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[360px_1fr]">
        <aside className="pixel-panel pixel-panel-cyan flex h-[calc(100vh-120px)] flex-col">
          <h2 className="mb-3 shrink-0 font-pixel text-[9px] text-[var(--cyan)]">
            {t("header.terminalLog")}
          </h2>
          {phase === "running" && progress && (
            <LiveStatusCard progress={progress} feed={statusFeed} />
          )}
          <div className="min-h-0 flex-1">
            <ChatLog messages={messages} />
          </div>
          <BacktestHistoryPanel
            activeJobId={activeJobId}
            loadingJobId={historyLoadingId}
            onLoad={(id) => void loadHistoricalJob(id)}
          />
        </aside>

        <section className="space-y-5">
          {phase === "anchor" && (
            <AnchorPortfolioSelector
              selectedId={anchorPortfolioId}
              onSelect={onAnchorSelect}
              onContinue={onAnchorContinue}
            />
          )}

          {phase === "overlay" && (
            <div className="space-y-3">
              <OverlayConversationPanel
                baseScenarioId={`anchor-${anchorPortfolioId}`}
                onConfirm={onOverlayConfirm}
              />
              <button
                type="button"
                onClick={onSkipOverlay}
                className="pixel-btn w-full border-[var(--border)] bg-transparent text-sm opacity-80 hover:opacity-100"
              >
                {t("overlay.skipToConfig")}
              </button>
            </div>
          )}

          {phase === "constraints" && request && (
            <>
              {signedOverlay && (
                <div className="pixel-panel border-[var(--neon-dim)] bg-[rgba(57,255,20,0.04)] p-3 text-sm">
                  <p className="font-pixel text-[10px] text-neon">
                    {getCustomizedVsAnchorLabel(anchorPortfolio, lang)}
                  </p>
                  <p className="mt-2 text-dim">
                    {lang === "zh"
                      ? "已簽核客戶需求摘要。執行回測將並列比較基準與客製化配置。"
                      : lang === "ko"
                        ? "고객 니즈 요약 서명 완료. 백테스트 시 기준과 맞춤 구성을 병렬 비교합니다."
                        : "Client overlay signed off. Run will compare anchor and customized portfolios side by side."}
                  </p>
                </div>
              )}
              <ConstraintsPanel
                value={request}
                onChange={setRequest}
                onRun={onRun}
                apiOnline={apiOnline}
                emailNotificationsEnabled={emailNotificationsEnabled}
              />
            </>
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
            <>
              {personalizationCompare && (
                <BenchmarkComparePanel
                  anchorLabel={personalizationCompare.anchorLabel}
                  customizedLabel={personalizationCompare.customizedLabel}
                  baseResult={personalizationCompare.baseResult}
                  adjustedResult={personalizationCompare.adjustedResult}
                />
              )}
              {result.pro_rounds && result.pro_rounds.length > 0 ? (
              <ProResultsWithTabs
                result={result}
                narrative={narrative}
                request={request}
                onRerun={() => {
                  setPhase("constraints");
                  pushMessage(setMessages, "user", t("chat.backToConfig"));
                }}
                onExport={() => downloadCsv(result, "portfolio")}
                onQuickTweak={onQuickTweak}
                onQuickTweakAndRun={onQuickTweakAndRun}
                onContinueRefinement={onContinueRefinement}
                continueLoading={continueLoading}
              />
            ) : (
              <ResultsDashboard
                result={result}
                narrative={narrative}
                request={request}
                onRerun={() => {
                  setPhase("constraints");
                  pushMessage(setMessages, "user", t("chat.backToConfig"));
                }}
                onExport={() => downloadCsv(result, "portfolio")}
                onQuickTweak={onQuickTweak}
                onQuickTweakAndRun={onQuickTweakAndRun}
                onContinueRefinement={onContinueRefinement}
                continueLoading={continueLoading}
              />
            )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}

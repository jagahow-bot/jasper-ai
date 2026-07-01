"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BacktestHistoryPanel } from "@/components/BacktestHistoryPanel";
import { ChatLog, type ChatMessage } from "@/components/ChatLog";
import { FontSizeControl } from "@/components/FontSizeControl";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ConstraintsPanel } from "@/components/ConstraintsPanel";
import { ProgressPanel } from "@/components/ProgressPanel";
import { ProResultsWithTabs } from "@/components/ProResultsWithTabs";
import { ResultsDashboard } from "@/components/ResultsDashboard";
import {
  checkApiHealth,
  createJob,
  downloadCsv,
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
import type {
  BacktestRequest,
  BacktestResult,
  JobProgress,
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
    top_n: 50,
    max_holdings: 30,
    max_turnover: 1.0,
    objective_custom_text: "",
    param_controls: {},
    optimization_mode: "standard",
    enable_iterative_refinement: false,
    refinement_batch_size: 5,
    refinement_challengers_per_round: 4,
    refinement_max_rounds: 8,
    refinement_patience: 2,
    refinement_min_improvement: 0.01,
  };
}

export default function HomePage() {
  const { t } = useI18n();
  const [phase, setPhase] = useState<WizardPhase>("constraints");
  const [request, setRequest] = useState<BacktestRequest | null>(
    buildDefaultRequest(),
  );
  const [, setJobId] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [historyLoadingId, setHistoryLoadingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [narrative, setNarrative] = useState("");
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const universeMeta = useMemo(() => getUniverseMeta(), []);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: t("chat.welcome", { count: universeMeta.count }),
    },
  ]);
  const lastProgressMsg = useRef("");

  useEffect(() => {
    void checkApiHealth().then(setApiOnline);
  }, []);

  const presentResult = useCallback(
    async (id: string, res: BacktestResult, req: BacktestRequest) => {
      recordCompletedBacktest(id, req, res);
      setActiveJobId(id);
      setJobId(id);
      setRequest(req);
      setResult(res);
      const championIdx = resolveChampionCandidateIndex(
        res.candidates,
        res.narrative_facts,
      );
      const champion =
        championIdx >= 0 ? res.candidates[championIdx] : res.candidates[0];
      const narrFacts = champion
        ? buildJobNarrativeFacts(res.narrative_facts, champion)
        : res.narrative_facts;
      const narrRes = await fetch("/api/narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facts: narrFacts }),
      });
      const narrJson = (await narrRes.json()) as { narrative: string };
      setNarrative(narrJson.narrative);
      setPhase("results");
      const best = champion ?? res.candidates[0];
      const bm = String(
        (res.narrative_facts.backtest_spec as { benchmark?: string } | undefined)
          ?.benchmark ?? "SPY",
      );
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

  const pollJob = useCallback(
    async (id: string) => {
      const prog = await getJobProgress(id);
      setProgress(prog);
      if (
        prog.message &&
        prog.message !== lastProgressMsg.current &&
        prog.status === "running"
      ) {
        lastProgressMsg.current = prog.message;
        pushMessage(setMessages, "assistant", prog.message);
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
    [presentResult, request],
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

  const runBacktest = useCallback(
    async (reqOverride?: BacktestRequest) => {
      const req = reqOverride ?? request;
      if (!req) return;

      setRequest(req);
      setPhase("running");
      setResult(null);
      setNarrative("");
      lastProgressMsg.current = "";

      try {
        const { job_id } = await createJob({ ...req, experiment: undefined });
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
    [pollJob, request, t],
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
    void runBacktest();
  }, [runBacktest, request?.optimization_mode, t]);

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
      void runBacktest(next);
    },
    [runBacktest, t],
  );

  const header = useMemo(() => {
    const labels: Record<WizardPhase, string> = {
      scenario: t("header.phase.scenario"),
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
          {phase === "constraints" && request && (
            <>
              <ConstraintsPanel
                value={request}
                onChange={setRequest}
                onRun={onRun}
                apiOnline={apiOnline}
              />
            </>
          )}

          {phase === "running" && progress && <ProgressPanel progress={progress} />}

          {phase === "results" && result && request && (
            result.pro_rounds && result.pro_rounds.length > 0 ? (
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
              />
            )
          )}
        </section>
      </main>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatLog, type ChatMessage } from "@/components/ChatLog";
import { ConstraintsPanel } from "@/components/ConstraintsPanel";
import { ProgressPanel } from "@/components/ProgressPanel";
import { ProResultsWithTabs } from "@/components/ProResultsWithTabs";
import { ResultsDashboard } from "@/components/ResultsDashboard";
import {
  checkApiHealth,
  createJob,
  downloadCsv,
  getJobProgress,
  getJobResult,
} from "@/lib/api";
import { DEFAULT_ASSET_CLASSES } from "@/lib/constants";
import { getUniverseMeta } from "@/lib/universe";
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
    overfitting_penalty_weight: 0.5,
  };
}

export default function HomePage() {
  const [phase, setPhase] = useState<WizardPhase>("constraints");
  const [request, setRequest] = useState<BacktestRequest | null>(
    buildDefaultRequest(),
  );
  const [, setJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [narrative, setNarrative] = useState("");
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const universeMeta = useMemo(() => getUniverseMeta(), []);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: `QUANT_OS online. Universe: ${universeMeta.count} ETFs. Configure params below — each rebalance runs factor screen (Top N) then allocator (MPT / min-var).`,
    },
  ]);
  const lastProgressMsg = useRef("");

  useEffect(() => {
    void checkApiHealth().then(setApiOnline);
  }, []);

  const pollJob = useCallback(async (id: string) => {
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
      setResult(res);
      const narrRes = await fetch("/api/narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facts: res.narrative_facts }),
      });
      const narrJson = (await narrRes.json()) as { narrative: string };
      setNarrative(narrJson.narrative);
      setPhase("results");
      const best = res.candidates[0];
      const bm = String(
        (res.narrative_facts.backtest_spec as { benchmark?: string } | undefined)
          ?.benchmark ?? "SPY",
      );
      pushMessage(
        setMessages,
        "assistant",
        `Backtest complete. Best by objective: ${best.model_code ?? "M?"} (vs ${bm}) — Sharpe ${best.sharpe}, max DD ${(best.max_drawdown * 100).toFixed(2)}%, CAGR ${(best.cagr * 100).toFixed(2)}%. Switch model codes in the results panel.`,
      );
      return true;
    }
    if (prog.status === "failed") {
      pushMessage(setMessages, "system", prog.message);
      setPhase("constraints");
      return true;
    }
    return false;
  }, []);

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
        const { job_id } = await createJob(req);
        setJobId(job_id);

        let done = false;
        while (!done) {
          done = await pollJob(job_id);
          if (!done) await new Promise((r) => setTimeout(r, 400));
        }
      } catch (e) {
        pushMessage(
          setMessages,
          "system",
          e instanceof Error ? e.message : "Backtest failed",
        );
        setPhase("constraints");
      }
    },
    [pollJob, request],
  );

  const onRun = useCallback(() => {
    const isPro = request?.optimization_mode === "pro_auto";
    pushMessage(
      setMessages,
      "user",
      isPro ? "Run Pro auto-convergence" : "Run standard backtest + optimize",
    );
    pushMessage(
      setMessages,
      "assistant",
      isPro
        ? "ACK — Pro champion-challenger loop starting. Overfitting monitor armed…"
        : "ACK — spinning up quant engine…",
    );
    void runBacktest();
  }, [runBacktest, request?.optimization_mode]);

  const onQuickTweak = useCallback((next: BacktestRequest, label: string) => {
    setRequest(next);
    pushMessage(setMessages, "user", `Tweak: ${label}`);
    pushMessage(
      setMessages,
      "assistant",
      "Params updated. Tweak more or hit ↻ to rerun immediately.",
    );
  }, []);

  const onQuickTweakAndRun = useCallback(
    (next: BacktestRequest, label: string) => {
      pushMessage(setMessages, "user", `Tweak + rerun: ${label}`);
      pushMessage(setMessages, "assistant", "ACK — recomputing with new params…");
      void runBacktest(next);
    },
    [runBacktest],
  );

  const header = useMemo(() => {
    const labels: Record<WizardPhase, string> = {
      scenario: "—",
      constraints: "CONFIG",
      running: "RUNNING",
      results: "RESULTS",
      export: "EXPORT",
    };
    return labels[phase];
  }, [phase]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b-2 border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="font-pixel text-sm glow-title text-neon md:text-base">
              AI Quant Assistant
            </h1>
            <p className="mt-1 font-terminal text-lg text-[var(--cyan)]">
              {`> ${header}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {apiOnline === false && (
              <span
                className="pixel-badge-warn max-w-xs"
                title="Run npm run dev from repo root"
              >
                API offline
              </span>
            )}
            {apiOnline === true && (
              <span className="pixel-badge-cyan">API linked</span>
            )}
            <span className="pixel-badge">
              {universeMeta.count} ETFs
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[360px_1fr]">
        <aside className="pixel-panel pixel-panel-cyan flex h-[calc(100vh-120px)] flex-col">
          <h2 className="mb-3 font-pixel text-[9px] text-[var(--cyan)]">
            Terminal log
          </h2>
          <ChatLog messages={messages} />
        </aside>

        <section className="space-y-5">
          {phase === "constraints" && request && (
            <ConstraintsPanel value={request} onChange={setRequest} onRun={onRun} />
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
                  pushMessage(setMessages, "user", "Back to config panel");
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
                  pushMessage(setMessages, "user", "Back to config panel");
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

"use client";

import { useI18n } from "@/lib/i18n";
import { translateProgress } from "@/lib/progress-i18n";
import type { JobProgress, PortfolioVsBenchmark } from "@/lib/types";

type Props = {
  progress: JobProgress;
  /** Optional section label (e.g. anchor vs customized in dual runs). */
  label?: string;
  /** Bar accent color variant. */
  accent?: "neon" | "cyan";
};

function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return `${Number(value).toFixed(2)}%`;
}

function formatAlpha(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return "—";
  const n = Number(value);
  if (Math.abs(n) <= 2) return `${(n * 100).toFixed(2)}%`;
  return n.toFixed(4);
}

export function ProgressPanel({ progress, label, accent = "neon" }: Props) {
  const { t } = useI18n();
  const belowBench = progress.round_benchmark_status === "below";
  const pvb = progress.round_portfolio_vs_benchmark as PortfolioVsBenchmark | null | undefined;
  const pct =
    progress.trials_total > 0
      ? Math.min(100, (progress.trial / progress.trials_total) * 100)
      : progress.status === "completed"
        ? 100
        : 0;
  const hasTrials = progress.trials_total > 0 && progress.trial > 0;
  const isRunning = progress.status === "running" || progress.status === "pending";
  const barColor = accent === "cyan" ? "bg-[var(--cyan)]" : "bg-[var(--neon)]";
  const titleColor = accent === "cyan" ? "text-[var(--cyan)]" : "text-neon";

  return (
    <div className="pixel-panel space-y-4">
      <div className="flex items-center justify-between">
        <h3 className={`ui-panel-title flex items-center gap-2 glow-title ${titleColor}`}>
          {isRunning && <span className="live-dot" aria-hidden />}
          {label ?? t("progress.running")}
        </h3>
        <span className={`font-terminal text-2xl ${accent === "cyan" ? "text-[var(--cyan)]" : "text-[var(--cyan)]"}`}>
          {Math.round(pct)}%
        </span>
      </div>

      <div
        className={`h-3 overflow-hidden border-2 border-[var(--border)] bg-[#050508] ${
          isRunning ? "live-bar" : ""
        }`}
      >
        <div
          className={`h-full transition-all duration-300 ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="font-terminal text-lg text-[var(--foreground)]">
        {translateProgress(progress.message, t)}
      </p>

      {hasTrials && (
        <p className="ui-hint">
          {t("live.trial", { n: progress.trial, total: progress.trials_total })}
        </p>
      )}

      {belowBench ? (
        <div
          className="border-2 border-[var(--amber)] bg-[rgba(255,176,0,0.12)] p-3"
          role="status"
        >
          <p className="ui-section-title text-[var(--amber)]">
            {t("progress.roundUnderperformed")}
          </p>
          <p className="ui-body mt-1 text-[var(--fg)]">
            {t("progress.roundUnderperformedHint")}
          </p>
          <p className="ui-body mt-2 text-[var(--muted)]">
            {t("progress.portfolioReturn")} {formatPct(pvb?.portfolio_total_return_pct)} · {t("progress.benchmark")}{" "}
            {formatPct(pvb?.benchmark_total_return_pct)} · {t("common.alpha")}{" "}
            {formatAlpha(progress.round_benchmark_alpha ?? pvb?.alpha)}
          </p>
        </div>
      ) : null}

      <div className="ui-hint flex flex-wrap gap-4">
        {progress.refinement_round != null && (
          <span>
            {t("progress.round")} {progress.refinement_round}/{progress.refinement_rounds_total}
          </span>
        )}
        {progress.best_sharpe != null && (
          <span>{t("progress.bestInSample")}: {progress.best_sharpe.toFixed(4)}</span>
        )}
      </div>
    </div>
  );
}

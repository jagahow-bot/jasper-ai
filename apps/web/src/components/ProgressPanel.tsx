"use client";

import { useI18n } from "@/lib/i18n";
import type { JobProgress, PortfolioVsBenchmark } from "@/lib/types";

type Props = {
  progress: JobProgress;
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

export function ProgressPanel({ progress }: Props) {
  const { t } = useI18n();
  const belowBench = progress.round_benchmark_status === "below";
  const pvb = progress.round_portfolio_vs_benchmark as PortfolioVsBenchmark | null | undefined;
  const pct =
    progress.trials_total > 0
      ? Math.min(100, (progress.trial / progress.trials_total) * 100)
      : 0;
  const hasTrials = progress.trials_total > 0 && progress.trial > 0;
  const isRunning = progress.status === "running" || progress.status === "pending";

  return (
    <div className="pixel-panel space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 font-pixel text-xs text-neon glow-title">
          {isRunning && <span className="live-dot" aria-hidden />}
          {t("progress.running")}
        </h3>
        <span className="font-terminal text-2xl text-[var(--cyan)]">
          {Math.round(pct)}%
        </span>
      </div>

      <div
        className={`h-3 overflow-hidden border-2 border-[var(--border)] bg-[#050508] ${
          isRunning ? "live-bar" : ""
        }`}
      >
        <div
          className="h-full bg-[var(--neon)] transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="font-terminal text-lg text-[var(--foreground)]">
        {progress.message}
      </p>

      {hasTrials && (
        <p className="font-terminal text-sm text-dim">
          {t("live.trial", { n: progress.trial, total: progress.trials_total })}
        </p>
      )}

      {belowBench ? (
        <div
          className="border-2 border-[var(--amber)] bg-[rgba(255,176,0,0.12)] p-3"
          role="status"
        >
          <p className="font-pixel text-[9px] text-[var(--amber)]">
            {t("progress.roundUnderperformed")}
          </p>
          <p className="mt-1 font-pixel text-[8px] leading-relaxed text-[var(--fg)]">
            {t("progress.roundUnderperformedHint")}
          </p>
          <p className="mt-2 font-pixel text-[8px] text-[var(--muted)]">
            {t("progress.portfolioReturn")} {formatPct(pvb?.portfolio_total_return_pct)} · {t("progress.benchmark")}{" "}
            {formatPct(pvb?.benchmark_total_return_pct)} · {t("common.alpha")}{" "}
            {formatAlpha(progress.round_benchmark_alpha ?? pvb?.alpha)}
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-4 font-terminal text-sm text-dim">
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

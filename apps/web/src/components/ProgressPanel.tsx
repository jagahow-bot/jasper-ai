"use client";

import {
  OverfittingConvergenceChart,
  type ConvergencePoint,
} from "@/components/OverfittingConvergenceChart";
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
  const preview = (progress.convergence_preview ?? []) as ConvergencePoint[];
  const belowBench = progress.round_benchmark_status === "below";
  const pvb = progress.round_portfolio_vs_benchmark as PortfolioVsBenchmark | null | undefined;
  const pct =
    progress.trials_total > 0
      ? Math.min(100, (progress.trial / progress.trials_total) * 100)
      : 0;

  return (
    <div className="pixel-panel space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-pixel text-xs text-neon glow-title">Engine running</h3>
        <span className="font-terminal text-2xl text-[var(--cyan)]">
          {Math.round(pct)}%
        </span>
      </div>

      <div className="h-3 overflow-hidden border-2 border-[var(--border)] bg-[#050508]">
        <div
          className="h-full bg-[var(--neon)] transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="font-terminal text-lg text-[var(--foreground)]">
        {progress.message}
      </p>

      {belowBench ? (
        <div
          className="border-2 border-[var(--amber)] bg-[rgba(255,176,0,0.12)] p-3"
          role="status"
        >
          <p className="font-pixel text-[9px] text-[var(--amber)]">
            ROUND UNDERPERFORMED BENCHMARK
          </p>
          <p className="mt-1 font-pixel text-[8px] leading-relaxed text-[var(--fg)]">
            Portfolio return trails the benchmark in this sample. Consider wider
            exploration or strategy tweaks next round.
          </p>
          <p className="mt-2 font-pixel text-[8px] text-[var(--muted)]">
            Portfolio return {formatPct(pvb?.portfolio_total_return_pct)} · Benchmark{" "}
            {formatPct(pvb?.benchmark_total_return_pct)} · Alpha{" "}
            {formatAlpha(progress.round_benchmark_alpha ?? pvb?.alpha)}
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-4 font-terminal text-sm text-dim">
        {progress.refinement_round != null && (
          <span>
            Round {progress.refinement_round}/{progress.refinement_rounds_total}
          </span>
        )}
        {progress.best_sharpe != null && (
          <span>Best in-sample: {progress.best_sharpe.toFixed(4)}</span>
        )}
      </div>

      {preview.length > 0 && (
        <OverfittingConvergenceChart
          data={preview}
          title="Live convergence (preview)"
        />
      )}
    </div>
  );
}

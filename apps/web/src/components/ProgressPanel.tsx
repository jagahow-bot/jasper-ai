"use client";

import {
  OverfittingConvergenceChart,
  type ConvergencePoint,
} from "@/components/OverfittingConvergenceChart";
import type { JobProgress } from "@/lib/types";

type Props = {
  progress: JobProgress;
};

export function ProgressPanel({ progress }: Props) {
  const preview = (progress.convergence_preview ?? []) as ConvergencePoint[];
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

"use client";

import { useI18n } from "@/lib/i18n";
import { translateProgress } from "@/lib/progress-i18n";
import type { JobProgress } from "@/lib/types";

type Props = {
  progress: JobProgress;
  /** Recent distinct status lines, newest first. */
  feed: string[];
};

/**
 * Compact, always-visible "live" card pinned above the activity log while a
 * backtest is running. It surfaces the current phase message, progress %, and
 * a short rolling feed of the latest status lines so the user never has to
 * scroll to see what the engine is doing right now.
 */
export function LiveStatusCard({ progress, feed }: Props) {
  const { t } = useI18n();
  const pct =
    progress.trials_total > 0
      ? Math.min(100, (progress.trial / progress.trials_total) * 100)
      : 0;
  const hasTrials = progress.trials_total > 0 && progress.trial > 0;
  const isRunning = progress.status === "running" || progress.status === "pending";

  return (
    <div className="mb-3 shrink-0 border-2 border-[var(--cyan)] bg-[rgba(0,245,255,0.05)] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-pixel text-[9px] text-[var(--cyan)]">
          {isRunning && <span className="live-dot" aria-hidden />}
          {t("live.badge")}
        </span>
        <span className="font-terminal text-xl text-[var(--cyan)]">
          {Math.round(pct)}%
        </span>
      </div>

      <div
        className={`mt-2 h-2 overflow-hidden border border-[var(--border)] bg-[#050508] ${
          isRunning ? "live-bar" : ""
        }`}
      >
        <div
          className="h-full bg-[var(--cyan)] transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="mt-2 font-terminal text-base leading-snug text-[var(--foreground)]">
        {progress.message ? translateProgress(progress.message, t) : t("live.working")}
      </p>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-terminal text-xs text-dim">
        {progress.refinement_round != null && progress.refinement_round > 0 && (
          <span>
            {t("progress.round")} {progress.refinement_round}/
            {progress.refinement_rounds_total}
          </span>
        )}
        {hasTrials && (
          <span>
            {t("live.trial", {
              n: progress.trial,
              total: progress.trials_total,
            })}
          </span>
        )}
        {progress.best_sharpe != null && (
          <span>
            {t("progress.bestInSample")}: {progress.best_sharpe.toFixed(3)}
          </span>
        )}
      </div>

      {feed.length > 1 && (
        <div className="mt-3 border-t border-[var(--border)] pt-2">
          <p className="mb-1 font-pixel text-[8px] text-[var(--text-dim)]">
            {t("live.recentActivity")}
          </p>
          <ul className="space-y-1">
            {feed.slice(1, 5).map((line, i) => {
              const localized = translateProgress(line, t);
              return (
                <li
                  key={`${i}-${line}`}
                  className="truncate font-terminal text-xs text-[var(--text-dim)]"
                  title={localized}
                >
                  <span className="text-[var(--neon-dim)]">· </span>
                  {localized}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

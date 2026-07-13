"use client";

import { objectiveLabel, useI18n } from "@/lib/i18n";
import { resolveRunObjective } from "@/lib/resolve-run-objective";
import type { BacktestRequest } from "@/lib/types";

type Props = {
  request?: Pick<BacktestRequest, "objective"> | null;
  narrativeFacts?: Record<string, unknown> | null;
  /** When set, skips resolveRunObjective and uses this key directly. */
  objectiveKey?: string | null;
  className?: string;
};

export function OptimizationObjectiveBanner({
  request,
  narrativeFacts,
  objectiveKey,
  className = "",
}: Props) {
  const { t } = useI18n();
  const key = objectiveKey ?? resolveRunObjective(request, narrativeFacts);
  const label = objectiveLabel(t, key);
  if (!label) return null;

  return (
    <div
      className={`rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 via-violet-50/80 to-indigo-50 px-5 py-4 shadow-sm ${className}`}
      role="status"
      aria-label={`${t("results.runObjectiveLabel")}: ${label}`}
    >
      <p className="ui-hint text-dim">{t("results.runObjectiveLabel")}</p>
      <p className="mt-1 text-lg font-bold tracking-tight text-indigo-950 sm:text-xl">
        {label}
      </p>
    </div>
  );
}

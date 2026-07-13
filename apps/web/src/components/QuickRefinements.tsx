"use client";

import { QUICK_REFINEMENTS } from "@/lib/refinements";
import { useI18n } from "@/lib/i18n";
import type { BacktestRequest } from "@/lib/types";

type Props = {
  request: BacktestRequest;
  onApply: (next: BacktestRequest, label?: string) => void;
  onApplyAndRun?: (next: BacktestRequest, label: string) => void;
};

export function QuickRefinements({ request, onApply, onApplyAndRun }: Props) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="ui-section-title">{t("quickRefinements.title")}</span>
      {QUICK_REFINEMENTS.map((r) => {
        const label = t(`refinements.${r.id}.label`);
        const description = t(`refinements.${r.id}.desc`);
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onApply(r.apply(request), label)}
            onDoubleClick={() => onApplyAndRun?.(r.apply(request), label)}
            title={`${description}${onApplyAndRun ? ` · ${t("quickRefinements.doubleClickHint")}` : ""}`}
            className="pixel-chip hover:border-[var(--primary)] hover:text-[var(--primary)]"
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

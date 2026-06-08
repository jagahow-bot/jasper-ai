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
      <span className="font-pixel text-[8px] text-dim">{t("quickRefinements.title")}</span>
      {QUICK_REFINEMENTS.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onApply(r.apply(request), r.label)}
          onDoubleClick={() => onApplyAndRun?.(r.apply(request), r.label)}
          title={`${r.description}${onApplyAndRun ? ` · ${t("quickRefinements.doubleClickHint")}` : ""}`}
          className="pixel-chip hover:border-[var(--cyan)] hover:text-[var(--cyan)]"
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

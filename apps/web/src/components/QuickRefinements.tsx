"use client";

import { QUICK_REFINEMENTS } from "@/lib/refinements";
import type { BacktestRequest } from "@/lib/types";

type Props = {
  request: BacktestRequest;
  onApply: (next: BacktestRequest, label?: string) => void;
  onApplyAndRun?: (next: BacktestRequest, label: string) => void;
};

export function QuickRefinements({ request, onApply, onApplyAndRun }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-pixel text-[8px] text-dim">Quick patch</span>
      {QUICK_REFINEMENTS.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onApply(r.apply(request), r.label)}
          onDoubleClick={() => onApplyAndRun?.(r.apply(request), r.label)}
          title={`${r.description}${onApplyAndRun ? " · double-click = rerun" : ""}`}
          className="pixel-chip hover:border-[var(--cyan)] hover:text-[var(--cyan)]"
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

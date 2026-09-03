"use client";

import type { OverlayConflict } from "@/lib/overlay-schema";

type Props = {
  conflict: OverlayConflict;
  onChoose: (optionId: string) => void;
};

/** RM conflict card — never silently half-answer (design §3.4). */
export function OverlayConflictDialog({ conflict, onChoose }: Props) {
  return (
    <div
      role="alertdialog"
      aria-labelledby={`conflict-${conflict.id}-title`}
      className="border border-amber-300 bg-amber-50 p-4 text-slate-900"
    >
      <h3 id={`conflict-${conflict.id}-title`} className="text-base font-medium">
        {conflict.title}
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-700">
        {conflict.explanation}
      </p>
      {conflict.requires_supervisor ? (
        <p className="mt-2 text-xs text-amber-900">
          提高偏離超過 60% 需主管留痕核准。
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {conflict.options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            className="border border-slate-400 bg-white px-3 py-1.5 text-sm hover:bg-slate-100"
            onClick={() => onChoose(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

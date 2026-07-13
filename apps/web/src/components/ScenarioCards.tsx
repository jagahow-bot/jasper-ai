"use client";

import type { ScenarioCard } from "@/lib/types";

type Props = {
  scenarios: ScenarioCard[];
  selectedId: string | null;
  onSelect: (scenario: ScenarioCard) => void;
};

export function ScenarioCards({ scenarios, selectedId, onSelect }: Props) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {scenarios.map((s) => {
        const active = s.id === selectedId;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s)}
            className={`border-2 p-4 text-left transition ${
              active
                ? "border-[var(--primary)] bg-[var(--primary-muted)] shadow-sm"
                  : "border-[var(--border)] bg-white hover:border-[var(--primary)]/40 hover:shadow-sm"
            }`}
          >
            <div className="text-sm font-semibold text-[var(--foreground)]">{s.title}</div>
            <div className="mt-1 text-sm text-dim">{s.subtitle}</div>
            <ul className="mt-3 space-y-1 text-xs text-[var(--foreground)]">
              {s.narrative_points.slice(0, 2).map((p) => (
                <li key={p}>&gt; {p}</li>
              ))}
            </ul>
          </button>
        );
      })}
    </div>
  );
}

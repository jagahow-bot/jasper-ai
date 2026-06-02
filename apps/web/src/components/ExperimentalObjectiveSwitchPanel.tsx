"use client";

import type { ExperimentRequest, ExperimentalRegimeMode } from "@/lib/types";

type Props = {
  value: ExperimentRequest | undefined;
  onChange: (next: ExperimentRequest | undefined) => void;
};

const REGIME_OPTIONS: { value: ExperimentalRegimeMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "risk_off", label: "Risk-Off" },
  { value: "neutral", label: "Neutral" },
  { value: "risk_on", label: "Risk-On" },
];

export function ExperimentalObjectiveSwitchPanel({ value, onChange }: Props) {
  const current: ExperimentRequest = value ?? {
    enabled: true,
    mode: "objective_switch",
    regime_mode: "auto",
    note: "EXPERIMENTAL: Objective Switch Sandbox",
  };

  return (
    <div className="pixel-panel border-[var(--amber)] bg-[rgba(255,176,0,0.06)]">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="pixel-badge-warn">EXPERIMENTAL: Objective Switch Sandbox</span>
        <span className="font-pixel text-[8px] text-[var(--muted)]">
          Sandbox only, does not alter normal flow unless enabled.
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex items-center gap-2 font-pixel text-[8px] text-[var(--fg)]">
          <input
            type="checkbox"
            checked={Boolean(current.enabled)}
            onChange={(e) =>
              onChange({
                ...current,
                enabled: e.target.checked,
              })
            }
          />
          Enable sandbox objective switch
        </label>

        <label className="font-pixel text-[8px] text-[var(--fg)]">
          Regime mode
          <select
            className="pixel-input mt-1 w-full py-1 text-xs"
            value={current.regime_mode}
            onChange={(e) =>
              onChange({
                ...current,
                regime_mode: e.target.value as ExperimentalRegimeMode,
              })
            }
          >
            {REGIME_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

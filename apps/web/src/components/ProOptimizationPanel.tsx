"use client";

import type { BacktestRequest } from "@/lib/types";

type Props = {
  value: BacktestRequest;
  onChange: (next: BacktestRequest) => void;
};

function estProTrials(v: BacktestRequest): number {
  const batch = v.refinement_batch_size ?? 5;
  const challengers = v.refinement_challengers_per_round ?? 4;
  const rounds = v.refinement_max_rounds ?? 8;
  // Round 2+ re-simulates the champion as an extra Optuna trial per round.
  return batch + (challengers + 1) * Math.max(0, rounds - 1);
}

export function ProOptimizationPanel({ value, onChange }: Props) {
  const isPro = value.optimization_mode === "pro_auto";
  const estTrials = estProTrials(value);
  const highTrialCount = estTrials >= 50;

  const setPro = (on: boolean) => {
    onChange({
      ...value,
      optimization_mode: on ? "pro_auto" : "standard",
      enable_iterative_refinement: on,
    });
  };

  return (
    <div
      className={`border-2 p-4 ${
        isPro
          ? "border-[var(--amber)] bg-[rgba(255,176,0,0.06)]"
          : "border-[var(--border)] bg-[#080810]"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-pixel text-[9px] text-[var(--amber)]">
            Pro · AI convergence
          </h4>
          <p className="mt-2 text-sm text-dim">
            Champion-challenger rounds. AI proposes params from history; Optuna
            scores with OOS gap penalty until objective stalls.
          </p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2">
          <span className="text-xs text-dim">{isPro ? "ON" : "OFF"}</span>
          <input
            type="checkbox"
            checked={isPro}
            onChange={(e) => setPro(e.target.checked)}
            className="h-4 w-4 accent-[var(--amber)]"
          />
        </label>
      </div>

      {isPro && (
        <div className="mt-4 space-y-4 border-t border-[var(--border)] pt-4">
          <p className="text-xs text-dim">
            Standard trial slider disabled in Pro. Est. max ~{" "}
            <strong className="text-[var(--amber)]">{estTrials}</strong> backtests
            (champion +1 per round after round 1; may stop early).
          </p>
          {highTrialCount && (
            <p className="border border-[var(--amber)] bg-[rgba(255,176,0,0.08)] px-2 py-1 text-xs text-[var(--amber)]">
              High trial counts run many backtests. When round-1 batch or challengers
              exceed 10, Gemini is capped to ~8 AI seeds per round (one batched API
              call); remaining trials in that round use Optuna&apos;s sampler only.
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="flex justify-between text-xs text-[var(--foreground)]">
                <span>Round-1 batch</span>
                <span className="font-terminal text-base text-[var(--amber)]">
                  {value.refinement_batch_size ?? 5}
                </span>
              </span>
              <p className="text-xs text-dim">Round-1 parallel trials (3–100).</p>
              <input
                type="range"
                min={3}
                max={100}
                step={1}
                value={value.refinement_batch_size ?? 5}
                onChange={(e) =>
                  onChange({
                    ...value,
                    refinement_batch_size: Number(e.target.value),
                  })
                }
                className="w-full"
              />
            </label>
            <label className="block space-y-1">
              <span className="flex justify-between text-xs text-[var(--foreground)]">
                <span>Challengers / round</span>
                <span className="font-terminal text-base text-[var(--amber)]">
                  {value.refinement_challengers_per_round ?? 4}
                </span>
              </span>
              <p className="text-xs text-dim">
                New challengers each round after round 1 (2–100).
              </p>
              <input
                type="range"
                min={2}
                max={100}
                step={1}
                value={value.refinement_challengers_per_round ?? 4}
                onChange={(e) =>
                  onChange({
                    ...value,
                    refinement_challengers_per_round: Number(e.target.value),
                  })
                }
                className="w-full"
              />
            </label>
            <label className="block space-y-1">
              <span className="flex justify-between text-xs text-[var(--foreground)]">
                <span>Max rounds</span>
                <span className="font-terminal text-base text-[var(--amber)]">
                  {value.refinement_max_rounds ?? 8}
                </span>
              </span>
              <p className="text-xs text-dim">Including round 1 (2–30).</p>
              <input
                type="range"
                min={2}
                max={30}
                step={1}
                value={value.refinement_max_rounds ?? 8}
                onChange={(e) =>
                  onChange({
                    ...value,
                    refinement_max_rounds: Number(e.target.value),
                  })
                }
                className="w-full"
              />
            </label>
            <label className="block space-y-1">
              <span className="flex justify-between text-xs text-[var(--foreground)]">
                <span>Patience (rounds)</span>
                <span className="font-terminal text-base text-[var(--amber)]">
                  {value.refinement_patience ?? 2}
                </span>
              </span>
              <input
                type="range"
                min={1}
                max={5}
                value={value.refinement_patience ?? 2}
                onChange={(e) =>
                  onChange({
                    ...value,
                    refinement_patience: Number(e.target.value),
                  })
                }
                className="w-full"
              />
            </label>
          </div>
          <label className="block space-y-1">
            <span className="flex justify-between text-xs text-[var(--foreground)]">
              <span>Overfit penalty</span>
              <span className="font-terminal text-base text-[var(--amber)]">
                {(value.overfitting_penalty_weight ?? 0.5).toFixed(1)}
              </span>
            </span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={value.overfitting_penalty_weight ?? 0.5}
              onChange={(e) =>
                onChange({
                  ...value,
                  overfitting_penalty_weight: Number(e.target.value),
                })
              }
              className="w-full"
            />
            <p className="text-xs text-dim">
              Penalizes in-sample vs holdout objective gap during trial scoring.
            </p>
          </label>
          {!value.enable_oos && (
            <p className="border border-[var(--amber)] bg-[rgba(255,176,0,0.08)] px-2 py-1 text-xs text-[var(--amber)]">
              Tip: enable holdout split so trials rank on in-sample only and the convergence chart shows IS vs OOS.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

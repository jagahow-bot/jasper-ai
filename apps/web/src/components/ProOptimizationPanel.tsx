"use client";

import type { BacktestRequest } from "@/lib/types";

type Props = {
  value: BacktestRequest;
  onChange: (next: BacktestRequest) => void;
};

const CHALLENGERS_MIN = 2;
const CHALLENGERS_MAX = 100;

function challengersFromBatch(batch: number): number {
  return Math.min(CHALLENGERS_MAX, Math.max(CHALLENGERS_MIN, batch - 1));
}

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
            Champion–challenger rounds. The AI proposes parameters from prior results and
            the optimizer scores them on the in-sample objective until improvement stalls.
            With the <strong className="text-[var(--fg)]">Dynamic</strong> objective, each
            round explores separate factor settings for every market regime
            (risk-off / neutral / risk-on), and the simulation applies the active regime at
            each rebalance.
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
            The standard trial slider is disabled in Pro mode. Estimated maximum ~{" "}
            <strong className="text-[var(--amber)]">{estTrials}</strong> backtests
            (the champion is re-tested once per round after round 1; the run may stop early).
          </p>
          {highTrialCount && (
            <p className="border border-[var(--amber)] bg-[rgba(255,176,0,0.08)] px-2 py-1 text-xs text-[var(--amber)]">
              Higher settings run many backtests. Each round uses a single AI proposal to
              guide the search, and the optimizer then explores all trials in that round
              within those bounds.
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
                onChange={(e) => {
                  const batch = Number(e.target.value);
                  onChange({
                    ...value,
                    refinement_batch_size: batch,
                    refinement_challengers_per_round:
                      challengersFromBatch(batch),
                  });
                }}
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
          {!value.enable_oos && (
            <p className="border border-[var(--amber)] bg-[rgba(255,176,0,0.08)] px-2 py-1 text-xs text-[var(--amber)]">
              Tip: turn on the holdout split so candidates are ranked on in-sample results only; out-of-sample metrics stay diagnostic.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

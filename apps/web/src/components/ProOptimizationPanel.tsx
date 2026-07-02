"use client";

import type { BacktestRequest } from "@/lib/types";
import { useI18n } from "@/lib/i18n";

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
  const { t } = useI18n();
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
            {t("proPanel.title")}
          </h4>
          <p className="mt-2 text-sm text-dim">
            {t("proPanel.desc.beforeDynamic")}{" "}
            <strong className="text-[var(--fg)]">{t("proPanel.dynamic")}</strong>{" "}
            {t("proPanel.desc.afterDynamic")}
          </p>
        </div>
        <label className="flex shrink-0 cursor-pointer items-center gap-2">
          <span className="text-xs text-dim">
            {isPro ? t("common.on") : t("common.off")}
          </span>
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
            {t("proPanel.estimationPrefix")}{" "}
            <strong className="text-[var(--amber)]">{estTrials}</strong> backtests
            {t("proPanel.estimationSuffix")}
          </p>
          {highTrialCount && (
            <p className="border border-[var(--amber)] bg-[rgba(255,176,0,0.08)] px-2 py-1 text-xs text-[var(--amber)]">
              {t("proPanel.highTrialsWarning")}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="flex justify-between text-xs text-[var(--foreground)]">
                <span>{t("proPanel.round1Batch")}</span>
                <span className="font-terminal text-base text-[var(--amber)]">
                  {value.refinement_batch_size ?? 5}
                </span>
              </span>
              <p className="text-xs text-dim">{t("proPanel.round1BatchHint")}</p>
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
                <span>{t("proPanel.challengersPerRound")}</span>
                <span className="font-terminal text-base text-[var(--amber)]">
                  {value.refinement_challengers_per_round ?? 4}
                </span>
              </span>
              <p className="text-xs text-dim">
                {t("proPanel.challengersPerRoundHint")}
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
                <span>{t("proPanel.maxRounds")}</span>
                <span className="font-terminal text-base text-[var(--amber)]">
                  {value.refinement_max_rounds ?? 8}
                </span>
              </span>
              <p className="text-xs text-dim">{t("proPanel.maxRoundsHint")}</p>
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
          </div>
          {!value.enable_oos && (
            <p className="border border-[var(--amber)] bg-[rgba(255,176,0,0.08)] px-2 py-1 text-xs text-[var(--amber)]">
              {t("proPanel.holdoutTip")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

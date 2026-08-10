"use client";

import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { BacktestRequest } from "@/lib/types";

type Props = {
  jobId: string;
  request: BacktestRequest;
  /** Display name for the baseline this run is judged against (anchor model or ticker). */
  benchmarkLabel: string;
  onContinue: (options: {
    extraRefinementRounds: number;
    extraTrialsPerRound: number;
    extraTrials?: number;
  }) => void;
  onAdjustConfig: () => void;
  loading?: boolean;
};

export function ContinueRefinementCTA({
  jobId,
  request,
  benchmarkLabel,
  onContinue,
  onAdjustConfig,
  loading = false,
}: Props) {
  const { t } = useI18n();
  const isPro =
    request.optimization_mode === "pro_auto" ||
    Boolean(request.enable_iterative_refinement);
  const defaultTrialsPerRound = request.refinement_challengers_per_round ?? 4;
  const priorRounds =
    request.refinement_max_rounds != null ? request.refinement_max_rounds : 8;

  const [extraRounds, setExtraRounds] = useState(4);
  const [extraTrialsPerRound, setExtraTrialsPerRound] = useState(
    defaultTrialsPerRound,
  );
  const [extraTrials, setExtraTrials] = useState(
    Math.min(50, Math.max(10, (request.trials ?? 50) / 2)),
  );

  const nextRoundLabel = useMemo(() => {
    if (!isPro) return null;
    return t("results.continueFromRound", { round: priorRounds + 1 });
  }, [isPro, priorRounds, t]);

  return (
    <div className="pixel-panel border border-amber-200 bg-amber-50/50">
      <p className="ui-section-title mb-1 text-[var(--amber)]">
        {t("results.continueRefinementTitle")}
      </p>
      <p className="ui-body">
        {t("results.continueRefinementBody", { benchmark: benchmarkLabel })}
      </p>
      {nextRoundLabel ? (
        <p className="ui-hint mt-1">{nextRoundLabel}</p>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {isPro ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="ui-hint">{t("results.extraRoundsLabel")}</span>
              <input
                type="number"
                min={1}
                max={30}
                value={extraRounds}
                onChange={(e) =>
                  setExtraRounds(
                    Math.max(1, Math.min(30, Number(e.target.value) || 1)),
                  )
                }
                className="pixel-input w-full"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="ui-hint">{t("results.extraTrialsPerRoundLabel")}</span>
              <input
                type="number"
                min={2}
                max={100}
                value={extraTrialsPerRound}
                onChange={(e) =>
                  setExtraTrialsPerRound(
                    Math.max(2, Math.min(100, Number(e.target.value) || 2)),
                  )
                }
                className="pixel-input w-full"
              />
            </label>
          </>
        ) : (
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="ui-hint">{t("results.extraTrialsLabel")}</span>
            <input
              type="number"
              min={5}
              max={200}
              value={extraTrials}
              onChange={(e) =>
                setExtraTrials(
                  Math.max(5, Math.min(200, Number(e.target.value) || 5)),
                )
              }
              className="pixel-input w-full"
            />
          </label>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={loading}
          onClick={() =>
            onContinue({
              extraRefinementRounds: extraRounds,
              extraTrialsPerRound: extraTrialsPerRound,
              extraTrials: isPro ? undefined : extraTrials,
            })
          }
          className="pixel-btn pixel-btn-amber"
        >
          {loading ? t("results.continueRefinementRunning") : t("results.continueRefinementCta")}
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={onAdjustConfig}
          className="pixel-btn"
        >
          {t("results.iterateFromHere")}
        </button>
      </div>
      <p className="ui-hint mt-2">
        {t("results.continueRefinementHint", { job: jobId.slice(0, 8) })}
      </p>
    </div>
  );
}

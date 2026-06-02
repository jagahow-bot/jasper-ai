"use client";

import type { BacktestRequest, BacktestResult } from "@/lib/types";

type EvalArm = {
  label?: string;
  objective?: string;
  in_sample_sharpe?: number | null;
  out_of_sample_sharpe?: number | null;
  full_sample_sharpe?: number | null;
  sharpe?: number | null;
  trials_used?: number;
};

type Evaluation = {
  disclaimer?: string;
  user_objective?: string;
  switch_objective?: string;
  objectives_match?: boolean;
  fixed_arm?: EvalArm;
  switch_arm?: EvalArm | null;
  ab_evaluation_ran?: boolean;
  oos_sharpe_delta_switch_minus_fixed?: number | null;
};

function fmtSharpe(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(3);
}

type Props = {
  result: BacktestResult;
  request: BacktestRequest;
  onRunAbEvaluation?: () => void;
  abEvaluationLoading?: boolean;
};

export function ExperimentalObjectiveEvaluation({
  result,
  request,
  onRunAbEvaluation,
  abEvaluationLoading,
}: Props) {
  const experimental = result.experimental;
  const evaluation = experimental?.evaluation as Evaluation | undefined;
  if (!experimental?.enabled) return null;

  const exp = request.experiment;
  const canRunAb =
    Boolean(onRunAbEvaluation) &&
    !evaluation?.ab_evaluation_ran &&
    experimental.chosen_objective !== request.objective;

  return (
    <div className="border-2 border-[var(--amber)] bg-[rgba(255,176,0,0.08)] px-4 py-3 text-xs space-y-3">
      <p className="font-pixel text-[8px] text-[var(--amber)]">
        EXPERIMENTAL: Objective Switch Evaluation
      </p>
      <p className="text-dim">
        Regime {String(experimental.resolved_regime_signal ?? "—")} · sandbox objective{" "}
        {String(experimental.chosen_objective ?? "—")}
        {typeof experimental.regime_switch_count === "number" && (
          <> · walk-forward switches {experimental.regime_switch_count}</>
        )}
      </p>
      {experimental.reason && (
        <p className="text-dim">{String(experimental.reason)}</p>
      )}

      {evaluation ? (
        <>
          <p className="text-[var(--amber)]">{evaluation.disclaimer}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded border border-[var(--border)] bg-[var(--panel)] p-3">
              <p className="font-pixel text-[8px] text-[var(--cyan)]">Fixed (your run)</p>
              <p className="mt-1 text-[var(--foreground)]">
                {evaluation.fixed_arm?.objective ?? evaluation.user_objective}
              </p>
              <ul className="mt-2 space-y-1 text-dim">
                <li>IS Sharpe {fmtSharpe(evaluation.fixed_arm?.in_sample_sharpe)}</li>
                <li>OOS Sharpe {fmtSharpe(evaluation.fixed_arm?.out_of_sample_sharpe)}</li>
                <li>Full Sharpe {fmtSharpe(evaluation.fixed_arm?.full_sample_sharpe)}</li>
              </ul>
            </div>
            <div className="rounded border border-[var(--border)] bg-[var(--panel)] p-3">
              <p className="font-pixel text-[8px] text-[var(--cyan)]">
                Switch policy
              </p>
              <p className="mt-1 text-[var(--foreground)]">
                {evaluation.switch_objective ?? experimental.chosen_objective}
              </p>
              {evaluation.switch_arm ? (
                <ul className="mt-2 space-y-1 text-dim">
                  <li>IS Sharpe {fmtSharpe(evaluation.switch_arm.in_sample_sharpe)}</li>
                  <li>OOS Sharpe {fmtSharpe(evaluation.switch_arm.out_of_sample_sharpe)}</li>
                  <li>Full Sharpe {fmtSharpe(evaluation.switch_arm.full_sample_sharpe)}</li>
                  {evaluation.switch_arm.trials_used != null && (
                    <li>Eval trials {evaluation.switch_arm.trials_used}</li>
                  )}
                </ul>
              ) : (
                <p className="mt-2 text-dim">
                  {evaluation.objectives_match
                    ? "Same objective as your config — A/B not required."
                    : "Run evaluation to compare with a lightweight switch-policy backtest."}
                </p>
              )}
            </div>
          </div>
          {evaluation.oos_sharpe_delta_switch_minus_fixed != null && (
            <p className="text-dim">
              OOS Sharpe Δ (switch − fixed):{" "}
              <span className="text-[var(--foreground)]">
                {evaluation.oos_sharpe_delta_switch_minus_fixed >= 0 ? "+" : ""}
                {evaluation.oos_sharpe_delta_switch_minus_fixed.toFixed(3)}
              </span>
            </p>
          )}
        </>
      ) : null}

      {canRunAb && (
        <button
          type="button"
          className="pixel-btn w-full md:w-auto disabled:opacity-40"
          disabled={abEvaluationLoading || exp?.run_ab_evaluation}
          onClick={onRunAbEvaluation}
        >
          {abEvaluationLoading
            ? "RUNNING EVAL…"
            : "RUN OBJECTIVE SWITCH EVALUATION"}
        </button>
      )}
      {evaluation?.ab_evaluation_ran && (
        <p className="text-dim">A/B lightweight evaluation completed for this job.</p>
      )}
    </div>
  );
}

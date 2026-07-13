import type { BacktestRequest } from "@/lib/types";

type NarrativeFacts = Record<string, unknown> | null | undefined;

/** Resolve the optimization objective key for a completed run. */
export function resolveRunObjective(
  request?: Pick<BacktestRequest, "objective"> | null,
  narrativeFacts?: NarrativeFacts,
): string {
  const spec = narrativeFacts?.backtest_spec as { objective?: string } | undefined;
  const fromFacts = narrativeFacts?.objective;
  const fromSpec = spec?.objective;
  const fromRequest = request?.objective;
  return String(fromFacts ?? fromSpec ?? fromRequest ?? "max_sharpe");
}

import type { BacktestRequest } from "@/lib/types";

type NarrativeFacts = {
  backtest_spec?: { benchmark?: string | null } | null;
};

/** Benchmark ticker persisted on the job result (metrics were computed vs this). */
export function resolveJobBenchmarkTicker(
  narrativeFacts: NarrativeFacts | Record<string, unknown> | null | undefined,
): string {
  const spec = (narrativeFacts as NarrativeFacts | null | undefined)?.backtest_spec;
  return String(spec?.benchmark ?? "").trim().toUpperCase();
}

/**
 * Benchmark ticker for result UI and AI narratives.
 * Prefer explicit request.benchmark_ticker (anchor override) over the job
 * backtest_spec so RM anchor SPY is shown even when an older run used AI ACWI.
 */
export function resolveResultBenchmarkTicker(
  request: Pick<BacktestRequest, "benchmark_ticker"> | null | undefined,
  narrativeFacts: NarrativeFacts | Record<string, unknown> | null | undefined,
): string {
  const fromRequest = String(request?.benchmark_ticker ?? "").trim();
  if (fromRequest) return fromRequest.toUpperCase();

  const fromJob = resolveJobBenchmarkTicker(narrativeFacts);
  if (fromJob) return fromJob;

  return "SPY";
}

/** True when anchor/request benchmark disagrees with persisted job spec (stale run). */
export function benchmarkTickerMismatch(
  request: Pick<BacktestRequest, "benchmark_ticker"> | null | undefined,
  narrativeFacts: NarrativeFacts | Record<string, unknown> | null | undefined,
): boolean {
  const fromJob = resolveJobBenchmarkTicker(narrativeFacts);
  const fromRequest = resolveResultBenchmarkTicker(request, narrativeFacts);
  return Boolean(fromJob && fromRequest && fromJob !== fromRequest);
}

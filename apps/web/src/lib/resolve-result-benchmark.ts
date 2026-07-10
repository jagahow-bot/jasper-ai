import type { BacktestRequest } from "@/lib/types";

type NarrativeFacts = {
  backtest_spec?: { benchmark?: string | null } | null;
};

/**
 * Benchmark ticker for result UI and AI narratives.
 * Job backtest_spec is authoritative for metrics; request.benchmark_ticker
 * is the anchor override sent to the API and a fallback when spec is missing.
 */
export function resolveResultBenchmarkTicker(
  request: Pick<BacktestRequest, "benchmark_ticker"> | null | undefined,
  narrativeFacts: NarrativeFacts | Record<string, unknown> | null | undefined,
): string {
  const spec = (narrativeFacts as NarrativeFacts | null | undefined)?.backtest_spec;
  const fromJob = String(spec?.benchmark ?? "").trim();
  if (fromJob) return fromJob.toUpperCase();

  const fromRequest = String(request?.benchmark_ticker ?? "").trim();
  if (fromRequest) return fromRequest.toUpperCase();

  return "SPY";
}

/** True when anchor/request benchmark disagrees with persisted job spec (stale run). */
export function benchmarkTickerMismatch(
  request: Pick<BacktestRequest, "benchmark_ticker"> | null | undefined,
  narrativeFacts: NarrativeFacts | Record<string, unknown> | null | undefined,
): boolean {
  const spec = (narrativeFacts as NarrativeFacts | null | undefined)?.backtest_spec;
  const fromJob = String(spec?.benchmark ?? "").trim().toUpperCase();
  const fromRequest = String(request?.benchmark_ticker ?? "").trim().toUpperCase();
  return Boolean(fromJob && fromRequest && fromJob !== fromRequest);
}

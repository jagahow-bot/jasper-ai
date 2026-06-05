import type { CandidateChartsPayload, PortfolioCandidate } from "./types";

export function candidateHasFullCharts(c: PortfolioCandidate | undefined): boolean {
  if (!c) return false;
  const wh = c.analytics?.weight_history;
  const ec = c.equity_curve;
  return Boolean((wh && wh.length > 0) || (ec && ec.length > 0));
}

/** Merge lazy chart payload into a slim candidate for trajectory/holdings charts. */
export function mergeCandidateCharts(
  candidate: PortfolioCandidate,
  charts: CandidateChartsPayload,
): PortfolioCandidate {
  return {
    ...candidate,
    equity_curve: charts.equity_curve,
    analytics: {
      ...candidate.analytics,
      weight_history: charts.weight_history,
      weight_history_tickers: charts.weight_history_tickers,
      benchmark_equity_curve: charts.benchmark_equity_curve,
      weight_cap_audit:
        charts.weight_cap_audit ?? candidate.analytics?.weight_cap_audit,
    },
  };
}

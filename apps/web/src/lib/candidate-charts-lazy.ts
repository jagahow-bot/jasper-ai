import type { CandidateAnalytics, CandidateChartsPayload, PortfolioCandidate } from "./types";

export function candidateHasFullCharts(c: PortfolioCandidate | undefined): boolean {
  if (!c) return false;
  const wh = c.analytics?.weight_history;
  const ec = c.equity_curve;
  return Boolean((wh && wh.length > 0) || (ec && ec.length > 0));
}

export function candidateHasDeepAnalytics(c: PortfolioCandidate | undefined): boolean {
  if (!c) return false;
  const rolling = c.analytics?.rolling?.rolling_sharpe;
  const monthly = c.analytics?.periodic_returns?.monthly;
  return Boolean(
    (rolling && rolling.length > 0) || (monthly && monthly.length > 0),
  );
}

export function lazyPayloadComplete(
  charts: CandidateChartsPayload,
  needsCharts: boolean,
  needsAnalytics: boolean,
): boolean {
  const hasCharts =
    charts.equity_curve.length > 0 || charts.weight_history.length > 0;
  const hasAnalytics = Boolean(
    charts.institutional?.rolling?.rolling_sharpe?.length ||
      charts.institutional?.periodic_returns?.monthly?.length,
  );
  return (!needsCharts || hasCharts) && (!needsAnalytics || hasAnalytics);
}

/** Merge lazy chart + institutional analytics into a slim candidate. */
export function mergeCandidateCharts(
  candidate: PortfolioCandidate,
  charts: CandidateChartsPayload,
): PortfolioCandidate {
  const institutional = charts.institutional as Partial<CandidateAnalytics> | undefined;
  return {
    ...candidate,
    equity_curve: charts.equity_curve,
    analytics: {
      ...candidate.analytics,
      ...institutional,
      weight_history: charts.weight_history,
      weight_history_tickers: charts.weight_history_tickers,
      benchmark_equity_curve: charts.benchmark_equity_curve,
      weight_cap_audit:
        charts.weight_cap_audit ?? candidate.analytics?.weight_cap_audit,
      exposure: institutional?.exposure ?? candidate.analytics?.exposure,
      factor_summary:
        candidate.analytics?.factor_summary ?? institutional?.factor_summary,
      sample_metrics: candidate.analytics?.sample_metrics,
    },
  };
}

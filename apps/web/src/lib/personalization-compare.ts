import type {
  BacktestRequest,
  BacktestResult,
  PersonalizationCompare,
} from "@/lib/types";

/**
 * Build an RmReportView payload when only one customized job ran
 * (skip_anchor_compare / cash no-baseline path).
 *
 * base* mirrors adjusted* so the existing compare type stays valid;
 * callers should treat this as single-track (no dual-leg UI).
 */
export function buildSingleTrackPersonalizationCompare(opts: {
  result: BacktestResult;
  request: BacktestRequest;
  anchorPortfolioId: string;
  anchorLabel: string;
  customizedLabel: string;
}): PersonalizationCompare {
  const request: BacktestRequest = {
    ...opts.request,
    skip_anchor_compare: true,
    anchor_job_id: null,
  };
  return {
    anchorPortfolioId: opts.anchorPortfolioId,
    anchorLabel: opts.anchorLabel,
    customizedLabel: opts.customizedLabel,
    baseResult: opts.result,
    baseRequest: request,
    adjustedResult: opts.result,
    adjustedRequest: request,
  };
}

/** True when compare was synthesized for a solo customized job (no anchor leg). */
export function isSingleTrackPersonalizationCompare(
  compare: PersonalizationCompare,
): boolean {
  if (compare.adjustedRequest.skip_anchor_compare) return true;
  if (compare.baseRequest.skip_anchor_compare) return true;
  return compare.baseResult.job_id === compare.adjustedResult.job_id;
}

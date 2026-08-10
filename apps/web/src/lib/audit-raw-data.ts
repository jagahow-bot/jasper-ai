/**
 * Pure data-shaping helpers for the on-page Audit / Raw data results tab.
 * Compose from already-fetched job request + result (no N+1).
 */

import { buildAllocationRows, resolveCandidateWeights } from "@/lib/candidate-weights";
import {
  candidateModelKey,
  resolveChampionModelKey,
} from "@/lib/performance-compare-chart";
import { resolveResultBenchmarkTicker } from "@/lib/resolve-result-benchmark";
import { resolveRunObjective } from "@/lib/resolve-run-objective";
import type {
  BacktestRequest,
  BacktestResult,
  ClientContext,
  PortfolioCandidate,
  ProRoundSnapshot,
} from "@/lib/types";

export type AuditKv = { key: string; value: string };

export type AuditRunSummary = {
  jobId: string;
  startDate: string;
  endDate: string;
  objective: string;
  engine: string;
  optimizationMode: string;
  dataSource: string;
  championModel: string;
  scenarioId: string;
  backtestMode: string;
};

export type AuditConstraintField = { key: string; value: unknown };

export type AuditUniverse = {
  holdings: string[];
  universeTickers: string[];
  supplements: string[];
  assetClasses: string[];
  categories: string[];
  benchmark: string;
  tradableCount: number | null;
  universeSize: number | null;
  filterText: string | null;
  filterPrompts: string[];
};

export type AuditParamRow = { key: string; value: string };

export type AuditProRoundSummary = {
  round: number;
  improved: boolean;
  trialsInRound: number;
  winnerCode: string | null;
  championCode: string | null;
  score: number | null;
};

export type AuditDataProvenance = {
  dataSource: string;
  rows: number | null;
  columns: number | null;
  requestedStart: string | null;
  effectiveStart: string | null;
  end: string | null;
  warmupDownloadStart: string | null;
  prepBufferDays: number | null;
  warmupCoversStart: boolean | null;
  excludedLateListings: string[];
  excludedCount: number | null;
  pinnedLateListings: string[];
  warning: string | null;
  /** Full multi-ticker price panel is never embedded in job result. */
  pricePanelInResult: false;
};

export type AuditWeightRow = {
  ticker: string;
  weight: number;
  pct: number;
};

export type AuditWeightHistoryRow = {
  date: string;
  holdingsCount: number;
  topTickers: string[];
};

export type AuditWeightHistorySummary = {
  rebalanceCount: number;
  firstDate: string | null;
  lastDate: string | null;
  tickers: string[];
  rows: AuditWeightHistoryRow[];
  available: boolean;
};

export type AuditMetricRow = { key: string; value: string | number | null };

export type AuditPerformanceEvidence = {
  metrics: AuditMetricRow[];
  equityCurve: { date: string; value: number }[];
  championCode: string | null;
};

export type AuditClientContextView = {
  present: boolean;
  clientContext: ClientContext | null;
  overlayAudit: Record<string, unknown> | null;
  clientRef: string | null;
  anchorPortfolioId: string | null;
  anchorJobId: string | null;
};

export type PageSlice<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function asString(value: unknown, fallback = "—"): string {
  if (value == null || value === "") return fallback;
  return String(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((x) => String(x ?? "").trim().toUpperCase())
    .filter(Boolean);
}

function formatParamValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Resolve champion candidate from result narrative + candidates list. */
export function resolveAuditChampion(
  result: Pick<BacktestResult, "candidates" | "narrative_facts">,
): PortfolioCandidate | null {
  const key = resolveChampionModelKey(result.candidates, result.narrative_facts);
  if (!key) return result.candidates[0] ?? null;
  const match = result.candidates.find(
    (c) => candidateModelKey(c).toUpperCase() === key.toUpperCase(),
  );
  return match ?? result.candidates[0] ?? null;
}

export function buildAuditRunSummary(
  result: BacktestResult,
  request: BacktestRequest,
): AuditRunSummary {
  const facts = result.narrative_facts ?? {};
  const dq = asRecord(facts.data_quality);
  const champion = resolveAuditChampion(result);
  const periodStart =
    asString(result.period?.start, "") ||
    asString(request.start_date, "") ||
    "—";
  const periodEnd =
    asString(result.period?.end, "") ||
    asString(request.end_date, "") ||
    "—";

  return {
    jobId: asString(result.job_id, "—"),
    startDate: periodStart,
    endDate: periodEnd,
    objective: resolveRunObjective(request, facts),
    engine: asString(facts.engine, "—"),
    optimizationMode: asString(
      facts.optimization_mode ?? request.optimization_mode,
      "—",
    ),
    dataSource: asString(
      facts.data_source ?? dq?.data_source,
      "—",
    ),
    championModel: asString(
      champion?.model_code ??
        facts.ai_champion_model_code ??
        facts.champion_model_code,
      "—",
    ),
    scenarioId: asString(result.scenario_id ?? request.scenario_id, "—"),
    backtestMode: asString(request.backtest_mode, "static"),
  };
}

/** Key request / constraint fields for the summary table (not full JSON). */
export function buildAuditConstraintFields(
  request: BacktestRequest,
): AuditConstraintField[] {
  const fields: AuditConstraintField[] = [
    { key: "objective", value: request.objective },
    { key: "optimization_mode", value: request.optimization_mode ?? null },
    { key: "start_date", value: request.start_date },
    { key: "end_date", value: request.end_date },
    { key: "trials", value: request.trials },
    { key: "top_models", value: request.top_models },
    { key: "max_weight", value: request.max_weight },
    { key: "min_weight", value: request.min_weight ?? null },
    { key: "max_holdings", value: request.max_holdings ?? null },
    { key: "max_turnover", value: request.max_turnover },
    { key: "fee_bps", value: request.fee_bps },
    { key: "rebalance_freq", value: request.rebalance_freq },
    { key: "enable_oos", value: request.enable_oos },
    { key: "train_ratio", value: request.train_ratio },
    { key: "benchmark_ticker", value: request.benchmark_ticker ?? null },
    { key: "customization_drift", value: request.customization_drift ?? null },
    { key: "cash_reserve_pct", value: request.cash_reserve_pct ?? null },
    { key: "risk_free_rate", value: request.risk_free_rate ?? null },
    { key: "regime_adaptive", value: request.regime_adaptive ?? null },
    {
      key: "enable_iterative_refinement",
      value: request.enable_iterative_refinement ?? null,
    },
    { key: "refinement_max_rounds", value: request.refinement_max_rounds ?? null },
    { key: "anchor_portfolio_id", value: request.anchor_portfolio_id ?? null },
    { key: "client_ref", value: request.client_ref ?? null },
  ];
  return fields.filter((f) => f.value !== null && f.value !== undefined);
}

export function buildAuditUniverse(
  result: BacktestResult,
  request: BacktestRequest,
): AuditUniverse {
  const facts = result.narrative_facts ?? {};
  const champion = resolveAuditChampion(result);
  const weights = champion ? resolveCandidateWeights(champion) : {};
  const holdings = Object.keys(weights).sort();

  const fromRequest = asStringList(request.universe_tickers);
  const fromFacts = asStringList(facts.universe_tickers_filter);
  const universeTickers = fromRequest.length ? fromRequest : fromFacts;

  const supplements = [
    ...asStringList(request.universe_supplement_tickers),
    ...asStringList(facts.universe_supplement_tickers),
  ];
  const supplementSet = [...new Set(supplements)];

  const assetClasses = (
    request.asset_classes?.length
      ? request.asset_classes
      : asStringList(facts.asset_classes_filter)
  ).map((x) => String(x));

  const categories = asStringList(
    request.universe_categories ?? facts.universe_categories_filter,
  );

  const filterPrompts = Array.isArray(request.universe_filter_prompts)
    ? request.universe_filter_prompts.map((s) => String(s)).filter(Boolean)
    : [];

  return {
    holdings,
    universeTickers,
    supplements: supplementSet,
    assetClasses,
    categories,
    benchmark: resolveResultBenchmarkTicker(request, facts),
    tradableCount: asNumber(facts.tradable_count),
    universeSize: asNumber(facts.universe_size),
    filterText:
      typeof request.universe_filter_text === "string"
        ? request.universe_filter_text
        : typeof facts.universe_filter_text === "string"
          ? facts.universe_filter_text
          : null,
    filterPrompts,
  };
}

export function buildAuditChampionParams(
  candidate: PortfolioCandidate | null,
): AuditParamRow[] {
  const params = candidate?.params;
  if (!params || typeof params !== "object") return [];
  return Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, value: formatParamValue(value) }));
}

export function buildAuditProRoundSummaries(
  rounds: ProRoundSnapshot[] | null | undefined,
): AuditProRoundSummary[] {
  if (!Array.isArray(rounds) || rounds.length === 0) return [];
  return rounds.map((r) => ({
    round: r.round,
    improved: Boolean(r.improved),
    trialsInRound: r.trials_in_round,
    winnerCode: r.round_winner_model_code ?? null,
    championCode: r.incoming_champion_model_code ?? null,
    score:
      typeof r.round_best_adjusted_score === "number"
        ? r.round_best_adjusted_score
        : null,
  }));
}

export function buildAuditDataProvenance(
  result: BacktestResult,
): AuditDataProvenance {
  const facts = result.narrative_facts ?? {};
  const dq = asRecord(facts.data_quality) ?? {};
  return {
    dataSource: asString(facts.data_source ?? dq.data_source, "—"),
    rows: asNumber(dq.rows),
    columns: asNumber(dq.columns),
    requestedStart: asString(dq.requested_start, "") || null,
    effectiveStart: asString(dq.start, "") || null,
    end: asString(dq.end, "") || null,
    warmupDownloadStart: asString(dq.warmup_download_start, "") || null,
    prepBufferDays: asNumber(dq.prep_buffer_calendar_days),
    warmupCoversStart:
      typeof dq.warmup_panel_covers_report_start === "boolean"
        ? dq.warmup_panel_covers_report_start
        : null,
    excludedLateListings: asStringList(dq.excluded_late_listings),
    excludedCount: asNumber(dq.excluded_late_listing_count),
    pinnedLateListings: asStringList(dq.pinned_late_listings_kept),
    warning: typeof dq.warning === "string" ? dq.warning : null,
    pricePanelInResult: false,
  };
}

export function buildAuditFinalWeights(
  candidate: PortfolioCandidate | null,
): AuditWeightRow[] {
  if (!candidate) return [];
  return buildAllocationRows(resolveCandidateWeights(candidate)).map((r) => ({
    ticker: r.ticker,
    weight: r.weight,
    pct: r.pct,
  }));
}

export function buildAuditWeightHistorySummary(
  candidate: PortfolioCandidate | null,
): AuditWeightHistorySummary {
  const history = candidate?.analytics?.weight_history;
  const tickers = asStringList(candidate?.analytics?.weight_history_tickers);
  if (!Array.isArray(history) || history.length === 0) {
    return {
      rebalanceCount: 0,
      firstDate: null,
      lastDate: null,
      tickers,
      rows: [],
      available: false,
    };
  }

  const rows: AuditWeightHistoryRow[] = history.map((row) => {
    const date = asString(row.date, "—");
    const holdings: Array<{ ticker: string; w: number }> = [];
    for (const [k, raw] of Object.entries(row)) {
      if (k === "date") continue;
      const upper = k.toUpperCase();
      if (upper === "OTHER" || upper === "__OTHER__") continue;
      const w = asNumber(raw);
      if (w == null || w <= 1e-6) continue;
      holdings.push({ ticker: upper, w });
    }
    holdings.sort((a, b) => b.w - a.w || a.ticker.localeCompare(b.ticker));
    return {
      date,
      holdingsCount: holdings.length,
      topTickers: holdings.slice(0, 5).map((h) => h.ticker),
    };
  });

  const dates = rows.map((r) => r.date).filter((d) => d && d !== "—");
  return {
    rebalanceCount: rows.length,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    tickers:
      tickers.length > 0
        ? tickers
        : [
            ...new Set(
              rows.flatMap((r) => r.topTickers),
            ),
          ].sort(),
    rows,
    available: true,
  };
}

export function buildAuditPerformanceEvidence(
  result: BacktestResult,
  candidate: PortfolioCandidate | null,
): AuditPerformanceEvidence {
  const equity =
    (Array.isArray(candidate?.equity_curve) && candidate!.equity_curve!.length > 0
      ? candidate!.equity_curve!
      : result.equity_curve) ?? [];

  const metrics: AuditMetricRow[] = candidate
    ? [
        { key: "sharpe", value: candidate.sharpe },
        { key: "cagr", value: candidate.cagr },
        { key: "max_drawdown", value: candidate.max_drawdown },
        { key: "volatility", value: candidate.volatility },
        { key: "sortino", value: candidate.sortino ?? null },
        { key: "calmar", value: candidate.calmar ?? null },
        { key: "var_95", value: candidate.var_95 ?? null },
        { key: "cvar_95", value: candidate.cvar_95 ?? null },
        { key: "win_rate", value: candidate.win_rate ?? null },
        { key: "turnover_avg", value: candidate.turnover_avg ?? null },
        { key: "alpha", value: candidate.alpha ?? null },
        { key: "beta", value: candidate.beta ?? null },
        { key: "tracking_error", value: candidate.tracking_error ?? null },
        { key: "information_ratio", value: candidate.information_ratio ?? null },
        { key: "train_sharpe", value: candidate.train_sharpe ?? null },
        { key: "validation_sharpe", value: candidate.validation_sharpe ?? null },
      ]
    : [];

  return {
    metrics,
    equityCurve: equity.map((p) => ({
      date: String(p.date),
      value: Number(p.value),
    })),
    championCode: candidate?.model_code ?? null,
  };
}

export function buildAuditClientContext(
  request: BacktestRequest,
  overlayAudit?: Record<string, unknown> | null,
): AuditClientContextView {
  const ctx = request.client_context ?? null;
  const hasCtx = Boolean(
    ctx &&
      Object.values(ctx).some((v) => v != null && v !== "" && v !== undefined),
  );
  const hasOverlay = Boolean(overlayAudit && Object.keys(overlayAudit).length > 0);
  return {
    present: hasCtx || hasOverlay || Boolean(request.client_ref),
    clientContext: ctx,
    overlayAudit: overlayAudit ?? null,
    clientRef: request.client_ref ?? null,
    anchorPortfolioId: request.anchor_portfolio_id ?? null,
    anchorJobId: request.anchor_job_id ?? null,
  };
}

/** Paginate a list (1-based page). */
export function paginateSlice<T>(
  items: T[],
  page: number,
  pageSize: number,
): PageSlice<T> {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const start = (safePage - 1) * size;
  return {
    items: items.slice(start, start + size),
    page: safePage,
    pageSize: size,
    total,
    totalPages,
  };
}

/** Filter dated series by inclusive YYYY-MM-DD range. */
export function filterByDateRange<T extends { date: string }>(
  items: T[],
  start: string | null | undefined,
  end: string | null | undefined,
): T[] {
  const s = (start ?? "").trim();
  const e = (end ?? "").trim();
  if (!s && !e) return items;
  return items.filter((row) => {
    const d = String(row.date ?? "");
    if (s && d < s) return false;
    if (e && d > e) return false;
    return true;
  });
}

/** Filter ticker list by substring (case-insensitive). */
export function filterTickersByQuery(
  tickers: string[],
  query: string | null | undefined,
): string[] {
  const q = (query ?? "").trim().toUpperCase();
  if (!q) return tickers;
  return tickers.filter((t) => t.toUpperCase().includes(q));
}

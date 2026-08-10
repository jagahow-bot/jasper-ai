import { describe, expect, it } from "vitest";
import {
  buildAuditChampionParams,
  buildAuditClientContext,
  buildAuditConstraintFields,
  buildAuditDataProvenance,
  buildAuditFinalWeights,
  buildAuditPerformanceEvidence,
  buildAuditProRoundSummaries,
  buildAuditRunSummary,
  buildAuditUniverse,
  buildAuditWeightHistorySummary,
  filterByDateRange,
  filterTickersByQuery,
  paginateSlice,
  resolveAuditChampion,
} from "./audit-raw-data";
import type { BacktestRequest, BacktestResult, PortfolioCandidate } from "./types";

function baseRequest(overrides: Partial<BacktestRequest> = {}): BacktestRequest {
  return {
    scenario_id: "balanced",
    max_weight: 0.2,
    objective: "max_sharpe",
    backtest_mode: "static",
    start_date: "2020-01-01",
    end_date: "2024-12-31",
    trials: 50,
    top_models: 5,
    asset_classes: ["us_equity"],
    enable_oos: true,
    train_ratio: 0.7,
    fee_bps: 5,
    rebalance_freq: "monthly",
    max_turnover: 0.4,
    ...overrides,
  };
}

function baseCandidate(
  overrides: Partial<PortfolioCandidate> = {},
): PortfolioCandidate {
  return {
    rank: 1,
    model_code: "M1",
    is_champion: true,
    weights: { SPY: 0.6, TLT: 0.4 },
    sharpe: 1.2,
    max_drawdown: -0.15,
    cagr: 0.08,
    volatility: 0.12,
    ...overrides,
  };
}

function baseResult(overrides: Partial<BacktestResult> = {}): BacktestResult {
  return {
    job_id: "job-abc",
    scenario_id: "balanced",
    benchmark: "SPY",
    period: { start: "2020-01-01", end: "2024-12-31" },
    candidates: [baseCandidate()],
    equity_curve: [
      { date: "2020-01-02", value: 1 },
      { date: "2020-02-01", value: 1.02 },
      { date: "2021-01-01", value: 1.1 },
    ],
    efficient_frontier: [],
    narrative_facts: {
      engine: "optuna+pandas+pro",
      optimization_mode: "pro_auto",
      data_source: "yfinance",
      champion_model_code: "M1",
      tradable_count: 40,
      universe_size: 50,
      data_quality: {
        data_source: "yfinance",
        rows: 1200,
        columns: 41,
        requested_start: "2020-01-01",
        start: "2020-01-15",
        end: "2024-12-31",
        warmup_download_start: "2019-07-01",
        prep_buffer_calendar_days: 180,
        warmup_panel_covers_report_start: false,
        excluded_late_listing_count: 2,
        excluded_late_listings: ["NEW1", "NEW2"],
        warning: "Price panel starts late",
      },
    },
    ...overrides,
  };
}

describe("resolveAuditChampion", () => {
  it("picks narrative champion", () => {
    const result = baseResult({
      candidates: [
        baseCandidate({ model_code: "A", is_champion: false, sharpe: 0.5 }),
        baseCandidate({ model_code: "M1", is_champion: true, sharpe: 1.2 }),
      ],
    });
    expect(resolveAuditChampion(result)?.model_code).toBe("M1");
  });
});

describe("buildAuditRunSummary", () => {
  it("maps job meta from result + request", () => {
    const summary = buildAuditRunSummary(baseResult(), baseRequest());
    expect(summary.jobId).toBe("job-abc");
    expect(summary.objective).toBe("max_sharpe");
    expect(summary.engine).toBe("optuna+pandas+pro");
    expect(summary.optimizationMode).toBe("pro_auto");
    expect(summary.dataSource).toBe("yfinance");
    expect(summary.championModel).toBe("M1");
    expect(summary.startDate).toBe("2020-01-01");
    expect(summary.endDate).toBe("2024-12-31");
  });
});

describe("buildAuditConstraintFields", () => {
  it("omits nullish optional fields", () => {
    const fields = buildAuditConstraintFields(baseRequest());
    expect(fields.some((f) => f.key === "objective")).toBe(true);
    expect(fields.some((f) => f.key === "client_ref")).toBe(false);
  });

  it("includes client_ref when set", () => {
    const fields = buildAuditConstraintFields(
      baseRequest({ client_ref: "demo-1" }),
    );
    expect(fields.find((f) => f.key === "client_ref")?.value).toBe("demo-1");
  });
});

describe("buildAuditUniverse", () => {
  it("derives holdings, supplements, and benchmark", () => {
    const u = buildAuditUniverse(
      baseResult(),
      baseRequest({
        universe_tickers: ["spy", "tlt", "qqq"],
        universe_supplement_tickers: ["btc-usd"],
        benchmark_ticker: "VT",
      }),
    );
    expect(u.holdings).toEqual(["SPY", "TLT"]);
    expect(u.universeTickers).toEqual(["SPY", "TLT", "QQQ"]);
    expect(u.supplements).toEqual(["BTC-USD"]);
    expect(u.benchmark).toBe("VT");
    expect(u.tradableCount).toBe(40);
  });
});

describe("buildAuditChampionParams", () => {
  it("formats champion params sorted", () => {
    const rows = buildAuditChampionParams(
      baseCandidate({ params: { lookback_days: 60, mode: "hrp" } }),
    );
    expect(rows.map((r) => r.key)).toEqual(["lookback_days", "mode"]);
    expect(rows[0].value).toBe("60");
  });
});

describe("buildAuditProRoundSummaries", () => {
  it("maps pro round snapshots", () => {
    const rows = buildAuditProRoundSummaries([
      {
        round: 1,
        improved: true,
        trials_in_round: 20,
        round_winner_model_code: "W1",
        incoming_champion_model_code: "C0",
        round_best_adjusted_score: 1.1,
        candidates: [],
        equity_curve: [],
        efficient_frontier: [],
        narrative_facts: {},
      },
    ]);
    expect(rows).toEqual([
      {
        round: 1,
        improved: true,
        trialsInRound: 20,
        winnerCode: "W1",
        championCode: "C0",
        score: 1.1,
      },
    ]);
  });
});

describe("buildAuditDataProvenance", () => {
  it("reads data_quality meta and marks price panel absent", () => {
    const p = buildAuditDataProvenance(baseResult());
    expect(p.requestedStart).toBe("2020-01-01");
    expect(p.effectiveStart).toBe("2020-01-15");
    expect(p.warmupDownloadStart).toBe("2019-07-01");
    expect(p.excludedLateListings).toEqual(["NEW1", "NEW2"]);
    expect(p.warning).toContain("late");
    expect(p.pricePanelInResult).toBe(false);
  });
});

describe("buildAuditFinalWeights / weight history", () => {
  it("builds final weight rows", () => {
    const rows = buildAuditFinalWeights(baseCandidate());
    expect(rows.map((r) => r.ticker)).toEqual(["SPY", "TLT"]);
    expect(rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100, 1);
  });

  it("summarizes weight history rebalances", () => {
    const summary = buildAuditWeightHistorySummary(
      baseCandidate({
        analytics: {
          weight_history: [
            { date: "2020-01-31", SPY: 0.5, TLT: 0.5 },
            { date: "2020-02-28", SPY: 0.6, TLT: 0.4 },
          ],
          weight_history_tickers: ["SPY", "TLT"],
        },
      }),
    );
    expect(summary.available).toBe(true);
    expect(summary.rebalanceCount).toBe(2);
    expect(summary.firstDate).toBe("2020-01-31");
    expect(summary.lastDate).toBe("2020-02-28");
    expect(summary.rows[1].topTickers[0]).toBe("SPY");
  });

  it("marks history unavailable when missing", () => {
    expect(buildAuditWeightHistorySummary(baseCandidate()).available).toBe(
      false,
    );
  });
});

describe("buildAuditPerformanceEvidence", () => {
  it("uses candidate equity when present else result curve", () => {
    const withOwn = buildAuditPerformanceEvidence(
      baseResult(),
      baseCandidate({
        equity_curve: [{ date: "2020-06-01", value: 1.05 }],
      }),
    );
    expect(withOwn.equityCurve).toEqual([{ date: "2020-06-01", value: 1.05 }]);
    expect(withOwn.metrics.find((m) => m.key === "sharpe")?.value).toBe(1.2);

    const fallback = buildAuditPerformanceEvidence(baseResult(), null);
    expect(fallback.equityCurve.length).toBe(3);
  });
});

describe("buildAuditClientContext", () => {
  it("flags present when client_context or overlay audit exists", () => {
    expect(buildAuditClientContext(baseRequest()).present).toBe(false);
    expect(
      buildAuditClientContext(
        baseRequest({
          client_context: { risk_tolerance: "moderate" },
        }),
      ).present,
    ).toBe(true);
    expect(
      buildAuditClientContext(baseRequest(), { session_id: "s1" }).present,
    ).toBe(true);
  });
});

describe("paginateSlice / filters", () => {
  it("paginates with safe page bounds", () => {
    const items = [1, 2, 3, 4, 5];
    expect(paginateSlice(items, 2, 2)).toEqual({
      items: [3, 4],
      page: 2,
      pageSize: 2,
      total: 5,
      totalPages: 3,
    });
    expect(paginateSlice(items, 99, 2).page).toBe(3);
    expect(paginateSlice(items, 0, 2).page).toBe(1);
  });

  it("filters by date range and ticker query", () => {
    const series = [
      { date: "2020-01-01", value: 1 },
      { date: "2020-06-01", value: 2 },
      { date: "2021-01-01", value: 3 },
    ];
    expect(filterByDateRange(series, "2020-02-01", "2020-12-31")).toEqual([
      { date: "2020-06-01", value: 2 },
    ]);
    expect(filterTickersByQuery(["SPY", "TLT", "QQQ"], "q")).toEqual(["QQQ"]);
  });
});

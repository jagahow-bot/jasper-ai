import { describe, expect, it } from "vitest";
import {
  slimTalkingSummaryOverlay,
  slimTalkingSummaryResult,
} from "./talking-summary-payload";
import type { BacktestResult } from "./types";
import { buildTalkingPoints } from "./rm-report-utils";
import { translate } from "./i18n";

function stubResult(overrides?: Partial<BacktestResult>): BacktestResult {
  return {
    job_id: "job-1",
    scenario_id: "s1",
    benchmark: "SPY",
    period: { start: "2020-01-01", end: "2024-01-01" },
    candidates: [
      {
        rank: 1,
        model_code: "M0001",
        is_champion: true,
        weights: { AAPL: 0.4, AGG: 0.3, CASH: 0.3 },
        sharpe: 1.1,
        cagr: 0.12,
        max_drawdown: 0.18,
        volatility: 0.14,
        needs_attainment: {
          within_group_bands: true,
          group_bands: [
            {
              group_id: "w_equity",
              actual_pct: 0.4,
              target_pct: 0.4,
              min_pct: 0.3,
              max_pct: 0.5,
              within_band: true,
            },
          ],
          within_class_quotas: false,
          class_quotas: [
            {
              asset_class: "bond",
              actual_pct: 0.1,
              target_pct: 0.2,
              within_class_quota: false,
            },
          ],
        },
        analytics: {
          exposure: { by_asset_class: { equity: 0.4, bond: 0.3, cash: 0.3 } },
          weight_history: [
            { date: "2024-01-01", AAPL: 0.4, AGG: 0.3, CASH: 0.3 },
          ],
        },
        equity_curve: Array.from({ length: 50 }, (_, i) => ({
          date: `2020-01-${String(i + 1).padStart(2, "0")}`,
          value: 100 + i,
        })),
      },
    ],
    equity_curve: [],
    efficient_frontier: [],
    narrative_facts: {
      objective: "max_sharpe",
      champion_model_code: "M0001",
      class_quota_unfilled: [
        { asset_class: "commodity", target_pct: 0.05, reason: "no_tickers" },
      ],
      dynamic_objective_timeline: [{ date: "2020-01-01", regime: "risk_on" }],
    },
    ...overrides,
  } as BacktestResult;
}

describe("slimTalkingSummaryResult", () => {
  it("keeps needs_attainment and class_quota_unfilled, drops curves", () => {
    const slim = slimTalkingSummaryResult(stubResult(), "M0001");
    const cand = (slim.candidates as Array<Record<string, unknown>>)[0];
    expect(cand.needs_attainment).toBeTruthy();
    expect(
      (cand.needs_attainment as { within_group_bands?: boolean })
        .within_group_bands,
    ).toBe(true);
    expect(cand.equity_curve).toBeUndefined();
    expect(
      (cand.analytics as { weight_history?: unknown } | undefined)
        ?.weight_history,
    ).toBeUndefined();
    const nf = slim.narrative_facts as Record<string, unknown>;
    expect(nf.class_quota_unfilled).toEqual([
      { asset_class: "commodity", target_pct: 0.05, reason: "no_tickers" },
    ]);
    expect(nf.dynamic_objective_timeline).toBeUndefined();
  });

  it("survives missing candidates without throwing", () => {
    const slim = slimTalkingSummaryResult(
      stubResult({ candidates: undefined as unknown as [] }),
    );
    expect(slim.candidates).toEqual([]);
  });
});

describe("slimTalkingSummaryOverlay", () => {
  it("returns null for empty input", () => {
    expect(slimTalkingSummaryOverlay(null)).toBeNull();
    expect(slimTalkingSummaryOverlay(undefined)).toBeNull();
  });

  it("keeps asks and profile, drops audit bulk", () => {
    const slim = slimTalkingSummaryOverlay({
      client_profile: { risk_tolerance: "balanced" },
      market_view: { stance: "neutral", narrative_summary: "steady" },
      allocation: { asset_classes: ["equity"] },
      universe: { prompts: ["quality"] },
      asks: [{ kind: "group_weight_band", group_id: "w_equity", target_pct: 0.4 }],
      audit: { rm_sign_off: { signed_at: "2026-01-01", transcript: "x".repeat(5000) } },
      confidence: 0.9,
      rationale: "ok rationale",
    });
    expect(slim?.client_profile).toEqual({ risk_tolerance: "balanced" });
    expect(slim?.asks).toHaveLength(1);
    expect(slim?.audit).toBeUndefined();
  });
});

describe("buildTalkingPoints with needs-era payloads", () => {
  it("does not throw on partial overlay or empty candidates", () => {
    const t = (key: string, params?: Record<string, string | number>) =>
      translate("zh", key, params);
    const points = buildTalkingPoints({
      metrics: [],
      holdingsDiff: [],
      overlay: {
        client_profile: { risk_tolerance: "balanced" },
      } as never,
      adjustedResult: {
        job_id: "j",
        scenario_id: "s",
        benchmark: "SPY",
        period: { start: "2020-01-01", end: "2024-01-01" },
        candidates: [],
        equity_curve: [],
        efficient_frontier: [],
        narrative_facts: {
          class_quota_unfilled: [{ asset_class: "bond", target_pct: 0.1 }],
        },
      },
      anchorLabel: "Skip baseline",
      objectiveKey: "max_sharpe",
      lang: "zh",
      t,
    });
    expect(points.length).toBeGreaterThan(0);
  });

  it("does not throw when overlay is missing nested profile/universe", () => {
    const t = (key: string, params?: Record<string, string | number>) =>
      translate("zh", key, params);
    expect(() =>
      buildTalkingPoints({
        metrics: [],
        holdingsDiff: [],
        overlay: {} as never,
        adjustedResult: stubResult(),
        anchorLabel: "SPY",
        objectiveKey: "max_sharpe",
        lang: "zh",
        t,
        customizedModelCode: "M0001",
      }),
    ).not.toThrow();
  });
});

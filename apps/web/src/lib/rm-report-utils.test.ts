import { describe, expect, it } from "vitest";

import type { BacktestResult } from "@/lib/types";
import type { ClientOverlay } from "@/lib/overlay-schema";
import {
  alignAndRebaseEquityCurves,
  buildBenchmarkCompareChartData,
  buildHoldingsDiff,
  buildMetricCompareRows,
  buildTalkingPoints,
  resolveCustomizedEquityCurve,
  type MetricCompareRow,
} from "./rm-report-utils";

const ZH_TALKING: Record<string, string> = {
  "institutional.equity": "股票",
  "institutional.bond": "債券",
  "institutional.commodity": "商品",
  "institutional.other": "其他",
  "objective.min_max_drawdown": "最小化最大回撤",
  "rm.talking.portfolioStructure":
    "本客製化配置以{assetMix}為主，前三大持股為{topHoldings}。開場可先說明：這是在客戶簽核的資產範圍內，依需求調整後的實際組成。",
  "rm.talking.portfolioHoldingsOnly":
    "前三大持股為{topHoldings}。可先帶客戶看核心標的，說明客製化配置的骨架。",
  "rm.talking.vsAnchorChanges":
    "相對基準（{anchor}）：{changes}——強調這些是為達成簽核目標而做的有意義調整，而非隨意換股。",
  "rm.talking.changeAdded": "新增 {ticker}（{pct}%）",
  "rm.talking.changeRemoved": "移除 {ticker}",
  "rm.talking.changeIncreased": "加碼 {ticker}（+{delta} 個百分點）",
  "rm.talking.changeDecreased": "減碼 {ticker}（-{delta} 個百分點）",
  "rm.talking.clientRiskTolerance":
    "客戶風險取向為{tolerance}，配置明顯偏{tilt}——可連結到簽核時對下行風險的關注。",
  "rm.talking.riskTolerance.conservative": "保守",
  "rm.talking.tilt.defensive": "防禦（債券權重較高）",
  "rm.talking.objective.min_max_drawdown":
    "本次優化目標為「{objective}」；客製化最大回撤為 {customized}，優於基準的 {anchor}（改善 {delta}）——以此說明目標確實反映在績效上。",
  "rm.talking.performanceTradeoff":
    "年化報酬略低於基準（{cagrDelta}），但{tradeoffs}——建議向客戶說明這是為換取更低回撤與更平穩體驗所做的取捨。",
  "rm.talking.tradeoffMdd": "最大回撤改善 {delta}",
  "rm.talking.tradeoffVol": "波動度降低 {delta}",
  "rm.talking.tradeoffGeneric": "整體風險較基準更低、路徑更平穩",
  "rm.talking.compliance":
    "提醒：以上為回測示意，僅供討論之用，並非投資建議；實際執行前請確認適合度與合規要求。",
};

function mockZhT(key: string, params?: Record<string, string | number>): string {
  let out = ZH_TALKING[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      out = out.replaceAll(`{${k}}`, String(v));
    }
  }
  return out;
}

function mockResult(
  overrides: {
    cagr: number;
    fullCagr: number;
    equity: { date: string; value: number }[];
  },
): BacktestResult {
  return {
    job_id: "job-1",
    scenario_id: "s1",
    benchmark: "SPY",
    period: { start: "2016-01-01", end: "2025-01-01" },
    candidates: [
      {
        rank: 1,
        model_code: "M0001",
        weights: { SPY: 1 },
        sharpe: 1,
        max_drawdown: -0.1,
        cagr: overrides.cagr,
        volatility: 0.15,
        equity_curve: overrides.equity,
        analytics: {
          sample_metrics: {
            in_sample: {
              sharpe: 1,
              cagr: overrides.cagr,
              max_drawdown: -0.1,
              volatility: 0.15,
            },
            full_sample: {
              sharpe: 1,
              cagr: overrides.fullCagr,
              max_drawdown: -0.1,
              volatility: 0.15,
            },
          },
        },
      },
    ],
    equity_curve: overrides.equity,
    efficient_frontier: [],
    narrative_facts: { oos_enabled: true },
  };
}

describe("rm-report-utils benchmark compare", () => {
  it("alignAndRebaseEquityCurves rebases both series to 100 at common start", () => {
    const aligned = alignAndRebaseEquityCurves(
      [
        { date: "2020-01-01", value: 100 },
        { date: "2020-06-01", value: 110 },
        { date: "2021-01-01", value: 130 },
      ],
      [
        { date: "2020-03-01", value: 100 },
        { date: "2020-06-01", value: 105 },
        { date: "2021-01-01", value: 108 },
      ],
    );

    expect(aligned).not.toBeNull();
    expect(aligned![0]).toEqual({
      date: "2020-06-01",
      anchor: 100,
      customized: 100,
    });
    expect(aligned!.at(-1)!.anchor).toBeGreaterThan(aligned!.at(-1)!.customized);
  });

  it("buildMetricCompareRows uses full_sample metrics when OOS is enabled", () => {
    const anchor = mockResult({
      cagr: 0.111,
      fullCagr: 0.12,
      equity: [
        { date: "2020-01-01", value: 100 },
        { date: "2021-01-01", value: 120 },
      ],
    });
    const customized = mockResult({
      cagr: 0.147,
      fullCagr: 0.08,
      equity: [
        { date: "2020-01-01", value: 100 },
        { date: "2021-01-01", value: 108 },
      ],
    });

    const rows = buildMetricCompareRows(anchor, customized, {
      cagr: "CAGR",
      sharpe: "Sharpe",
      mdd: "MDD",
      vol: "Vol",
    });

    const cagr = rows.find((r) => r.key === "cagr")!;
    expect(cagr.anchorDisplay).toBe("12.00%");
    expect(cagr.customizedDisplay).toBe("8.00%");
    expect(cagr.trafficLight).toBe("worse");
  });

  it("buildMetricCompareRows MDD delta uses severity (|c|−|a|), green when shallower", () => {
    const anchor = mockResult({
      cagr: 0.1,
      fullCagr: 0.1,
      equity: [
        { date: "2020-01-01", value: 100 },
        { date: "2021-01-01", value: 110 },
      ],
    });
    const customized = mockResult({
      cagr: 0.1,
      fullCagr: 0.1,
      equity: [
        { date: "2020-01-01", value: 100 },
        { date: "2021-01-01", value: 110 },
      ],
    });
    // Anchor deeper MDD (−34.29%) vs customized shallower (−33.49%).
    customized.candidates[0].analytics!.sample_metrics!.full_sample!.max_drawdown =
      -0.3349;
    anchor.candidates[0].analytics!.sample_metrics!.full_sample!.max_drawdown =
      -0.3429;

    const mdd = buildMetricCompareRows(anchor, customized, {
      cagr: "CAGR",
      sharpe: "Sharpe",
      mdd: "MDD",
      vol: "Vol",
    }).find((r) => r.key === "mdd")!;

    expect(mdd.deltaDisplay).toBe("-0.80%");
    expect(mdd.trafficLight).toBe("better");
  });

  it("buildMetricCompareRows uses selected trial when customizedModelCode is set", () => {
    const anchor = mockResult({
      cagr: 0.111,
      fullCagr: 0.12,
      equity: [
        { date: "2020-01-01", value: 100 },
        { date: "2021-01-01", value: 120 },
      ],
    });
    const customized = {
      ...mockResult({
        cagr: 0.147,
        fullCagr: 0.08,
        equity: [
          { date: "2020-01-01", value: 100 },
          { date: "2021-01-01", value: 108 },
        ],
      }),
      candidates: [
        {
          rank: 1,
          model_code: "M0001",
          weights: { SPY: 1 },
          sharpe: 1,
          max_drawdown: -0.1,
          cagr: 0.147,
          volatility: 0.15,
          equity_curve: [
            { date: "2020-01-01", value: 100 },
            { date: "2021-01-01", value: 108 },
          ],
          analytics: {
            sample_metrics: {
              full_sample: {
                sharpe: 1,
                cagr: 0.08,
                max_drawdown: -0.1,
                volatility: 0.15,
              },
            },
          },
        },
        {
          rank: 2,
          model_code: "M0007",
          weights: { QQQ: 1 },
          sharpe: 1.2,
          max_drawdown: -0.08,
          cagr: 0.2,
          volatility: 0.12,
          equity_curve: [
            { date: "2020-01-01", value: 100 },
            { date: "2021-01-01", value: 115 },
          ],
          analytics: {
            sample_metrics: {
              full_sample: {
                sharpe: 1.2,
                cagr: 0.15,
                max_drawdown: -0.08,
                volatility: 0.12,
              },
            },
          },
        },
      ],
    };

    const championRows = buildMetricCompareRows(anchor, customized, {
      cagr: "CAGR",
      sharpe: "Sharpe",
      mdd: "MDD",
      vol: "Vol",
    });
    const trialRows = buildMetricCompareRows(
      anchor,
      customized,
      {
        cagr: "CAGR",
        sharpe: "Sharpe",
        mdd: "MDD",
        vol: "Vol",
      },
      { customizedModelCode: "M0007" },
    );

    expect(championRows.find((r) => r.key === "cagr")!.customizedDisplay).toBe(
      "8.00%",
    );
    expect(trialRows.find((r) => r.key === "cagr")!.customizedDisplay).toBe(
      "15.00%",
    );
  });

  it("buildBenchmarkCompareChartData ending levels match full-sample CAGR ordering", () => {
    const anchor = mockResult({
      cagr: 0.111,
      fullCagr: 0.12,
      equity: [
        { date: "2020-01-01", value: 100 },
        { date: "2020-06-01", value: 106 },
        { date: "2021-01-01", value: 120 },
      ],
    });
    const customized = mockResult({
      cagr: 0.147,
      fullCagr: 0.08,
      equity: [
        { date: "2020-01-01", value: 100 },
        { date: "2020-06-01", value: 104 },
        { date: "2021-01-01", value: 108 },
      ],
    });

    const chart = buildBenchmarkCompareChartData(anchor, customized)!;
    const last = chart.at(-1)!;
    expect(last.anchor).toBeGreaterThan(last.customized);

    const cagr = buildMetricCompareRows(anchor, customized, {
      cagr: "CAGR",
      sharpe: "Sharpe",
      mdd: "MDD",
      vol: "Vol",
    }).find((r) => r.key === "cagr")!;
    expect(cagr.anchorValue).toBeGreaterThan(cagr.customizedValue);
  });

  it("does not fall back to champion equity when selected slim trial has no curve", () => {
    const anchor = mockResult({
      cagr: 0.1,
      fullCagr: 0.1,
      equity: [
        { date: "2020-01-01", value: 100 },
        { date: "2021-01-01", value: 110 },
      ],
    });
    const customized: BacktestResult = {
      ...mockResult({
        cagr: 0.12,
        fullCagr: 0.12,
        equity: [
          { date: "2020-01-01", value: 100 },
          { date: "2021-01-01", value: 112 },
        ],
      }),
      candidates: [
        {
          rank: 1,
          model_code: "M0023",
          is_champion: true,
          weights: { SPY: 1 },
          sharpe: 0.67,
          max_drawdown: -0.2,
          cagr: 0.15,
          volatility: 0.15,
          equity_curve: [
            { date: "2020-01-01", value: 100 },
            { date: "2021-01-01", value: 115 },
          ],
          analytics: {
            sample_metrics: {
              full_sample: {
                sharpe: 0.67,
                cagr: 0.157,
                max_drawdown: -0.2,
                volatility: 0.15,
              },
            },
          },
        },
        {
          rank: 2,
          model_code: "M0003",
          is_champion: false,
          weights: { QQQ: 1 },
          sharpe: 0.72,
          max_drawdown: -0.18,
          cagr: 0.18,
          volatility: 0.16,
          equity_curve: null as unknown as { date: string; value: number }[],
          analytics: {
            sample_metrics: {
              full_sample: {
                sharpe: 0.725,
                cagr: 0.1812,
                max_drawdown: -0.18,
                volatility: 0.16,
              },
            },
          },
        },
      ],
    };

    expect(
      resolveCustomizedEquityCurve(customized, {
        customizedModelCode: "M0003",
      }),
    ).toEqual([]);
    expect(
      buildBenchmarkCompareChartData(anchor, customized, {
        customizedModelCode: "M0003",
      }),
    ).toBeNull();

    // After merging a lazy curve, chart should follow M0003.
    customized.candidates[1].equity_curve = [
      { date: "2020-01-01", value: 100 },
      { date: "2021-01-01", value: 130 },
    ];
    const chart = buildBenchmarkCompareChartData(anchor, customized, {
      customizedModelCode: "M0003",
    })!;
    expect(chart.at(-1)!.customized).toBeCloseTo(130, 5);
  });
});

describe("buildTalkingPoints", () => {
  function mockMetrics(): MetricCompareRow[] {
    return [
      {
        key: "cagr",
        label: "CAGR",
        anchorValue: 0.12,
        customizedValue: 0.08,
        anchorDisplay: "12.00%",
        customizedDisplay: "8.00%",
        deltaDisplay: "-4.00%",
        trafficLight: "worse",
        lowerIsBetter: false,
      },
      {
        key: "mdd",
        label: "MDD",
        anchorValue: -0.245,
        customizedValue: -0.182,
        anchorDisplay: "-24.50%",
        customizedDisplay: "-18.20%",
        deltaDisplay: "-6.30%",
        trafficLight: "better",
        lowerIsBetter: true,
      },
      {
        key: "vol",
        label: "Vol",
        anchorValue: 0.18,
        customizedValue: 0.147,
        anchorDisplay: "18.00%",
        customizedDisplay: "14.70%",
        deltaDisplay: "-3.30%",
        trafficLight: "better",
        lowerIsBetter: true,
      },
      {
        key: "sharpe",
        label: "Sharpe",
        anchorValue: 0.9,
        customizedValue: 0.85,
        anchorDisplay: "0.90",
        customizedDisplay: "0.85",
        deltaDisplay: "-0.05",
        trafficLight: "worse",
        lowerIsBetter: false,
      },
    ];
  }

  function mockOverlay(): ClientOverlay {
    return {
      version: "1.0",
      audit: {
        session_id: "ovl-test-12345678",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        phase: "execute",
        conversation_turns: 3,
        source: "manual",
        rm_sign_off: {
          signed_at: "2026-01-01T00:00:00.000Z",
          rm_id: "rm-1",
        },
      },
      client_profile: { risk_tolerance: "conservative" },
      market_view: {
        stance: "risk_off",
        themes: ["defensive"],
        narrative_summary: "偏好防禦、控制回撤",
      },
      allocation: { asset_classes: ["equity", "bond"] },
      universe: { prompts: ["SPY anchor personalization"] },
      optimization: { objective: "min_max_drawdown" },
      confidence: 0.85,
      rationale: "Minimize drawdown for conservative client",
    };
  }

  it("produces 4-6 zh talking points for min-max-dd SPY personalization", () => {
    const anchor = mockResult({
      cagr: 0.12,
      fullCagr: 0.12,
      equity: [
        { date: "2020-01-01", value: 100 },
        { date: "2021-01-01", value: 120 },
      ],
    });
    anchor.candidates[0].weights = { SPY: 1 };
    anchor.candidates[0].analytics = {
      exposure: { by_asset_class: { equity: 1 } },
    };

    const customized = mockResult({
      cagr: 0.08,
      fullCagr: 0.08,
      equity: [
        { date: "2020-01-01", value: 100 },
        { date: "2021-01-01", value: 108 },
      ],
    });
    customized.candidates[0].weights = { SPY: 0.25, BND: 0.45, TLT: 0.18, GLD: 0.12 };
    customized.candidates[0].max_drawdown = -0.182;
    customized.candidates[0].analytics = {
      exposure: { by_asset_class: { equity: 0.25, bond: 0.63, commodity: 0.12 } },
    };

    const holdingsDiff = buildHoldingsDiff(anchor, customized, [
      { ticker: "SPY", weight: 1 },
    ]);
    const metrics = mockMetrics();

    const points = buildTalkingPoints({
      metrics,
      holdingsDiff,
      overlay: mockOverlay(),
      adjustedResult: customized,
      anchorLabel: "SPY 100%",
      objectiveKey: "min_max_drawdown",
      lang: "zh",
      t: mockZhT,
    });

    expect(points.length).toBeGreaterThanOrEqual(4);
    expect(points.length).toBeLessThanOrEqual(6);
    expect(points[0]).toContain("本客製化配置");
    expect(points[0]).toContain("股票");
    expect(points.some((p) => p.includes("相對基準"))).toBe(true);
    expect(points.some((p) => p.includes("最小化最大回撤"))).toBe(true);
    expect(points.some((p) => p.includes("年化報酬略低於基準"))).toBe(true);
    expect(points.at(-1)).toContain("回測示意");
  });

  it("recomputes talking points when customizedModelCode changes", () => {
    const anchor = mockResult({
      cagr: 0.12,
      fullCagr: 0.12,
      equity: [
        { date: "2020-01-01", value: 100 },
        { date: "2021-01-01", value: 120 },
      ],
    });
    anchor.candidates[0].weights = { SPY: 1 };

    const customized: BacktestResult = {
      ...mockResult({
        cagr: 0.1,
        fullCagr: 0.1,
        equity: [
          { date: "2020-01-01", value: 100 },
          { date: "2021-01-01", value: 110 },
        ],
      }),
      candidates: [
        {
          rank: 1,
          model_code: "M0023",
          is_champion: true,
          weights: { SPY: 0.8, BND: 0.2 },
          sharpe: 0.67,
          max_drawdown: -0.2,
          cagr: 0.15,
          volatility: 0.15,
          equity_curve: [],
          analytics: {
            exposure: { by_asset_class: { equity: 0.8, bond: 0.2 } },
            sample_metrics: {
              full_sample: {
                sharpe: 0.67,
                cagr: 0.157,
                max_drawdown: -0.2,
                volatility: 0.15,
              },
            },
          },
        },
        {
          rank: 2,
          model_code: "M0003",
          is_champion: false,
          weights: { QQQ: 0.7, TLT: 0.3 },
          sharpe: 0.72,
          max_drawdown: -0.18,
          cagr: 0.18,
          volatility: 0.16,
          equity_curve: [],
          analytics: {
            exposure: { by_asset_class: { equity: 0.7, bond: 0.3 } },
            sample_metrics: {
              full_sample: {
                sharpe: 0.725,
                cagr: 0.1812,
                max_drawdown: -0.18,
                volatility: 0.16,
              },
            },
          },
        },
      ],
    };

    const champPoints = buildTalkingPoints({
      metrics: mockMetrics(),
      holdingsDiff: buildHoldingsDiff(anchor, customized, undefined, {
        customizedModelCode: "M0023",
      }),
      overlay: mockOverlay(),
      adjustedResult: customized,
      anchorLabel: "US Large Cap",
      objectiveKey: "max_sharpe",
      lang: "zh",
      t: mockZhT,
      customizedModelCode: "M0023",
    });
    const trialPoints = buildTalkingPoints({
      metrics: mockMetrics(),
      holdingsDiff: buildHoldingsDiff(anchor, customized, undefined, {
        customizedModelCode: "M0003",
      }),
      overlay: mockOverlay(),
      adjustedResult: customized,
      anchorLabel: "US Large Cap",
      objectiveKey: "max_sharpe",
      lang: "zh",
      t: mockZhT,
      customizedModelCode: "M0003",
    });

    expect(champPoints[0]).toContain("SPY");
    expect(trialPoints[0]).toContain("QQQ");
    expect(champPoints[0]).not.toEqual(trialPoints[0]);
  });
});

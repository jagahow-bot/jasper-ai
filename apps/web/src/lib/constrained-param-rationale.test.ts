import { describe, expect, it } from "vitest";
import {
  buildConstrainedParamSetupRationale,
  isConstrainedParamSetupContext,
  isTechnicalConstrainedParamRationale,
  normalizeConstrainedScenarioStyle,
} from "./constrained-param-rationale";

const ZH: Record<string, string> = {
  "results.championWhyParamsConstrainedLead":
    "本次客製化在客戶既定的持倉宇宙上，比較幾個具名優化情境（{styles}），而非大規模隨機搜尋。",
  "results.championWhyParamsConstrained.anchor_close":
    "建議方案採「{styleLabel}」參數：在允許的客製化空間內小幅調整，盡量貼近基準組合並兼顧優化目標。",
  "results.championWhyParamsConstrained.full_drift":
    "建議方案採「{styleLabel}」參數：在客製化上限內盡量推進優化目標，允許與基準組合有較大配置差異。",
  "results.championWhyParamsConstrained.defensive":
    "建議方案採「{styleLabel}」參數：偏重降低波動與回撤，在客製化空間內偏向穩健配置。",
  "results.championWhyParamsConstrained.theme":
    "建議方案採「{styleLabel}」參數：在客製化空間內納入必納／主題標的，讓調整方向更貼近客戶指定主題。",
  "results.championWhyParamsConstrainedDriftBoth":
    "實際客製化偏離約 {drift}（上限 {cap}）",
  "results.championWhyParamsConstrainedDriftOnly": "實際客製化偏離約 {drift}",
  "results.championWhyParamsConstrainedCapOnly": "客製化上限 {cap}",
  "results.championWhyParamsConstrainedAllocator": "配置引擎為「{allocator}」",
  "results.championWhyParamsConstrainedMetricsJoin": "；",
  "results.championWhyParamsConstrainedMetrics": "{metrics}。",
  "results.proposalLabel.anchor_close": "貼近錨定",
  "results.proposalLabel.full_drift": "用滿客製化空間",
  "results.proposalLabel.defensive": "防禦型",
  "results.proposalLabel.theme": "主題表達",
  "allocator.mean_variance": "報酬—風險平衡",
  "allocator.min_var": "最低波動",
};

function tZh(key: string, vars?: Record<string, string | number>): string {
  let out = ZH[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      out = out.replaceAll(`{${k}}`, String(v));
    }
  }
  return out;
}

describe("constrained-param-rationale", () => {
  it("detects the technical English API fallback", () => {
    expect(
      isTechnicalConstrainedParamRationale(
        "Constrained customization mode: named optimizer scenarios on a fixed small universe (anchor_close / full_drift / defensive / theme).",
      ),
    ).toBe(true);
    expect(isTechnicalConstrainedParamRationale("正常的 AI 參數說明")).toBe(
      false,
    );
  });

  it("detects constrained context from narrative flags or champion params", () => {
    expect(
      isConstrainedParamSetupContext({ constrainedCustomization: true }),
    ).toBe(true);
    expect(
      isConstrainedParamSetupContext({
        scenarioStyle: "anchor_close",
        paramSource: "constrained_scenario",
      }),
    ).toBe(true);
    expect(isConstrainedParamSetupContext({})).toBe(false);
  });

  it("builds zh RM copy from champion scenario metadata", () => {
    const text = buildConstrainedParamSetupRationale({
      t: tZh,
      scenarioStyle: "anchor_close",
      styles: ["anchor_close", "full_drift", "defensive", "theme"],
      driftActual: 0.175,
      driftCap: 0.5,
      allocatorMode: "mean_variance",
    });
    expect(text).toContain("具名優化情境");
    expect(text).toContain("貼近錨定");
    expect(text).toContain("18%");
    expect(text).toContain("50%");
    expect(text).toContain("報酬—風險平衡");
    expect(text).not.toMatch(/Constrained customization mode/i);
    expect(text).not.toMatch(/anchor_close/);
  });

  it("normalizes known scenario styles only", () => {
    expect(normalizeConstrainedScenarioStyle("Full_Drift")).toBe("full_drift");
    expect(normalizeConstrainedScenarioStyle("other")).toBeNull();
  });
});

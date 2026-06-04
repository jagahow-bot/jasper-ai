import { describe, expect, it } from "vitest";
import {
  filterFrontierSamplesForDisplay,
  frontierSampleModelKey,
  frontierTooltipLabel,
} from "./efficient-frontier-chart";

describe("efficient-frontier-chart", () => {
  it("resolves sample model key from model_code or name", () => {
    expect(frontierSampleModelKey({ model_code: "M0005", name: "x" })).toBe(
      "M0005",
    );
    expect(frontierSampleModelKey({ name: "M0009" })).toBe("M0009");
    expect(frontierSampleModelKey({ name: "sample" })).toBeNull();
  });

  it("filters samples that duplicate output model codes", () => {
    const samples = [
      { model_code: "M0001", volatility: 0.2, return: 0.1, sharpe: 0.5 },
      { model_code: "M0005", volatility: 0.21, return: 0.11, sharpe: 0.52 },
      { name: "M0009", volatility: 0.19, return: 0.09, sharpe: 0.48 },
    ];
    const filtered = filterFrontierSamplesForDisplay(samples, [
      "M0005",
      "M0009",
    ]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.model_code).toBe("M0001");
  });

  it("tooltip label prefers model_code", () => {
    expect(
      frontierTooltipLabel({ model_code: "M0005", name: "legacy" }),
    ).toBe("M0005");
    expect(frontierTooltipLabel({ name: "M0010" })).toBe("M0010");
    expect(frontierTooltipLabel({})).toBe("sample");
  });
});

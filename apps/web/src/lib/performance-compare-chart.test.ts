import { describe, expect, it } from "vitest";
import {
  buildPerformanceCompareRows,
  dedupeCandidatesForPerformanceChart,
  normalizeModelCode,
  performanceCompareTickLabel,
  performanceCompareRowsByChartKey,
} from "./performance-compare-chart";

describe("performance-compare-chart", () => {
  it("normalizes blank model_code for axis labels", () => {
    expect(normalizeModelCode({ model_code: "  ", rank: 4 }, 3)).toBe("M?4");
    expect(normalizeModelCode({ model_code: "M0005", rank: 5 }, 0)).toBe("M0005");
  });

  it("dedupes champion re-sim duplicate model_code", () => {
    const candidates = [
      { model_code: "M0004", rank: 4, sharpe: 1.1, is_champion: false },
      { model_code: "M0005", rank: 5, sharpe: 1.2, is_champion: true },
      { model_code: "M0005", rank: 8, sharpe: 1.15, is_champion: false },
      { model_code: "M0006", rank: 6, sharpe: 1.0, is_champion: false },
    ];
    const deduped = dedupeCandidatesForPerformanceChart(candidates, "M0005");
    expect(deduped.map((c) => c.model_code)).toEqual(["M0004", "M0005", "M0006"]);
    expect(deduped.find((c) => c.model_code === "M0005")?.is_champion).toBe(true);
    expect(deduped.find((c) => c.model_code === "M0005")?.rank).toBe(5);
  });

  it("builds one row per model and champion tick label on that row", () => {
    const rows = buildPerformanceCompareRows({
      candidates: [
        { model_code: "M0004", rank: 4, sharpe: 1, cagr: 0.1, max_drawdown: -0.05 },
        { model_code: "M0005", rank: 5, sharpe: 1.2, cagr: 0.12, max_drawdown: -0.04, is_champion: true },
        { model_code: "M0005", rank: 9, sharpe: 1.1, cagr: 0.11, max_drawdown: -0.06 },
        { model_code: "M0006", rank: 6, sharpe: 0.9, cagr: 0.08, max_drawdown: -0.07 },
      ],
      championModelKey: "M0005",
      preserveTrialOrder: true,
      benchTicker: "SPY",
    });
    expect(rows).toHaveLength(3);
    const byKey = performanceCompareRowsByChartKey(rows);
    expect(rows.every((r) => performanceCompareTickLabel(byKey.get(r.chartKey)) !== "")).toBe(
      true,
    );
    const champ = rows.find((r) => r.model_code === "M0005");
    expect(champ?.isChampion).toBe(true);
    expect(performanceCompareTickLabel(champ)).toBe("M0005 ★");
  });

  it("sorts by model code when trial order is not preserved", () => {
    const rows = buildPerformanceCompareRows({
      candidates: [
        { model_code: "M0002", rank: 2, sharpe: 1 },
        { model_code: "M0001", rank: 1, sharpe: 1.1 },
      ],
      championModelKey: "M0001",
      preserveTrialOrder: false,
      benchTicker: "SPY",
    });
    expect(rows.map((r) => r.model_code)).toEqual(["M0001", "M0002"]);
  });
});

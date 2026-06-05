import { describe, expect, it } from "vitest";
import {
  buildPerformanceCompareRows,
  dedupeCandidatesForPerformanceChart,
  normalizeModelCode,
  performanceCompareTickLabel,
  performanceCompareRowsByChartKey,
  resolveChampionCandidateIndex,
  resolveChampionModelKey,
  resolveDefaultSelectedRowKey,
  candidateRowKey,
} from "./performance-compare-chart";

describe("performance-compare-chart", () => {
  it("normalizes blank model_code for axis labels", () => {
    expect(normalizeModelCode({ model_code: "  ", rank: 4 }, 3)).toBe("M?4");
    expect(normalizeModelCode({ model_code: "M0005", rank: 5 }, 0)).toBe("M0005");
  });

  it("keeps distinct trials that share model_code but differ in metrics", () => {
    const candidates = [
      { model_code: "M0005", rank: 5, sharpe: 1.2, cagr: 0.12, max_drawdown: -0.04 },
      { model_code: "M0005", rank: 8, sharpe: 0.85, cagr: 0.08, max_drawdown: -0.09 },
      { model_code: "M0006", rank: 6, sharpe: 1.0, cagr: 0.1, max_drawdown: -0.05 },
    ];
    const deduped = dedupeCandidatesForPerformanceChart(candidates, "M0005");
    expect(deduped).toHaveLength(3);
    expect(deduped.map((c) => c.sharpe)).toEqual([1.2, 0.85, 1.0]);
  });

  it("dedupes champion re-sim duplicate model_code", () => {
    const candidates = [
      { model_code: "M0004", rank: 4, sharpe: 1.1, cagr: 0.1, max_drawdown: -0.05, is_champion: false },
      {
        model_code: "M0005",
        rank: 5,
        sharpe: 1.2,
        cagr: 0.12,
        max_drawdown: -0.04,
        is_champion: true,
      },
      {
        model_code: "M0005",
        rank: 8,
        sharpe: 1.2,
        cagr: 0.12,
        max_drawdown: -0.04,
        is_champion: false,
      },
      { model_code: "M0006", rank: 6, sharpe: 1.0, cagr: 0.08, max_drawdown: -0.07, is_champion: false },
    ];
    const deduped = dedupeCandidatesForPerformanceChart(candidates, "M0005");
    expect(deduped.map((c) => c.model_code)).toEqual(["M0004", "M0005", "M0006"]);
    expect(deduped.find((c) => c.model_code === "M0005")?.is_champion).toBe(true);
    expect(deduped.find((c) => c.model_code === "M0005")?.rank).toBe(5);
  });

  it("builds one row per distinct trial after champion re-sim dedupe", () => {
    const rows = buildPerformanceCompareRows({
      candidates: [
        { model_code: "M0004", rank: 4, sharpe: 1, cagr: 0.1, max_drawdown: -0.05 },
        { model_code: "M0005", rank: 5, sharpe: 1.2, cagr: 0.12, max_drawdown: -0.04, is_champion: true },
        {
          model_code: "M0005",
          rank: 9,
          sharpe: 1.2,
          cagr: 0.12,
          max_drawdown: -0.04,
        },
        { model_code: "M0006", rank: 6, sharpe: 0.9, cagr: 0.08, max_drawdown: -0.07 },
      ],
      championModelKey: "M0005",
      championRowKey: "M0005-r5-i1",
      sortByModelCode: true,
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

  it("marks selected trial via selectedChartKey", () => {
    const rows = buildPerformanceCompareRows({
      candidates: [
        { model_code: "M0001", rank: 1, sharpe: 1.1, cagr: 0.1, max_drawdown: -0.05 },
        { model_code: "M0019", rank: 19, sharpe: 0.9, cagr: 0.08, max_drawdown: -0.07 },
      ],
      championModelKey: "M0001",
      sortByModelCode: true,
      benchTicker: "SPY",
      selectedChartKey: "M0019-r19-i1",
    });
    expect(rows.find((r) => r.model_code === "M0019")?.isSelected).toBe(true);
    expect(rows.find((r) => r.model_code === "M0001")?.isSelected).toBe(false);
  });

  it("prefers ai_recommended_model_code over champion_model_code", () => {
    const candidates = [
      { model_code: "M0001", rank: 1, sharpe: 1.5, is_champion: true },
      { model_code: "M0009", rank: 9, sharpe: 1.2, is_champion: false },
    ];
    expect(
      resolveChampionModelKey(candidates, {
        champion_model_code: "M0001",
        ai_recommended_model_code: "M0009",
      }),
    ).toBe("M0009");
  });

  it("prefers narrative_facts.champion_model_code", () => {
    const candidates = [
      { model_code: "M0001", rank: 1, sharpe: 1.5, is_champion: false },
      { model_code: "M0009", rank: 9, sharpe: 1.2, is_champion: true },
    ];
    expect(
      resolveChampionModelKey(candidates, { champion_model_code: "M0009" }),
    ).toBe("M0009");
  });

  it("resolveChampionCandidateIndex prefers AI over is_champion", () => {
    const candidates = [
      { model_code: "M0001", rank: 1, sharpe: 1.5, is_champion: false },
      { model_code: "M0007", rank: 7, sharpe: 1.2, is_champion: true },
    ];
    expect(
      resolveChampionCandidateIndex(candidates, {
        ai_recommended_model_code: "M0001",
      }),
    ).toBe(0);
    expect(resolveDefaultSelectedRowKey(candidates, {
      ai_recommended_model_code: "M0001",
    })).toBe("M0001-r1-i0");
  });

  it("marks only champion trial when duplicate model_code exists", () => {
    const candidates = [
      { model_code: "M0001", rank: 1, sharpe: 1.5, is_champion: false },
      { model_code: "M0001", rank: 9, sharpe: 1.2, is_champion: true },
    ];
    const championRowKey = "M0001-r9-i1";
    const rows = buildPerformanceCompareRows({
      candidates,
      championModelKey: "M0001",
      championRowKey,
      sortByModelCode: true,
      benchTicker: "SPY",
    });
    const champs = rows.filter((r) => r.isChampion);
    expect(champs).toHaveLength(1);
    expect(champs[0]?.chartKey).toBe(championRowKey);
  });

  it("keeps chart keys aligned with original candidate indices after dedupe", () => {
    const candidates = [
      { model_code: "M0004", rank: 4, sharpe: 1, cagr: 0.1, max_drawdown: -0.05 },
      { model_code: "M0005", rank: 5, sharpe: 1.2, cagr: 0.12, max_drawdown: -0.04, is_champion: true },
      {
        model_code: "M0005",
        rank: 9,
        sharpe: 1.2,
        cagr: 0.12,
        max_drawdown: -0.04,
      },
      { model_code: "M0006", rank: 6, sharpe: 0.9, cagr: 0.08, max_drawdown: -0.07 },
    ];
    const selectedChartKey = candidateRowKey(candidates[3], 3);
    const rows = buildPerformanceCompareRows({
      candidates,
      championModelKey: "M0005",
      championRowKey: candidateRowKey(candidates[1], 1),
      sortByModelCode: true,
      benchTicker: "SPY",
      selectedChartKey,
    });
    expect(rows.find((r) => r.model_code === "M0006")?.isSelected).toBe(true);
    expect(rows.filter((r) => r.isChampion)).toHaveLength(1);
  });

  it("defaults selection to is_champion trial not candidates[0]", () => {
    const candidates = [
      { model_code: "M0001", rank: 1, sharpe: 1.5, is_champion: false },
      { model_code: "M0009", rank: 9, sharpe: 1.2, is_champion: true },
    ];
    expect(resolveChampionModelKey(candidates, null)).toBe("M0009");
    expect(resolveChampionCandidateIndex(candidates, null)).toBe(1);
    expect(resolveDefaultSelectedRowKey(candidates, null)).toBe("M0009-r9-i1");
  });

  it("disambiguates champion re-sim duplicate model_code", () => {
    const candidates = [
      { model_code: "M0005", rank: 5, sharpe: 1.0, is_champion: false },
      { model_code: "M0005", rank: 9, sharpe: 1.2, is_champion: true },
    ];
    expect(resolveChampionCandidateIndex(candidates, null)).toBe(1);
    expect(resolveDefaultSelectedRowKey(candidates, null)).toBe("M0005-r9-i1");
  });

  it("sorts by model code when sortByModelCode is enabled", () => {
    const rows = buildPerformanceCompareRows({
      candidates: [
        { model_code: "M0010", rank: 10, sharpe: 1, is_champion: true },
        { model_code: "M0006", rank: 6, sharpe: 1.1 },
        { model_code: "M0001", rank: 1, sharpe: 1.2 },
      ],
      championModelKey: "M0010",
      championRowKey: "M0010-r10-i0",
      sortByModelCode: true,
      benchTicker: "SPY",
    });
    expect(rows.map((r) => r.model_code)).toEqual(["M0001", "M0006", "M0010"]);
    expect(rows.find((r) => r.model_code === "M0010")?.isChampion).toBe(true);
  });

  it("preserves input order when sortByModelCode is disabled", () => {
    const rows = buildPerformanceCompareRows({
      candidates: [
        { model_code: "M0002", rank: 2, sharpe: 1 },
        { model_code: "M0001", rank: 1, sharpe: 1.1 },
      ],
      championModelKey: "M0001",
      sortByModelCode: false,
      benchTicker: "SPY",
    });
    expect(rows.map((r) => r.model_code)).toEqual(["M0002", "M0001"]);
  });
});

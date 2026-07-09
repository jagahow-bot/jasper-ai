import { describe, expect, it } from "vitest";
import {
  buildHoldoutLeaderboard,
  dedupeLeaderboardRows,
  leaderboardSortValue,
  sortLeaderboardRows,
} from "./leaderboard";

describe("leaderboard", () => {
  it("dedupes duplicate model_code keeping best in-sample objective", () => {
    const rows = [
      { model_code: "M0016", in_sample_objective: 0.4 },
      { model_code: "M0016", in_sample_objective: 0.55 },
      { model_code: "M0008", in_sample_objective: 0.5 },
    ];
    const deduped = dedupeLeaderboardRows(rows);
    expect(deduped).toHaveLength(2);
    expect(
      deduped.find((r) => r.model_code === "M0016")?.in_sample_objective,
    ).toBe(0.55);
  });

  it("sorts by out-of-sample when requested", () => {
    const rows = [
      { model_code: "M0001", in_sample_objective: 0.9, out_of_sample_objective: 0.2 },
      { model_code: "M0002", in_sample_objective: 0.5, out_of_sample_objective: 0.8 },
    ];
    const sorted = sortLeaderboardRows(rows, "out_of_sample");
    expect(sorted.map((r) => r.model_code)).toEqual(["M0002", "M0001"]);
  });

  it("sorts by gap when requested", () => {
    const rows = [
      { model_code: "M0001", gap_objective: 0.1 },
      { model_code: "M0002", gap_objective: 0.4 },
    ];
    expect(leaderboardSortValue(rows[1], "gap")).toBe(0.4);
    expect(sortLeaderboardRows(rows, "gap").map((r) => r.model_code)).toEqual([
      "M0002",
      "M0001",
    ]);
  });

  it("buildHoldoutLeaderboard enriches full sample from candidate map", () => {
    const fullByCode = new Map([["M0003", 0.77]]);
    const out = buildHoldoutLeaderboard(
      [{ model_code: "M0003", in_sample_objective: 0.5 }],
      "full_sample",
      fullByCode,
    );
    expect(out[0].full_sample_objective).toBe(0.77);
  });
});

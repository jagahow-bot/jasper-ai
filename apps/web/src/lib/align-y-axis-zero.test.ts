import { describe, expect, it } from "vitest";
import { extentWithZero } from "./align-y-axis-zero";

describe("extentWithZero minSideRatio", () => {
  it("returns raw extent when no minSideRatio is given", () => {
    expect(extentWithZero([-1.7, 74.8])).toEqual([-1.7, 74.8]);
  });

  it("does not touch all-positive data (min stays at 0)", () => {
    expect(extentWithZero([10, 74.8], 0.12)).toEqual([0, 74.8]);
  });

  it("does not touch all-negative data (max stays at 0)", () => {
    expect(extentWithZero([-10, -2], 0.12)).toEqual([-10, 0]);
  });

  it("expands a squashed negative side to the minimum visible ratio", () => {
    const [min, max] = extentWithZero([-1.7, 74.8], 0.12);
    expect(max).toBe(74.8);
    const negFrac = -min / (max - min);
    expect(negFrac).toBeGreaterThanOrEqual(0.12 - 1e-9);
    // Never shrinks the real data range.
    expect(min).toBeLessThanOrEqual(-1.7);
  });

  it("expands a squashed positive side to the minimum visible ratio", () => {
    const [min, max] = extentWithZero([-74.8, 1.7], 0.12);
    expect(min).toBe(-74.8);
    const posFrac = max / (max - min);
    expect(posFrac).toBeGreaterThanOrEqual(0.12 - 1e-9);
    expect(max).toBeGreaterThanOrEqual(1.7);
  });

  it("leaves already-balanced data unchanged", () => {
    expect(extentWithZero([-20, 30], 0.12)).toEqual([-20, 30]);
  });
});

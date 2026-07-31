import { describe, expect, it } from "vitest";
import {
  ensureMaxHoldingsForCap,
  minHoldingsForCap,
} from "./min-holdings-for-cap";

describe("minHoldingsForCap", () => {
  it("requires holdings > 1/maxWeight", () => {
    expect(minHoldingsForCap(0.2)).toBe(6);
    expect(minHoldingsForCap(0.25)).toBe(5);
    expect(minHoldingsForCap(0.08)).toBe(13);
  });

  it("ensureMaxHoldingsForCap bumps too-low values", () => {
    expect(ensureMaxHoldingsForCap(0.2, 4)).toBe(6);
    expect(ensureMaxHoldingsForCap(0.25, 30)).toBe(30);
  });
});

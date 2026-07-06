import { describe, expect, it } from "vitest";
import { classBudgetFromParams, planClassSlots } from "./asset-class-policy";

describe("planClassSlots", () => {
  it("allocates 6 equity / 4 bond for 60/40 on max_holdings=10", () => {
    expect(planClassSlots(10, { equity: 0.6, bond: 0.4 })).toEqual({
      equity: 6,
      bond: 4,
    });
  });

  it("only includes active classes from params filter", () => {
    const budget = classBudgetFromParams(
      { w_equity: 0.5, w_bond: 0.5, w_commodity: 0.3 },
      ["equity", "bond"],
    );
    const slots = planClassSlots(10, budget);
    expect(Object.keys(slots).sort()).toEqual(["bond", "equity"]);
    expect(slots.equity + slots.bond).toBe(10);
  });

  it("risk_off gives more bond slots than risk_on", () => {
    const riskOff = planClassSlots(10, { equity: 0.2, bond: 0.8 });
    const riskOn = planClassSlots(10, { equity: 0.8, bond: 0.2 });
    expect(riskOff.bond).toBeGreaterThan(riskOn.bond);
  });
});

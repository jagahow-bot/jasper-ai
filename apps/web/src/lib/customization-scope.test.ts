import { describe, expect, it } from "vitest";
import {
  effectiveScopeGroupIds,
  toggleScopeGroupId,
} from "@/lib/clients";

describe("effectiveScopeGroupIds", () => {
  const groups = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("returns explicit ids when provided", () => {
    expect(effectiveScopeGroupIds(groups, ["b"])).toEqual(["b"]);
  });

  it("treats empty selection as all groups", () => {
    expect(effectiveScopeGroupIds(groups, [])).toEqual(["a", "b", "c"]);
  });
});

describe("toggleScopeGroupId", () => {
  const all = ["a", "b", "c"];

  it("unchecks a selected group when more than one remain", () => {
    expect(toggleScopeGroupId(["a", "b", "c"], "b", all)).toEqual(["a", "c"]);
  });

  it("checks an unselected group", () => {
    expect(toggleScopeGroupId(["a"], "c", all)).toEqual(["a", "c"]);
  });

  it("refuses to clear the last selected group", () => {
    expect(toggleScopeGroupId(["a"], "a", all)).toEqual(["a"]);
  });

  it("materializes all-ids when starting from empty (all-selected)", () => {
    expect(toggleScopeGroupId([], "b", all)).toEqual(["a", "c"]);
  });
});

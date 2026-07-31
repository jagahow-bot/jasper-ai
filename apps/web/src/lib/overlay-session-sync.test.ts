import { describe, expect, it } from "vitest";
import {
  shouldPushUpToParent,
  shouldSyncDownFromParent,
} from "./overlay-session-sync";

describe("overlay-session-sync", () => {
  it("blocks sync-down of the value we just pushed (echo)", () => {
    const local = [{ role: "user" as const, content: "hi" }];
    const lastPushed = local;
    // Parent has not painted yet, or echoed our push back.
    expect(shouldSyncDownFromParent(local, lastPushed)).toBe(false);
  });

  it("allows sync-down when parent resets to a new reference", () => {
    const lastPushed = [{ role: "user" as const, content: "hi" }];
    const incoming: typeof lastPushed = [];
    expect(shouldSyncDownFromParent(incoming, lastPushed)).toBe(true);
  });

  it("blocks push-up when local still matches last pushed", () => {
    const messages: { role: "user"; content: string }[] = [];
    expect(shouldPushUpToParent(messages, messages)).toBe(false);
  });

  it("allows push-up after a local append (prevents A↔M oscillation)", () => {
    const parentStillHas: { role: "user" | "assistant"; content: string }[] = [
      { role: "user", content: "need AI" },
    ];
    const localAfterInterpret = [
      ...parentStillHas,
      { role: "assistant" as const, content: "clarify…" },
    ];
    // lastPushed still equals the stale parent prop until we push.
    expect(shouldSyncDownFromParent(parentStillHas, parentStillHas)).toBe(
      false,
    );
    expect(shouldPushUpToParent(localAfterInterpret, parentStillHas)).toBe(
      true,
    );
  });

  it("treats distinct empty arrays as different (parent reset [] vs prior [])", () => {
    const a: unknown[] = [];
    const b: unknown[] = [];
    expect(shouldSyncDownFromParent(b, a)).toBe(true);
    expect(shouldPushUpToParent(b, a)).toBe(true);
  });
});

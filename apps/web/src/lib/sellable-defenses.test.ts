import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * D10: defense-in-depth — every suggestion surface must import sellable-overrides.
 */
const DEFENSE_FILES = [
  "app/api/overlay/interpret/route.ts",
  "app/api/universe/filter/route.ts",
  "lib/overlay-filter-proposals.ts",
  "lib/universe-filter-fallback.ts",
  "lib/resolve-overlay-universe.ts",
  "lib/direct-indexing.ts",
  "components/OverlayConversationPanel.tsx",
  "components/OverlayChatTimeline.tsx",
];

describe("sellable defense import integrity (D10)", () => {
  it("all eight suggestion surfaces import sellable-overrides", () => {
    const root = join(__dirname, "..");
    for (const rel of DEFENSE_FILES) {
      const src = readFileSync(join(root, rel), "utf8");
      expect(src, rel).toMatch(/sellable-overrides/);
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  expandBulkInclude,
  expandBulkIncludeInExtract,
  matchThemeToUniverseItems,
} from "@/lib/overlay-bulk-include";
import type { OverlayExtractOutput } from "@/lib/overlay-schema";
import { sellableCtxFromTickers } from "@/lib/sellable-overrides";
import { getUniverseItems } from "@/lib/universe";

function baseExtract(
  patch: Partial<OverlayExtractOutput["universe"]> = {},
): OverlayExtractOutput {
  return {
    client_profile: {},
    market_view: {
      stance: "neutral",
      narrative_summary: "Test narrative summary for overlay extract.",
      themes: [],
    },
    allocation: { asset_classes: ["equity", "bond"] },
    universe: {
      prompts: ["test prompt for universe"],
      ...patch,
    },
    optimization: { objective: "max_sharpe" },
    deployment_schedule: { mode: "lump_sum" },
    clarification_questions: [],
    confidence: 0.8,
    rationale: "Test rationale long enough for schema min length.",
  };
}

describe("expandBulkInclude", () => {
  it("U1: expands alternative to full sellable set with bulk_id", () => {
    const { proposed, reports } = expandBulkInclude(
      [{ id: "bulk-1", label: "另類資產全部", asset_class: "alternative" }],
      { lang: "zh" },
    );
    expect(reports[0]?.matched).toBeGreaterThan(0);
    expect(proposed.length).toBe(reports[0]!.kept);
    expect(proposed.every((p) => p.bulk_id === "bulk-1")).toBe(true);
    expect(proposed.every((p) => p.asset_class === "alternative")).toBe(true);
    expect(proposed[0]?.rationale).toContain("整類納入");
  });

  it("U2: bond ∩ etf expands full count without truncate", () => {
    const catalogBondEtf = getUniverseItems().filter(
      (u) =>
        u.asset_class === "bond" &&
        (u.product_type ?? "etf").toLowerCase() === "etf",
    ).length;
    const { proposed, reports } = expandBulkInclude(
      [
        {
          id: "bulk-1",
          label: "債券類 ETF",
          asset_class: "bond",
          product_type: "etf",
        },
      ],
      { lang: "en" },
    );
    expect(reports[0]?.matched).toBe(catalogBondEtf);
    expect(reports[0]?.kept).toBe(proposed.length);
    expect(proposed.length).toBeGreaterThan(50);
    // product_type order: all etf first
    expect(
      proposed.every((p) => {
        const item = getUniverseItems().find(
          (u) => u.ticker.toUpperCase() === p.ticker,
        );
        return (item?.product_type ?? "etf").toLowerCase() === "etf";
      }),
    ).toBe(true);
  });

  it("U4: category alt_hedge expands", () => {
    const { proposed, reports } = expandBulkInclude(
      [{ id: "bulk-1", label: "避險", category: "alt_hedge" }],
      { lang: "zh" },
    );
    expect(reports[0]?.matched).toBe(4);
    expect(proposed.length).toBe(4);
  });

  it("U5: theme AI matches catalog names", () => {
    const items = getUniverseItems();
    const hit = matchThemeToUniverseItems("AI", items);
    expect(hit.length).toBeGreaterThan(0);
    const { proposed, reports } = expandBulkInclude(
      [{ id: "bulk-1", label: "AI 全部", theme: "AI" }],
      { lang: "zh" },
    );
    expect(reports[0]?.unresolved).toBeFalsy();
    expect(proposed.length).toBeGreaterThan(0);
  });

  it("U5b: unknown theme unresolved when theme-only", () => {
    const { proposed, reports } = expandBulkInclude(
      [{ id: "bulk-1", label: "xyzzy", theme: "xyzzyqqqnotfound" }],
      { lang: "en" },
    );
    expect(reports[0]?.unresolved).toBe(true);
    expect(proposed.length).toBe(0);
  });

  it("U6: dedupes exclude/supplement/prior but keeps anchor-like tickers", () => {
    const { proposed: all } = expandBulkInclude(
      [{ id: "bulk-1", label: "另類", asset_class: "alternative" }],
      { lang: "zh" },
    );
    const sample = all[0]!.ticker;
    const other = all[1]!.ticker;
    const { proposed, reports } = expandBulkInclude(
      [{ id: "bulk-1", label: "另類", asset_class: "alternative" }],
      {
        lang: "zh",
        excludeTickers: new Set([sample]),
        supplementTickers: new Set([other]),
        // "anchor" ticker not excluded — still present if not in exclude/supplement
      },
    );
    const tickers = new Set(proposed.map((p) => p.ticker));
    expect(tickers.has(sample)).toBe(false);
    expect(tickers.has(other)).toBe(false);
    expect(reports[0]!.kept).toBe(reports[0]!.matched - 2);
  });

  it("U7: illegal asset_class / empty scope skipped", () => {
    const { proposed, reports } = expandBulkInclude(
      [
        {
          id: "bad",
          label: "crypto",
          asset_class: "crypto" as "equity",
        },
        { id: "empty", label: "empty" },
      ],
      { lang: "en" },
    );
    expect(proposed.length).toBe(0);
    expect(reports.every((r) => r.matched === 0 && r.kept === 0)).toBe(true);
  });

  it("U8: server ctx nonSellable filters", () => {
    const { proposed: baseline } = expandBulkInclude(
      [{ id: "bulk-1", label: "債券 ETF", asset_class: "bond", product_type: "etf" }],
      { lang: "en" },
    );
    const block = baseline[0]!.ticker;
    const ctx = sellableCtxFromTickers([block]);
    const { proposed } = expandBulkInclude(
      [{ id: "bulk-1", label: "債券 ETF", asset_class: "bond", product_type: "etf" }],
      { lang: "en", ctx },
    );
    expect(proposed.some((p) => p.ticker === block)).toBe(false);
    expect(proposed.length).toBe(baseline.length - 1);
  });

  it("U10: deterministic ordering", () => {
    const a = expandBulkInclude(
      [{ id: "bulk-1", label: "另類", asset_class: "alternative" }],
      { lang: "zh" },
    );
    const b = expandBulkInclude(
      [{ id: "bulk-1", label: "另類", asset_class: "alternative" }],
      { lang: "zh" },
    );
    expect(a.proposed.map((p) => p.ticker)).toEqual(
      b.proposed.map((p) => p.ticker),
    );
  });
});

describe("expandBulkIncludeInExtract", () => {
  it("appends bulk after curated proposed", () => {
    const extract = baseExtract({
      proposed_tickers: [
        { ticker: "SPY", name: "S&P 500", rationale: "core" },
      ],
      bulk_include: [
        { id: "bulk-1", label: "另類全部", asset_class: "alternative" },
      ],
    });
    const { extract: out, reports } = expandBulkIncludeInExtract(extract, {
      lang: "zh",
    });
    expect(reports[0]?.kept).toBeGreaterThan(0);
    expect(out.universe.proposed_tickers?.[0]?.ticker).toBe("SPY");
    expect(
      out.universe.proposed_tickers?.some((p) => p.bulk_id === "bulk-1"),
    ).toBe(true);
  });

  it("skips expand for direct_index", () => {
    const extract = baseExtract({
      construction: "direct_index",
      bulk_include: [
        { id: "bulk-1", label: "另類全部", asset_class: "alternative" },
      ],
    });
    const { extract: out, reports } = expandBulkIncludeInExtract(extract, {
      lang: "en",
    });
    expect(reports.length).toBe(0);
    expect(out.universe.bulk_include).toBeUndefined();
  });
});

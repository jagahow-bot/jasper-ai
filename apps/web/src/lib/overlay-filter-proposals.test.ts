import { describe, expect, it } from "vitest";
import type { ClientOverlay, OverlayProposedTicker } from "@/lib/overlay-schema";
import {
  clearProposedTickers,
  decideFilterProposalInterrupt,
  mergeFilterProposedIntoOverlay,
  novelFilterProposedTickers,
  overlayAlreadyShowsProposedTickers,
  overlayPromptsKey,
} from "./overlay-filter-proposals";

function baseOverlay(
  partial: Partial<ClientOverlay["universe"]> = {},
): ClientOverlay {
  return {
    version: "1.0",
    audit: {
      session_id: "ovl-test-session-01",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      phase: "execute",
      conversation_turns: 1,
      source: "manual",
      rm_sign_off: {
        signed_at: "2026-01-01T00:00:00.000Z",
        rm_id: "rm-1",
      },
    },
    client_profile: {},
    market_view: {
      stance: "neutral",
      themes: [],
      narrative_summary: "Neutral stance for test overlay mapping.",
    },
    allocation: {
      asset_classes: ["equity", "bond"],
      max_single_position_pct: 0.4,
    },
    universe: {
      prompts: partial.prompts ?? ["AI industry exposure"],
      supplement_tickers: partial.supplement_tickers,
      exclude_tickers: partial.exclude_tickers,
      proposed_tickers: partial.proposed_tickers,
    },
    optimization: {
      objective: "max_sharpe",
      trials: 25,
    },
    confidence: 0.9,
    rationale: "Test overlay for filter proposal interrupt logic.",
  };
}

const AI: OverlayProposedTicker = {
  ticker: "BOTZ",
  name: "Robotics ETF",
  rationale: "AI theme",
};
const AI2: OverlayProposedTicker = {
  ticker: "IRBO",
  name: "Robotics & AI ETF",
};
const GOLD: OverlayProposedTicker = {
  ticker: "GLD",
  name: "Gold",
};

describe("overlay-filter-proposals", () => {
  it("overlayPromptsKey fingerprints prompts", () => {
    expect(overlayPromptsKey(baseOverlay({ prompts: ["a", "b"] }))).toBe("a\0b");
    expect(overlayPromptsKey(baseOverlay({ prompts: [] }))).toBe("");
  });

  it("novelFilterProposedTickers skips supplements and pending proposed", () => {
    const overlay = baseOverlay({
      supplement_tickers: ["BOTZ"],
      proposed_tickers: [AI2],
    });
    expect(
      novelFilterProposedTickers(overlay, [AI, AI2, GOLD]).map((p) => p.ticker),
    ).toEqual(["GLD"]);
  });

  it("mergeFilterProposedIntoOverlay appends and caps at 12", () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      ticker: `T${i}`,
    }));
    const merged = mergeFilterProposedIntoOverlay(
      baseOverlay({ proposed_tickers: [AI] }),
      many,
    );
    expect(merged.universe.proposed_tickers).toHaveLength(12);
    expect(merged.universe.proposed_tickers?.[0]?.ticker).toBe("BOTZ");
  });

  it("first confirm with novel filter matches interrupts once", () => {
    const overlay = baseOverlay();
    const first = decideFilterProposalInterrupt({
      overlay,
      filterProposedTickers: [AI, AI2],
      surfacedKey: null,
    });
    expect(first.action).toBe("interrupt");
    if (first.action !== "interrupt") return;
    expect(first.overlay.universe.proposed_tickers?.map((p) => p.ticker)).toEqual([
      "BOTZ",
      "IRBO",
    ]);
    expect(first.promptsKey).toBe(overlayPromptsKey(overlay));
  });

  it("re-confirm with same prompts proceeds even if filter invents new tickers", () => {
    const overlay = baseOverlay({ proposed_tickers: [AI, AI2] });
    const promptsKey = overlayPromptsKey(overlay);
    const second = decideFilterProposalInterrupt({
      overlay,
      // Non-deterministic filter returns yet another novel ticker
      filterProposedTickers: [AI, AI2, GOLD],
      surfacedKey: promptsKey,
    });
    expect(second.action).toBe("proceed");
    expect(second.overlay.universe.proposed_tickers).toBeUndefined();
  });

  it("does not reopen when filter only returns already-pending proposed", () => {
    const overlay = baseOverlay({ proposed_tickers: [AI, AI2] });
    const decision = decideFilterProposalInterrupt({
      overlay,
      filterProposedTickers: [AI, AI2],
      surfacedKey: null,
    });
    expect(decision.action).toBe("proceed");
    expect(decision.overlay.universe.proposed_tickers).toBeUndefined();
  });

  it("proceeds when overlay already lists proposed tickers even if filter invents more", () => {
    // Chat already showed「建議參考標的」— confirm must not open another filter pass.
    const overlay = baseOverlay({
      proposed_tickers: [
        { ticker: "BND", name: "Total Bond" },
        { ticker: "AGG", name: "Aggregate Bond" },
        { ticker: "TLT", name: "20+ Year Treasury" },
        { ticker: "USMV", name: "Min Vol" },
      ],
    });
    const decision = decideFilterProposalInterrupt({
      overlay,
      filterProposedTickers: [
        { ticker: "BND" },
        { ticker: "AGG" },
        { ticker: "IEF", name: "7-10 Year Treasury" },
        { ticker: "LQD", name: "Investment Grade Corp" },
      ],
      surfacedKey: null,
    });
    expect(decision.action).toBe("proceed");
    expect(decision.overlay.universe.proposed_tickers).toBeUndefined();
  });

  it("overlayAlreadyShowsProposedTickers detects summary listing", () => {
    expect(overlayAlreadyShowsProposedTickers(baseOverlay())).toBe(false);
    expect(
      overlayAlreadyShowsProposedTickers(baseOverlay({ proposed_tickers: [AI] })),
    ).toBe(true);
  });

  it("clearProposedTickers is a no-op when empty", () => {
    const overlay = baseOverlay();
    expect(clearProposedTickers(overlay)).toBe(overlay);
  });
});

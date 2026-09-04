import { describe, expect, it } from "vitest";
import type { ClientOverlay, OverlayProposedTicker } from "@/lib/overlay-schema";
import {
  clearProposedTickers,
  decideFilterProposalInterrupt,
  ensureProposedTickersForReview,
  instrumentNeedsKey,
  isTickerReviewBlocking,
  mergeFilterProposedIntoOverlay,
  novelFilterProposedTickers,
  overlayAlreadyShowsProposedTickers,
  overlayNeedsNewInstruments,
  overlayPromptsKey,
  proposedTickersAfterClarificationDedup,
  synthesizeThemeProposedTickers,
  tickersNamedInClarifications,
} from "./overlay-filter-proposals";
import type { OverlayClarification } from "./overlay-schema";

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

  it("sign-off never interrupts even with novel filter matches", () => {
    // Confirm must leave propose flow — filter novels must not reopen suggestions.
    const overlay = baseOverlay();
    const decision = decideFilterProposalInterrupt({
      overlay,
      filterProposedTickers: [AI, AI2, GOLD],
      surfacedKey: null,
    });
    expect(decision.action).toBe("proceed");
    expect(decision.overlay.universe.proposed_tickers).toBeUndefined();
  });

  it("sign-off clears already-listed proposed tickers and proceeds", () => {
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
        { ticker: "IEF", name: "7-10 Year Treasury" },
        { ticker: "LQD", name: "Investment Grade Corp" },
      ],
      surfacedKey: null,
    });
    expect(decision.action).toBe("proceed");
    expect(decision.overlay.universe.proposed_tickers).toBeUndefined();
  });

  it("re-confirm with prior surfacedKey still proceeds", () => {
    const overlay = baseOverlay({ proposed_tickers: [AI, AI2] });
    const promptsKey = overlayPromptsKey(overlay);
    const second = decideFilterProposalInterrupt({
      overlay,
      filterProposedTickers: [AI, AI2, GOLD],
      surfacedKey: promptsKey,
    });
    expect(second.action).toBe("proceed");
    expect(second.overlay.universe.proposed_tickers).toBeUndefined();
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

const AI_THEME_CLARIFICATIONS: OverlayClarification[] = [
  {
    id: "q-etf",
    question: "偏好採用哪種 AI 主題 ETF 布局？",
    options: [
      { id: "aiq-botz", label: "AIQ + BOTZ 綜合布局" },
      { id: "smh", label: "納入 SMH 半導體晶片" },
      { id: "algo", label: "由演算法從池中挑選" },
    ],
  },
];

describe("clarification / proposed_tickers dedupe", () => {
  it("extracts tickers named in clarification option labels", () => {
    const proposed = [
      { ticker: "BOTZ" },
      { ticker: "AIQ" },
      { ticker: "SMH" },
    ];
    const covered = tickersNamedInClarifications(
      AI_THEME_CLARIFICATIONS,
      proposed,
    );
    expect([...covered].sort()).toEqual(["AIQ", "BOTZ", "SMH"]);
  });

  it("hides proposed tickers already offered as clarification chips", () => {
    const proposed = [
      { ticker: "BOTZ", name: "Robotics" },
      { ticker: "AIQ", name: "AI ETF" },
      { ticker: "SMH", name: "Semis" },
      { ticker: "IRBO", name: "Robotics & AI" },
    ];
    const visible = proposedTickersAfterClarificationDedup(
      proposed,
      AI_THEME_CLARIFICATIONS,
    );
    expect(visible.map((p) => p.ticker)).toEqual(["IRBO"]);
  });

  it("shows all proposed tickers when no pending clarifications", () => {
    const proposed = [
      { ticker: "BOTZ" },
      { ticker: "AIQ" },
      { ticker: "SMH" },
    ];
    expect(
      proposedTickersAfterClarificationDedup(proposed, []).map((p) => p.ticker),
    ).toEqual(["BOTZ", "AIQ", "SMH"]);
  });

  it("hides entire panel when every proposed ticker is in clarification options", () => {
    const proposed = [
      { ticker: "BOTZ" },
      { ticker: "AIQ" },
      { ticker: "SMH" },
    ];
    expect(
      proposedTickersAfterClarificationDedup(proposed, AI_THEME_CLARIFICATIONS),
    ).toEqual([]);
  });

  it("leaves proposed list unchanged when clarifications have no ticker names", () => {
    const clarifications: OverlayClarification[] = [
      {
        id: "q-risk",
        question: "這筆投資的風險屬性偏好？",
        options: [
          { id: "conservative", label: "保守" },
          { id: "moderate", label: "穩健" },
        ],
      },
    ];
    const proposed = [{ ticker: "BOTZ" }, { ticker: "AIQ" }];
    expect(
      proposedTickersAfterClarificationDedup(proposed, clarifications).map(
        (p) => p.ticker,
      ),
    ).toEqual(["BOTZ", "AIQ"]);
  });
});

describe("thematic ticker review gate", () => {
  const greenBondOverlay = (): ClientOverlay =>
    baseOverlay({
      prompts: ["50% green bond fixed income", "40% ESG equity", "10% utilities"],
      proposed_tickers: undefined,
      supplement_tickers: undefined,
    });

  function withThemes(overlay: ClientOverlay): ClientOverlay {
    return {
      ...overlay,
      market_view: {
        ...overlay.market_view,
        themes: ["green_bond", "esg", "utilities"],
        narrative_summary:
          "Client wants 50% green bonds, 40% ESG equity (70% US / 30% Europe-Asia), 10% utilities/infra, max DD -8%.",
      },
      allocation: {
        ...overlay.allocation,
        sleeve_targets: {
          green_bond: 0.5,
          esg_equity: 0.4,
          utilities_infra: 0.1,
        },
      },
      asks: [
        {
          id: "ask-green",
          title: "綠色債券固定收益 50%",
          summary: "配置約五成綠債／固定收益。",
          kind: "group_weight_band",
          group_id: "green_bond",
          target_pct: 0.5,
          status: "proposed",
        },
      ],
    };
  }

  it("overlayNeedsNewInstruments detects thematic sleeves", () => {
    expect(
      overlayNeedsNewInstruments(
        baseOverlay({ prompts: ["Maintain existing core book"] }),
      ),
    ).toBe(false);
    expect(overlayNeedsNewInstruments(withThemes(greenBondOverlay()))).toBe(
      true,
    );
  });

  it("synthesizes catalog proposals when LLM left proposed_tickers empty", () => {
    const overlay = withThemes(greenBondOverlay());
    const proposed = synthesizeThemeProposedTickers(overlay, "zh");
    const tickers = proposed.map((p) => p.ticker);
    expect(tickers.length).toBeGreaterThan(0);
    expect(tickers.some((t) => ["AGG", "BND", "BNDX"].includes(t))).toBe(true);
    expect(tickers.some((t) => ["ESGU", "ESGV", "SUSA"].includes(t))).toBe(
      true,
    );
    expect(tickers.some((t) => ["XLU", "VPU", "IDU", "PAVE"].includes(t))).toBe(
      true,
    );
  });

  it("ensureProposedTickersForReview fills empty thematic overlays", () => {
    const overlay = withThemes(greenBondOverlay());
    const ensured = ensureProposedTickersForReview(overlay, "zh");
    expect(ensured.universe.proposed_tickers?.length).toBeGreaterThan(0);
  });

  it("ensureProposedTickersForReview is a no-op when supplements already locked", () => {
    const overlay = withThemes(
      baseOverlay({
        prompts: ["green bond"],
        supplement_tickers: ["AGG", "ESGU"],
      }),
    );
    const ensured = ensureProposedTickersForReview(overlay, "zh");
    expect(ensured.universe.proposed_tickers).toBeUndefined();
  });

  it("blocks confirm when thematic needs have no adds and no ack", () => {
    const overlay = withThemes(greenBondOverlay());
    expect(
      isTickerReviewBlocking(overlay, {
        visibleProposed: [],
        noAddsAckKey: null,
      }),
    ).toBe(true);
  });

  it("does not block mid-clarify when proposals are chip-deduped", () => {
    const overlay = withThemes(greenBondOverlay());
    expect(
      isTickerReviewBlocking(overlay, {
        visibleProposed: [],
        noAddsAckKey: null,
        hasPendingClarifications: true,
      }),
    ).toBe(false);
  });

  it("unblocks after 無新增標的 ack for the same needs key", () => {
    const overlay = withThemes(greenBondOverlay());
    const key = instrumentNeedsKey(overlay);
    expect(
      isTickerReviewBlocking(overlay, {
        visibleProposed: [],
        noAddsAckKey: key,
      }),
    ).toBe(false);
  });

  it("unblocks when supplements were confirmed", () => {
    const overlay = withThemes(
      baseOverlay({
        prompts: ["green bond"],
        supplement_tickers: ["AGG"],
      }),
    );
    expect(
      isTickerReviewBlocking(overlay, {
        visibleProposed: [],
        noAddsAckKey: null,
      }),
    ).toBe(false);
  });

  it("still blocks while visible proposed tickers remain", () => {
    const overlay = withThemes(
      baseOverlay({
        prompts: ["esg"],
        supplement_tickers: ["AGG"],
        proposed_tickers: [{ ticker: "ESGU", name: "ESG US" }],
      }),
    );
    expect(
      isTickerReviewBlocking(overlay, {
        visibleProposed: [{ ticker: "ESGU" }],
        noAddsAckKey: null,
      }),
    ).toBe(true);
  });
});

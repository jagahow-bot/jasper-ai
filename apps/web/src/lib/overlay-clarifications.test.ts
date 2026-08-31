import { describe, expect, it } from "vitest";
import {
  buildClarificationAnswer,
  clarificationFromQuestion,
  emptyClarificationDraft,
  inferClarificationOptions,
  joinClarificationLabels,
  resolveClarifications,
  syncExtractClarifications,
} from "./overlay-clarifications";
import type { OverlayExtractOutput } from "./overlay-schema";

describe("joinClarificationLabels", () => {
  it("joins with comma for en", () => {
    expect(joinClarificationLabels(["Conservative", "Moderate"], "en")).toBe(
      "Conservative, Moderate",
    );
  });

  it("joins with ideographic comma for zh", () => {
    expect(joinClarificationLabels(["保守", "穩健"], "zh")).toBe("保守、穩健");
  });
});

describe("buildClarificationAnswer", () => {
  it("merges multi-select chips and free text", () => {
    const c = clarificationFromQuestion(
      "Risk preference?",
      0,
      "en",
      inferClarificationOptions("risk preference", "en"),
    );
    const answer = buildClarificationAnswer(
      c,
      {
        selectedOptionIds: ["conservative", "moderate"],
        freeText: "client prefers gradual shift",
        otherOpen: true,
      },
      "en",
    );
    expect(answer).toBe(
      "Conservative, Moderate, client prefers gradual shift",
    );
  });
});

describe("resolveClarifications", () => {
  it("prefers structured clarifications", () => {
    const out = resolveClarifications(
      {
        clarifications: [
          {
            id: "q1",
            question: "Horizon?",
            options: [{ id: "a", label: "5+ years" }],
          },
        ],
        clarification_questions: ["ignored"],
      },
      "en",
    );
    expect(out).toHaveLength(1);
    expect(out[0].question).toBe("Horizon?");
    expect(out[0].options[0].label).toBe("5+ years");
  });

  it("falls back to plain questions with inferred options", () => {
    const out = resolveClarifications(
      {
        clarification_questions: ["這筆投資的風險屬性偏好？"],
      },
      "zh",
    );
    expect(out[0].options.map((o) => o.label)).toContain("保守");
  });
});

describe("syncExtractClarifications", () => {
  it("builds clarifications from legacy string questions", () => {
    const extract: OverlayExtractOutput = {
      client_profile: {},
      market_view: {
        stance: "neutral",
        themes: ["balanced"],
        narrative_summary: "Balanced request for testing only.",
      },
      allocation: { asset_classes: ["equity", "bond"] },
      universe: { prompts: [] },
      optimization: { objective: "max_sharpe" },
      clarification_questions: ["Risk tolerance?"],
      confidence: 0.5,
      rationale: "Need more detail on risk tolerance before confirming.",
    };
    const synced = syncExtractClarifications(extract, "en");
    expect(synced.clarifications).toHaveLength(1);
    expect(synced.clarifications?.[0].options.length).toBeGreaterThan(0);
  });
});

describe("emptyClarificationDraft", () => {
  it("starts with no selection", () => {
    const d = emptyClarificationDraft();
    expect(d.selectedOptionIds).toEqual([]);
    expect(d.freeText).toBe("");
    expect(d.otherOpen).toBe(false);
  });
});

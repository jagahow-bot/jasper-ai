import { describe, expect, it } from "vitest";
import {
  buildClarificationAnswer,
  clarificationAllowsMultiple,
  clarificationFromQuestion,
  emptyClarificationDraft,
  finalizeStructuredClarification,
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

  it("preserves distinct LLM options per clarification question", () => {
    const extract: OverlayExtractOutput = {
      client_profile: {},
      market_view: {
        stance: "risk_on",
        themes: ["ai"],
        narrative_summary: "Client wants higher AI exposure with explicit targets.",
      },
      allocation: { asset_classes: ["equity", "bond"] },
      universe: { prompts: [] },
      optimization: { objective: "max_sharpe" },
      clarifications: [
        {
          id: "q1",
          question: "客戶預期將 AI 產業或科技板塊的比重提高至多少？",
          options: [
            { id: "20", label: "整體配置 20%" },
            { id: "30", label: "整體配置 30%" },
            { id: "40", label: "整體配置 40%以上" },
          ],
          allow_multiple: false,
        },
        {
          id: "q2",
          question: "偏好採用何種方式加碼 AI 曝險？",
          options: [
            { id: "etf", label: "引入主題型 ETF" },
            { id: "single", label: "調升既有 AI 龍頭個股" },
            { id: "both", label: "ETF與個股複合" },
          ],
          allow_multiple: false,
        },
      ],
      clarification_questions: [
        "客戶預期將 AI 產業或科技板塊的比重提高至多少？",
        "偏好採用何種方式加碼 AI 曝險？",
      ],
      confidence: 0.55,
      rationale: "Need explicit AI sleeve target and implementation preference.",
    };

    const synced = syncExtractClarifications(extract, "zh");
    expect(synced.clarifications?.[0].options.map((o) => o.label)).toEqual([
      "整體配置 20%",
      "整體配置 30%",
      "整體配置 40%以上",
    ]);
    expect(synced.clarifications?.[1].options.map((o) => o.label)).toEqual([
      "引入主題型 ETF",
      "調升既有 AI 龍頭個股",
      "ETF與個股複合",
    ]);
    expect(clarificationAllowsMultiple(synced.clarifications![0])).toBe(false);
    expect(clarificationAllowsMultiple(synced.clarifications![1])).toBe(false);
  });
});

describe("finalizeStructuredClarification", () => {
  it("prefers LLM options over keyword inference when both are present", () => {
    const finalized = finalizeStructuredClarification(
      {
        id: "q1",
        question: "客戶預期將 AI 產業或科技板塊的比重提高至多少？",
        options: [
          { id: "20", label: "整體配置 20%" },
          { id: "30", label: "整體配置 30%" },
        ],
        allow_multiple: false,
      },
      0,
      "zh",
    );
    expect(finalized.options.map((o) => o.label)).toEqual([
      "整體配置 20%",
      "整體配置 30%",
    ]);
    expect(finalized.options.map((o) => o.label)).not.toContain("10%");
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

import { describe, expect, it } from "vitest";
import { formatClarificationUserReply } from "./overlay-schema";

describe("formatClarificationUserReply", () => {
  it("returns empty string when nothing is filled", () => {
    expect(
      formatClarificationUserReply({
        answers: [
          { question: "Horizon?", answer: "" },
          { question: "Risk?", answer: "   " },
        ],
        notes: "  ",
        lang: "en",
      }),
    ).toBe("");
  });

  it("formats partial answers and keeps Qn/An tokens", () => {
    const text = formatClarificationUserReply({
      answers: [
        { question: "Preferred equity vs bond split?", answer: "70/30" },
        { question: "Cash deployment schedule?", answer: "" },
        { question: "Any ESG constraints?", answer: "none" },
      ],
      lang: "en",
    });
    expect(text).toBe(
      [
        "Clarification answers:",
        "Q1: Preferred equity vs bond split?",
        "A1: 70/30",
        "Q2: Any ESG constraints?",
        "A2: none",
      ].join("\n"),
    );
  });

  it("appends localized additional notes", () => {
    const en = formatClarificationUserReply({
      answers: [{ question: "Horizon years?", answer: "10" }],
      notes: "Client may add private credit later.",
      lang: "en",
    });
    expect(en).toContain("Clarification answers:");
    expect(en).toContain("Q1: Horizon years?");
    expect(en).toContain("A1: 10");
    expect(en).toContain("Additional notes:");
    expect(en).toContain("Client may add private credit later.");

    const zh = formatClarificationUserReply({
      answers: [],
      notes: "客戶偏向分批進場",
      lang: "zh",
    });
    expect(zh).toBe(["其他補充：", "客戶偏向分批進場"].join("\n"));

    const ko = formatClarificationUserReply({
      answers: [{ question: "투자기간?", answer: "7년" }],
      notes: "유동성 여유 있음",
      lang: "ko",
    });
    expect(ko).toContain("확인 답변:");
    expect(ko).toContain("Q1: 투자기간?");
    expect(ko).toContain("A1: 7년");
    expect(ko).toContain("추가 메모:");
    expect(ko).toContain("유동성 여유 있음");
  });
});

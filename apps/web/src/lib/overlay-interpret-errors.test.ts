import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  allowOverlayRulesFallback,
  classifyOverlayGeminiFailure,
  isOverlayInterpretErrorBody,
  overlayInterpretErrorI18nKey,
  OVERLAY_INTERPRET_ERROR_CODES,
} from "./overlay-interpret-errors";

describe("overlay-interpret-errors", () => {
  it("allows rules fallback only with query param or env", () => {
    expect(
      allowOverlayRulesFallback(new Request("http://localhost/api/overlay/interpret")),
    ).toBe(false);
    expect(
      allowOverlayRulesFallback(
        new Request("http://localhost/api/overlay/interpret?fallback=1"),
      ),
    ).toBe(true);
    const prev = process.env.OVERLAY_ALLOW_RULES_FALLBACK;
    process.env.OVERLAY_ALLOW_RULES_FALLBACK = "true";
    expect(
      allowOverlayRulesFallback(new Request("http://localhost/api/overlay/interpret")),
    ).toBe(true);
    process.env.OVERLAY_ALLOW_RULES_FALLBACK = prev;
  });

  it("classifies Zod and SyntaxError failures", () => {
    const zodFailure = classifyOverlayGeminiFailure(
      new ZodError([{ code: "custom", message: "bad field", path: ["confidence"] }]),
    );
    expect(zodFailure.code).toBe(OVERLAY_INTERPRET_ERROR_CODES.VALIDATION_FAILED);
    expect(zodFailure.status).toBe(422);
    expect(zodFailure.detail).toBe("confidence: bad field");

    const parseFailure = classifyOverlayGeminiFailure(new SyntaxError("Unexpected token"));
    expect(parseFailure.code).toBe(OVERLAY_INTERPRET_ERROR_CODES.PARSE_FAILED);

    const networkFailure = classifyOverlayGeminiFailure(new Error("fetch failed"));
    expect(networkFailure.code).toBe(OVERLAY_INTERPRET_ERROR_CODES.GEMINI_UNAVAILABLE);
    expect(networkFailure.status).toBe(502);
  });

  it("maps error codes to i18n keys", () => {
    expect(overlayInterpretErrorI18nKey(OVERLAY_INTERPRET_ERROR_CODES.API_KEY_MISSING)).toBe(
      "overlay.interpret.error.apiKeyMissing",
    );
    expect(overlayInterpretErrorI18nKey("unknown")).toBe("overlay.interpret.error.generic");
  });

  it("detects structured overlay error bodies", () => {
    expect(
      isOverlayInterpretErrorBody({
        error: "failed",
        code: OVERLAY_INTERPRET_ERROR_CODES.API_KEY_MISSING,
      }),
    ).toBe(true);
    expect(isOverlayInterpretErrorBody({ overlay: {} })).toBe(false);
  });
});

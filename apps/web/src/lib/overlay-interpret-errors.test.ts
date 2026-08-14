import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  allowOverlayRulesFallback,
  classifyOverlayAiFailure,
  isOverlayInterpretErrorBody,
  overlayInterpretErrorI18nKey,
  OVERLAY_INTERPRET_ERROR_CODES,
  parseOverlayInterpretResponseJson,
  resolveOverlayInterpretClientFailure,
} from "./overlay-interpret-errors";

describe("overlay-interpret-errors", () => {
  it("disables rules fallback by default and can be enabled", () => {
    expect(
      allowOverlayRulesFallback(new Request("http://localhost/api/overlay/interpret")),
    ).toBe(false);
    expect(
      allowOverlayRulesFallback(
        new Request("http://localhost/api/overlay/interpret?fallback=1"),
      ),
    ).toBe(true);
    expect(
      allowOverlayRulesFallback(
        new Request("http://localhost/api/overlay/interpret?fallback=0"),
      ),
    ).toBe(false);

    const prevAllow = process.env.OVERLAY_ALLOW_RULES_FALLBACK;
    const prevForce = process.env.OVERLAY_FORCE_AI_ONLY;

    process.env.OVERLAY_ALLOW_RULES_FALLBACK = "true";
    expect(
      allowOverlayRulesFallback(new Request("http://localhost/api/overlay/interpret")),
    ).toBe(true);

    process.env.OVERLAY_ALLOW_RULES_FALLBACK = "false";
    expect(
      allowOverlayRulesFallback(new Request("http://localhost/api/overlay/interpret")),
    ).toBe(false);

    process.env.OVERLAY_ALLOW_RULES_FALLBACK = "true";
    process.env.OVERLAY_FORCE_AI_ONLY = "true";
    expect(
      allowOverlayRulesFallback(new Request("http://localhost/api/overlay/interpret")),
    ).toBe(false);
    expect(
      allowOverlayRulesFallback(
        new Request("http://localhost/api/overlay/interpret?fallback=1"),
      ),
    ).toBe(false);

    process.env.OVERLAY_ALLOW_RULES_FALLBACK = prevAllow;
    process.env.OVERLAY_FORCE_AI_ONLY = prevForce;
  });

  it("classifies Zod and SyntaxError failures", () => {
    const zodFailure = classifyOverlayAiFailure(
      new ZodError([{ code: "custom", message: "bad field", path: ["confidence"] }]),
    );
    expect(zodFailure.code).toBe(OVERLAY_INTERPRET_ERROR_CODES.VALIDATION_FAILED);
    expect(zodFailure.status).toBe(422);
    expect(zodFailure.detail).toBe("confidence: bad field");

    const parseFailure = classifyOverlayAiFailure(new SyntaxError("Unexpected token"));
    expect(parseFailure.code).toBe(OVERLAY_INTERPRET_ERROR_CODES.PARSE_FAILED);

    const networkFailure = classifyOverlayAiFailure(new Error("fetch failed"));
    expect(networkFailure.code).toBe(OVERLAY_INTERPRET_ERROR_CODES.AI_UNAVAILABLE);
    expect(networkFailure.status).toBe(502);

    const thinkingFailure = classifyOverlayAiFailure(
      new Error(
        "Thinking level MINIMAL is not supported for this model. Please retry with other thinking level.",
      ),
    );
    expect(thinkingFailure.code).toBe(OVERLAY_INTERPRET_ERROR_CODES.RESPONSE_INVALID);
    expect(thinkingFailure.status).toBe(400);
    expect(thinkingFailure.code).not.toBe(OVERLAY_INTERPRET_ERROR_CODES.AI_UNAVAILABLE);
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

  it("resolves client failures from structured, empty, and plain error bodies", () => {
    const structured = resolveOverlayInterpretClientFailure({
      error: "AI overlay response failed schema validation",
      code: OVERLAY_INTERPRET_ERROR_CODES.VALIDATION_FAILED,
      detail: "confidence: bad field",
    });
    expect(structured.messageKey).toBe("overlay.interpret.error.validationFailed");
    expect(structured.preferI18n).toBe(true);
    expect(structured.code).toBe(OVERLAY_INTERPRET_ERROR_CODES.VALIDATION_FAILED);
    expect(structured.detail).toBe("confidence: bad field");

    const empty = resolveOverlayInterpretClientFailure({}, 422);
    expect(empty.messageKey).toBe("overlay.interpret.error.generic");
    expect(empty.preferI18n).toBe(true);
    expect(empty.code).toBe(OVERLAY_INTERPRET_ERROR_CODES.RESPONSE_INVALID);
    expect(empty.detail).toBe("HTTP 422");

    const plain = resolveOverlayInterpretClientFailure({ error: "Provide messages or text" }, 400);
    expect(plain.preferI18n).toBe(false);
    expect(plain.messageFallback).toBe("Provide messages or text");
    expect(plain.detail).toBe("HTTP 400");
  });

  it("parses empty and non-JSON interpret response bodies safely", () => {
    expect(parseOverlayInterpretResponseJson("")).toEqual({});
    expect(parseOverlayInterpretResponseJson("   ")).toEqual({});
    expect(
      parseOverlayInterpretResponseJson(
        JSON.stringify({
          error: "bad",
          code: OVERLAY_INTERPRET_ERROR_CODES.PARSE_FAILED,
        }),
      ),
    ).toEqual({
      error: "bad",
      code: OVERLAY_INTERPRET_ERROR_CODES.PARSE_FAILED,
    });

    const invalid = parseOverlayInterpretResponseJson("<html>nope</html>");
    expect(isOverlayInterpretErrorBody(invalid)).toBe(true);
    expect((invalid as { code: string }).code).toBe(
      OVERLAY_INTERPRET_ERROR_CODES.RESPONSE_INVALID,
    );
  });
});

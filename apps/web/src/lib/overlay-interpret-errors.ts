import { NextResponse } from "next/server";
import { ZodError } from "zod";

export const OVERLAY_INTERPRET_ERROR_CODES = {
  API_KEY_MISSING: "API_KEY_MISSING",
  AI_UNAVAILABLE: "AI_UNAVAILABLE",
  PARSE_FAILED: "PARSE_FAILED",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  RESPONSE_INVALID: "RESPONSE_INVALID",
} as const;

export type OverlayInterpretErrorCode =
  (typeof OVERLAY_INTERPRET_ERROR_CODES)[keyof typeof OVERLAY_INTERPRET_ERROR_CODES];

export type OverlayInterpretErrorBody = {
  error: string;
  code: OverlayInterpretErrorCode;
  detail?: string;
};

const I18N_KEY_BY_CODE: Record<OverlayInterpretErrorCode, string> = {
  [OVERLAY_INTERPRET_ERROR_CODES.API_KEY_MISSING]: "overlay.interpret.error.apiKeyMissing",
  [OVERLAY_INTERPRET_ERROR_CODES.AI_UNAVAILABLE]: "overlay.interpret.error.aiUnavailable",
  [OVERLAY_INTERPRET_ERROR_CODES.PARSE_FAILED]: "overlay.interpret.error.parseFailed",
  [OVERLAY_INTERPRET_ERROR_CODES.VALIDATION_FAILED]: "overlay.interpret.error.validationFailed",
  [OVERLAY_INTERPRET_ERROR_CODES.RESPONSE_INVALID]: "overlay.interpret.error.responseInvalid",
};

export function allowOverlayRulesFallback(req: Request): boolean {
  if (process.env.OVERLAY_FORCE_AI_ONLY === "true") return false;
  const url = new URL(req.url);
  if (url.searchParams.get("fallback") === "0") return false;
  if (url.searchParams.get("fallback") === "1") return true;
  return process.env.OVERLAY_ALLOW_RULES_FALLBACK !== "false";
}

export function buildOverlayInterpretError(
  code: OverlayInterpretErrorCode,
  error: string,
  detail?: string,
  status = 503,
): NextResponse<OverlayInterpretErrorBody> {
  return NextResponse.json({ error, code, detail }, { status });
}

export function formatZodIssueDetail(error: ZodError, limit = 5): string {
  return error.issues
    .slice(0, limit)
    .map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ")
    .slice(0, 500);
}

export function classifyOverlayAiFailure(error: unknown): {
  code: OverlayInterpretErrorCode;
  error: string;
  detail?: string;
  status: number;
} {
  if (error instanceof ZodError) {
    return {
      code: OVERLAY_INTERPRET_ERROR_CODES.VALIDATION_FAILED,
      error: "AI overlay response failed schema validation",
      detail: formatZodIssueDetail(error),
      status: 422,
    };
  }
  if (error instanceof SyntaxError) {
    return {
      code: OVERLAY_INTERPRET_ERROR_CODES.PARSE_FAILED,
      error: "AI overlay response was not valid JSON",
      detail: error.message.slice(0, 500),
      status: 422,
    };
  }
  if (error instanceof Error) {
    return {
      code: OVERLAY_INTERPRET_ERROR_CODES.AI_UNAVAILABLE,
      error: "AI overlay interpretation is temporarily unavailable",
      detail: error.message.slice(0, 500),
      status: 502,
    };
  }
  return {
    code: OVERLAY_INTERPRET_ERROR_CODES.RESPONSE_INVALID,
    error: "AI overlay interpretation failed",
    status: 422,
  };
}

export function overlayInterpretErrorI18nKey(code: string | undefined): string {
  if (code && code in I18N_KEY_BY_CODE) {
    return I18N_KEY_BY_CODE[code as OverlayInterpretErrorCode];
  }
  return "overlay.interpret.error.generic";
}

export function isOverlayInterpretErrorBody(
  value: unknown,
): value is OverlayInterpretErrorBody {
  if (!value || typeof value !== "object") return false;
  const body = value as OverlayInterpretErrorBody;
  return typeof body.error === "string" && typeof body.code === "string";
}

/** Backward-compatible alias for legacy call sites/tests. */
export const classifyOverlayGeminiFailure = classifyOverlayAiFailure;

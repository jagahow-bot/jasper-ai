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
  return process.env.OVERLAY_ALLOW_RULES_FALLBACK === "true";
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

function isGeminiModelConfigError(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes("thinking level") ||
    msg.includes("thinkinglevel") ||
    (msg.includes("thinking") && msg.includes("not supported for this model"))
  );
}

export function classifyOverlayAiFailure(error: unknown): {
  code: OverlayInterpretErrorCode;
  error: string;
  detail?: string;
  status: number;
} {
  // Unwrap { error, log } thrown by generateTextWithAudit / generateObjectWithAudit
  // so provider errors surface as AI_UNAVAILABLE instead of the generic RESPONSE_INVALID.
  if (error && typeof error === "object" && "error" in error) {
    return classifyOverlayAiFailure((error as { error: unknown }).error);
  }
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
    if (isGeminiModelConfigError(error.message)) {
      return {
        code: OVERLAY_INTERPRET_ERROR_CODES.RESPONSE_INVALID,
        error: "AI overlay request was rejected by the model configuration",
        detail: error.message.slice(0, 500),
        status: 400,
      };
    }
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

export type OverlayInterpretClientFailure = {
  messageKey: string;
  messageFallback: string;
  /** When true, UI should translate `messageKey`; otherwise show `messageFallback`. */
  preferI18n: boolean;
  code?: string;
  detail?: string;
};

/**
 * Map an interpret HTTP response body into UI-facing failure fields.
 * Prefer `messageKey` via i18n when `preferI18n`; otherwise use `messageFallback`.
 */
export function resolveOverlayInterpretClientFailure(
  data: unknown,
  httpStatus?: number,
): OverlayInterpretClientFailure {
  if (isOverlayInterpretErrorBody(data)) {
    return {
      messageKey: overlayInterpretErrorI18nKey(data.code),
      messageFallback: data.error,
      preferI18n: true,
      code: data.code,
      detail: data.detail,
    };
  }
  if (
    data &&
    typeof data === "object" &&
    "error" in data &&
    typeof (data as { error?: unknown }).error === "string"
  ) {
    const error = (data as { error: string }).error;
    return {
      messageKey: "overlay.interpret.error.generic",
      messageFallback: error,
      preferI18n: false,
      detail: httpStatus ? `HTTP ${httpStatus}` : undefined,
    };
  }
  const statusHint =
    typeof httpStatus === "number" && httpStatus > 0 ? `HTTP ${httpStatus}` : undefined;
  const emptyBody =
    data == null ||
    (typeof data === "object" && !Array.isArray(data) && Object.keys(data).length === 0);
  return {
    messageKey: "overlay.interpret.error.generic",
    messageFallback: statusHint
      ? `Overlay interpretation failed (${statusHint}).`
      : "Overlay interpretation failed.",
    preferI18n: true,
    code: emptyBody ? OVERLAY_INTERPRET_ERROR_CODES.RESPONSE_INVALID : undefined,
    detail: statusHint,
  };
}

/** Safe parse of interpret response text; empty → `{}` for callers. */
export function parseOverlayInterpretResponseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return {
      error: "Overlay interpretation returned a non-JSON response",
      code: OVERLAY_INTERPRET_ERROR_CODES.RESPONSE_INVALID,
      detail: trimmed.slice(0, 500),
    } satisfies OverlayInterpretErrorBody;
  }
}

/** Backward-compatible alias for legacy call sites/tests. */
export const classifyOverlayGeminiFailure = classifyOverlayAiFailure;

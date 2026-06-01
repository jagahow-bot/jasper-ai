/** Default Gemini model for AI SDK routes (override via GEMINI_MODEL). */
export const GEMINI_MODEL =
  process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash";

/** Max output tokens for Gemini calls (override via GEMINI_MAX_OUTPUT_TOKENS). */
export const GEMINI_MAX_OUTPUT_TOKENS = (() => {
  const raw = process.env.GEMINI_MAX_OUTPUT_TOKENS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 4096;
  return Number.isFinite(n) && n > 0 ? n : 4096;
})();

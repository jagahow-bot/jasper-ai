/** Default Gemini model for AI SDK routes (override via GEMINI_MODEL). */
export const GEMINI_MODEL =
  process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash";

/** Max output tokens for structured / shorter Gemini calls (override via GEMINI_MAX_OUTPUT_TOKENS). */
export const GEMINI_MAX_OUTPUT_TOKENS = (() => {
  const raw = process.env.GEMINI_MAX_OUTPUT_TOKENS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 6144;
  return Number.isFinite(n) && n > 0 ? n : 6144;
})();

/** Higher budget for prose-heavy routes (narrate, compare, candidate summary). */
export const GEMINI_NARRATIVE_MAX_OUTPUT_TOKENS = (() => {
  const raw = process.env.GEMINI_NARRATIVE_MAX_OUTPUT_TOKENS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 8192;
  return Number.isFinite(n) && n > 0 ? n : 8192;
})();

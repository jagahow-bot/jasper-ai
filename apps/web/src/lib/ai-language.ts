/**
 * Locale handling for AI-generated prose (narrate / compare / candidate summary).
 * Server-safe (no React) so API routes can import it. The web `Lang` union and
 * this `AiLang` union are intentionally kept in sync.
 */
export type AiLang = "en" | "zh" | "ko";

const LANGUAGE_NAMES: Record<AiLang, string> = {
  en: "English",
  zh: "Traditional Chinese (繁體中文)",
  ko: "Korean (한국어)",
};

/** Coerce an arbitrary request value into a supported locale (defaults to en). */
export function normalizeAiLang(raw: unknown): AiLang {
  return raw === "zh" || raw === "ko" ? raw : "en";
}

/** Human-readable language name used inside prompts. */
export function aiLanguageName(lang: AiLang): string {
  return LANGUAGE_NAMES[normalizeAiLang(lang)];
}

/**
 * System-prompt directive instructing the model which language to write prose in.
 * Model codes (M0001), tickers, and numeric values must stay verbatim regardless
 * of locale so downstream parsing / linking keeps working.
 */
export function languageDirective(lang: AiLang): string {
  const normalized = normalizeAiLang(lang);
  if (normalized === "en") {
    return "Write ALL prose in English.";
  }
  return (
    `Write ALL prose in ${LANGUAGE_NAMES[normalized]}. ` +
    "Keep model codes (e.g. M0001), tickers, and numbers exactly as given; " +
    "you may localize metric names naturally (e.g. Sharpe, CAGR, max drawdown)."
  );
}

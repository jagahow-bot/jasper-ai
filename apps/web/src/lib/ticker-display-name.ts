import { etfDisplayName } from "@/lib/etf-display-name";
import type { Lang } from "@/lib/i18n";

/**
 * Resolve ETF / product display name.
 * Prefer `etfDisplayName(ticker, lang)` when the UI language is known.
 */
export function resolveTickerDisplayName(
  ticker: string,
  lang: Lang = "en",
): string {
  return etfDisplayName(ticker, lang);
}

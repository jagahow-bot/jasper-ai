import etfNamesFile from "@/data/etf-names.json";
import { getUniverseItems } from "@/lib/universe";
import type { Lang } from "@/lib/i18n";

type LocalizedName = { en: string; zh: string; ko: string };

const NAME_MAP: Record<string, LocalizedName> = (
  etfNamesFile as { names: Record<string, LocalizedName> }
).names;

function isCjk(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text);
}

/**
 * Localized ETF display name for the current UI language.
 * Resolution: name map → universe English-looking name → ticker.
 */
export function etfDisplayName(ticker: string, lang: Lang): string {
  const upper = ticker.trim().toUpperCase();
  if (!upper) return ticker;

  const entry = NAME_MAP[upper];
  if (entry) {
    if (lang === "zh" && entry.zh?.trim()) return entry.zh.trim();
    if (lang === "ko" && entry.ko?.trim()) return entry.ko.trim();
    if (entry.en?.trim()) return entry.en.trim();
  }

  for (const item of getUniverseItems()) {
    if (item.ticker.toUpperCase() !== upper) continue;
    const name = item.name?.trim();
    if (!name) break;
    // Prefer English-looking universe labels when map is missing.
    if (!isCjk(name)) return name;
    if (lang === "zh") return name;
    break;
  }

  return upper;
}

/** All localized name strings for search matching. */
export function etfSearchText(ticker: string): string {
  const upper = ticker.trim().toUpperCase();
  const entry = NAME_MAP[upper];
  if (!entry) return upper;
  return [upper, entry.en, entry.zh, entry.ko].filter(Boolean).join(" ");
}

import {
  detectDirectIndexing,
  directIndexAskCopy,
  directIndexUniversePrompt,
  filterTickersForDirectIndex,
  pickDirectIndexStocks,
  proposedTickersForDirectIndex,
} from "./direct-indexing";
import type { Lang } from "./universe-filter-locale";
import type {
  OverlayAsk,
  OverlayExtractOutput,
  OverlayProposedTicker,
} from "./overlay-schema";

function haystackFromExtract(extract: OverlayExtractOutput, sourceText: string): string {
  return [
    sourceText,
    ...(extract.universe.prompts ?? []),
    extract.market_view.narrative_summary,
    ...(extract.market_view.themes ?? []),
  ]
    .filter(Boolean)
    .join("\n");
}

function mergeThemes(existing: string[], extra: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of [...existing, extra]) {
    const key = t.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= 8) break;
  }
  return out;
}

function ensureDirectIndexAsk(
  asks: OverlayAsk[] | undefined,
  stocks: string[],
  lang: Lang,
): OverlayAsk[] {
  const copy = directIndexAskCopy(lang);
  const next: OverlayAsk[] = [...(asks ?? [])];
  const existing = next.find(
    (a) => a.kind === "direct_index" || /direct.?index|直接指數|직접 인덱싱/i.test(a.title),
  );
  if (existing) {
    return next.map((a) =>
      a === existing
        ? {
            ...a,
            kind: "direct_index" as const,
            title: a.title || copy.title,
            summary: a.summary || copy.summary,
            tickers: a.tickers?.length ? a.tickers : stocks,
            status: a.status ?? "proposed",
          }
        : a,
    );
  }
  if (next.length >= 12) return next;
  const created: OverlayAsk = {
    id: "ask-direct-index",
    title: copy.title,
    summary: copy.summary,
    kind: "direct_index",
    tickers: stocks,
    status: "proposed",
  };
  return [created, ...next].slice(0, 12);
}

/**
 * When the RM brief asks for direct indexing, rewrite universe construction
 * so proposed/supplement tickers are individual stocks — not thematic ETFs.
 */
export function applyDirectIndexingToExtract(
  extract: OverlayExtractOutput,
  sourceText: string,
  lang: Lang,
): OverlayExtractOutput {
  const haystack = haystackFromExtract(extract, sourceText);
  const flagged =
    extract.universe.construction === "direct_index" || detectDirectIndexing(haystack);
  if (!flagged) return extract;

  const fromModel = (extract.universe.proposed_tickers ?? [])
    .map((p) => p.ticker)
    .filter(Boolean);
  const fromSup = extract.universe.supplement_tickers ?? [];
  const stocks = pickDirectIndexStocks(haystack, 8);
  const uniqueSup = Array.from(
    new Set(filterTickersForDirectIndex([...fromSup, ...fromModel, ...stocks])),
  ).slice(0, 30);

  const proposedFromStocks = proposedTickersForDirectIndex(haystack, lang, 8);
  const existingStockProposed = (extract.universe.proposed_tickers ?? []).filter((p) =>
    stocks.includes(p.ticker.toUpperCase()),
  );
  const proposedByTicker = new Map<string, OverlayProposedTicker>();
  for (const p of [...proposedFromStocks, ...existingStockProposed]) {
    const key = p.ticker.toUpperCase();
    if (!proposedByTicker.has(key)) proposedByTicker.set(key, { ...p, ticker: key });
  }
  const proposed = [...proposedByTicker.values()].slice(0, 12);

  const prompts = extract.universe.prompts?.length
    ? extract.universe.prompts
    : [directIndexUniversePrompt(lang)];

  return {
    ...extract,
    market_view: {
      ...extract.market_view,
      themes: mergeThemes(extract.market_view.themes, "direct_index"),
    },
    universe: {
      ...extract.universe,
      construction: "direct_index",
      prompts,
      supplement_tickers: uniqueSup.length ? uniqueSup : stocks,
      proposed_tickers: proposed.length ? proposed : undefined,
    },
    asks: ensureDirectIndexAsk(extract.asks, stocks, lang),
  };
}

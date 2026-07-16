import type { BacktestRequest } from "@/lib/types";
import { getUniverseItems } from "@/lib/universe";

/** Dedupe tickers (uppercase), preserving first-seen order. */
export function uniqueTickers(tickers: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tickers) {
    const key = t.trim().toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

/**
 * True when the request is anchored to a model/target portfolio whitelist
 * (explicit universe_tickers and/or static replay holdings).
 */
export function isLockedModelUniverse(
  req: Pick<BacktestRequest, "universe_tickers" | "static_replay_holdings">,
): boolean {
  if (req.universe_tickers?.length) return true;
  if (req.static_replay_holdings && Object.keys(req.static_replay_holdings).length) {
    return true;
  }
  return false;
}

/**
 * Anchor/model holdings used as the locked base universe for a customized run.
 * Prefers explicit `universe_tickers`, then static-replay holdings keys.
 */
export function anchorHoldingsFromRequest(base: BacktestRequest): string[] {
  if (base.universe_tickers?.length) {
    return uniqueTickers(base.universe_tickers);
  }
  if (base.static_replay_holdings) {
    return uniqueTickers(Object.keys(base.static_replay_holdings));
  }
  return [];
}

/**
 * Locked customized universe = (anchor holdings − excludes) ∪ adds.
 * Does not seed the mainstream demo pool or open the full ETF catalog.
 */
export function buildLockedCustomUniverse(
  base: BacktestRequest,
  opts?: {
    addTickers?: readonly string[] | null;
    excludeTickers?: readonly string[] | null;
  },
): string[] {
  const exclude = new Set(
    uniqueTickers(opts?.excludeTickers ?? []).map((t) => t.toUpperCase()),
  );
  const holdings = anchorHoldingsFromRequest(base).filter((t) => !exclude.has(t));
  const adds = uniqueTickers(opts?.addTickers ?? []).filter((t) => !exclude.has(t));
  return uniqueTickers([...holdings, ...adds]);
}

/** Max single-name weight that can still fill 100% across a locked universe. */
export function maxWeightForLockedUniverse(
  lockedCount: number,
  preferred?: number | null,
): number {
  const floor = lockedCount > 0 ? 1 / lockedCount : 0.25;
  return Math.max(preferred ?? 0.25, floor);
}

/**
 * English / finance tokens that look like tickers but are not symbols we should
 * auto-add from natural-language prompts.
 */
const EXPLICIT_TICKER_STOPWORDS = new Set([
  "A",
  "AI",
  "ALL",
  "AM",
  "AN",
  "AND",
  "ANY",
  "AS",
  "AT",
  "BE",
  "BY",
  "CEO",
  "CFO",
  "ESG",
  "ETF",
  "ETFS",
  "FOR",
  "FROM",
  "GDP",
  "HNWI",
  "IF",
  "IN",
  "INTO",
  "IPO",
  "IS",
  "IT",
  "ITS",
  "NAV",
  "NO",
  "NOT",
  "OF",
  "ON",
  "OR",
  "OUR",
  "PE",
  "PM",
  "RM",
  "SO",
  "THE",
  "TO",
  "UK",
  "US",
  "USA",
  "USD",
  "VIA",
  "VS",
  "WE",
  "YOY",
]);

let _universeTickerSet: Set<string> | null = null;

function universeTickerSet(): Set<string> {
  if (!_universeTickerSet) {
    _universeTickerSet = new Set(
      getUniverseItems().map((u) => u.ticker.toUpperCase()),
    );
  }
  return _universeTickerSet;
}

/**
 * Extract ETF symbols that are *literally named* in text and exist in the fund
 * catalog. Used for locked-model customization so vague thematic NL cannot
 * pull in unrelated names (ARKW, ACWI, …).
 */
export function extractExplicitTickersFromTexts(
  texts: readonly string[],
  knownTickers?: ReadonlySet<string> | readonly string[],
): string[] {
  const known =
    knownTickers instanceof Set
      ? knownTickers
      : knownTickers
        ? new Set([...knownTickers].map((t) => t.toUpperCase()))
        : universeTickerSet();

  const found: string[] = [];
  const seen = new Set<string>();
  const tokenRe = /\b[A-Za-z][A-Za-z0-9]{0,4}\b/g;

  for (const text of texts) {
    if (!text?.trim()) continue;
    for (const raw of text.match(tokenRe) ?? []) {
      const key = raw.toUpperCase();
      if (seen.has(key)) continue;
      if (EXPLICIT_TICKER_STOPWORDS.has(key)) continue;
      if (!known.has(key)) continue;
      seen.add(key);
      found.push(key);
    }
  }
  return found;
}

/**
 * Strict adds for a locked model run:
 * - explicit overlay/client supplement tickers, plus
 * - symbols literally named in NL prompts.
 *
 * Fuzzy AI / category / thematic candidates are never unioned onto the locked
 * set (pass them as filterCandidates only for documentation; they are ignored).
 */
export function resolveStrictLockedAdds(opts: {
  explicitSupplements?: readonly string[] | null;
  prompts?: readonly string[] | null;
  /** @deprecated Ignored — locked mode never expands from AI filter matches. */
  filterCandidates?: readonly string[] | null;
}): string[] {
  void opts.filterCandidates;
  const prompts = (opts.prompts ?? []).filter(Boolean);
  const fromPrompts = extractExplicitTickersFromTexts(prompts);
  const explicit = uniqueTickers(opts.explicitSupplements ?? []);
  return uniqueTickers([...explicit, ...fromPrompts]);
}

import {
  defaultSellableForProductType,
  getUniverseItems,
  getUniverseMap,
} from "@/lib/universe";

export const SELLABLE_OVERRIDES_STORAGE_KEY = "jasper_sellable_overrides_v1";
export const SELLABLE_GATE_OFF_KEY = "jasper_sellable_gate_off";

/** ticker(UPPER) → override. Missing key = no override. */
export type SellableOverrides = Record<string, boolean>;

/** Server (BFF) has no localStorage; body-derived ctx. */
export type SellableCtx = { nonSellable?: ReadonlySet<string> };

/** CASH pseudo-ticker always exempt (§9 E5). */
export const SELLABLE_EXEMPT_TICKERS: ReadonlySet<string> = new Set(["CASH"]);

function gateOff(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SELLABLE_GATE_OFF_KEY) === "1";
  } catch {
    return false;
  }
}

export function readSellableOverrides(): SellableOverrides {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SELLABLE_OVERRIDES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: SellableOverrides = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const ticker = k.trim().toUpperCase();
      if (!ticker || typeof v !== "boolean") continue;
      out[ticker] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeSellableOverrides(map: SellableOverrides): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SELLABLE_OVERRIDES_STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode */
  }
}

/** Baseline without RM override (JSON explicit → product_type default). */
export function baselineSellableForTicker(ticker: string): boolean {
  const key = ticker.trim().toUpperCase();
  if (!key) return false;
  if (SELLABLE_EXEMPT_TICKERS.has(key)) return true;
  const item = getUniverseMap().get(key);
  if (!item) return false;
  if (typeof item.sellable === "boolean") return item.sellable;
  return defaultSellableForProductType(item.product_type);
}

/** Three-layer resolve: override → JSON → product_type. Exempt always true. */
export function isSellableTicker(ticker: string, ctx?: SellableCtx): boolean {
  const key = ticker.trim().toUpperCase();
  if (!key) return false;
  if (SELLABLE_EXEMPT_TICKERS.has(key)) return true;
  if (ctx?.nonSellable) {
    // Server path: body complement is authoritative (includes RM overrides).
    if (ctx.nonSellable.has(key)) return false;
    // Unknown / synthetic stubs stay non-sellable (§9 E4).
    if (!getUniverseMap().has(key)) return false;
    return true;
  }
  const overrides = readSellableOverrides();
  if (Object.prototype.hasOwnProperty.call(overrides, key)) {
    return overrides[key];
  }
  return baselineSellableForTicker(key);
}

export function setSellableOverride(ticker: string, sellable: boolean): SellableOverrides {
  const key = ticker.trim().toUpperCase();
  const map = { ...readSellableOverrides() };
  if (!key || SELLABLE_EXEMPT_TICKERS.has(key)) {
    writeSellableOverrides(map);
    return map;
  }
  const baseline = baselineSellableForTicker(key);
  if (sellable === baseline) {
    delete map[key];
  } else {
    map[key] = sellable;
  }
  writeSellableOverrides(map);
  return map;
}

export function setSellableBulk(
  tickers: readonly string[],
  sellable: boolean,
): SellableOverrides {
  const map = { ...readSellableOverrides() };
  for (const raw of tickers) {
    const key = raw.trim().toUpperCase();
    if (!key || SELLABLE_EXEMPT_TICKERS.has(key)) continue;
    const baseline = baselineSellableForTicker(key);
    if (sellable === baseline) {
      delete map[key];
    } else {
      map[key] = sellable;
    }
  }
  writeSellableOverrides(map);
  return map;
}

export function clearSellableOverride(ticker: string): SellableOverrides {
  const key = ticker.trim().toUpperCase();
  const map = { ...readSellableOverrides() };
  delete map[key];
  writeSellableOverrides(map);
  return map;
}

export function clearAllSellableOverrides(): void {
  writeSellableOverrides({});
}

/** Effective non-sellable set (client scan or server ctx). SSR → empty (fail-open). */
export function resolveNonSellableSet(ctx?: SellableCtx): Set<string> {
  if (ctx?.nonSellable) {
    return new Set(
      [...ctx.nonSellable].map((t) => t.trim().toUpperCase()).filter(Boolean),
    );
  }
  if (typeof window === "undefined") return new Set();
  const out = new Set<string>();
  for (const item of getUniverseItems()) {
    const t = item.ticker.toUpperCase();
    if (!isSellableTicker(t)) out.add(t);
  }
  return out;
}

export function sellableCtxFromTickers(
  tickers: readonly string[] | undefined | null,
): SellableCtx | undefined {
  if (!tickers?.length) return undefined;
  return {
    nonSellable: new Set(
      tickers.map((t) => t.trim().toUpperCase()).filter(Boolean),
    ),
  };
}

/** Single gate: string form. Fail-open on exception / emergency flag. */
export function splitBySellable(
  tickers: readonly string[],
  ctx?: SellableCtx,
): { kept: string[]; blocked: string[] } {
  try {
    if (gateOff()) return { kept: [...tickers], blocked: [] };
    const kept: string[] = [];
    const blocked: string[] = [];
    for (const t of tickers) {
      if (isSellableTicker(t, ctx)) kept.push(t);
      else blocked.push(t);
    }
    return { kept, blocked };
  } catch (err) {
    console.warn("[sellable] splitBySellable fail-open", err);
    return { kept: [...tickers], blocked: [] };
  }
}

/** Single gate: proposed-object form (preserves name/category/rationale). */
export function filterSellableProposed<P extends { ticker: string }>(
  items: readonly P[],
  ctx?: SellableCtx,
): { kept: P[]; blocked: P[] } {
  try {
    if (gateOff()) return { kept: [...items], blocked: [] };
    const kept: P[] = [];
    const blocked: P[] = [];
    for (const item of items) {
      if (isSellableTicker(item.ticker, ctx)) kept.push(item);
      else blocked.push(item);
    }
    return { kept, blocked };
  } catch (err) {
    console.warn("[sellable] filterSellableProposed fail-open", err);
    return { kept: [...items], blocked: [] };
  }
}

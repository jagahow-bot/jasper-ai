import universeFile from "@/data/etf-universe.json";
import type { AssetClass } from "./constants";

export type UniverseItem = {
  ticker: string;
  name: string;
  asset_class: string;
  region?: string;
  category?: string;
};

export type UniverseFilterOptions = {
  assetClasses?: AssetClass[];
  categories?: string[] | null;
  tickers?: string[] | null;
};

export function getUniverseItems(): UniverseItem[] {
  return universeFile.universe as UniverseItem[];
}

export function filterUniverse(
  items: UniverseItem[],
  options?: UniverseFilterOptions,
): UniverseItem[] {
  let out = items;
  const { assetClasses, categories, tickers } = options ?? {};
  if (assetClasses?.length) {
    const allowed = new Set(assetClasses);
    out = out.filter((u) => allowed.has(u.asset_class as AssetClass));
  }
  if (categories?.length) {
    const catSet = new Set(categories);
    out = out.filter((u) => u.category && catSet.has(u.category));
  }
  if (tickers?.length) {
    const tickSet = new Set(tickers.map((t) => t.toUpperCase()));
    out = out.filter((u) => tickSet.has(u.ticker.toUpperCase()));
  }
  return out;
}

export function getTickers(options?: UniverseFilterOptions): string[] {
  return filterUniverse(getUniverseItems(), options).map((u) => u.ticker);
}

/** @deprecated Use filterUniverse with UniverseFilterOptions */
export function filterUniverseByAssetClasses(
  items: UniverseItem[],
  assetClasses?: AssetClass[],
): UniverseItem[] {
  return filterUniverse(items, { assetClasses });
}

export function countUniverse(options?: UniverseFilterOptions) {
  return filterUniverse(getUniverseItems(), options).length;
}

export function countByAssetClasses(assetClasses?: AssetClass[]) {
  return countUniverse({ assetClasses });
}

function countField(items: UniverseItem[], key: keyof UniverseItem): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const val = String(item[key] ?? "other");
    out[val] = (out[val] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(out).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  );
}

export function getUniverseMeta() {
  const items = getUniverseItems();
  return {
    count: items.length,
    version: universeFile.version as string | undefined,
    updated: (universeFile as { updated?: string }).updated,
    criteria: universeFile.criteria as string | undefined,
    asset_class_breakdown: countField(items, "asset_class"),
    region_breakdown: countField(items, "region"),
    category_breakdown: countField(items, "category"),
  };
}

/** Layer-1 base pool from user-selected asset classes only. */
export function baseUniverseFromRequest(req: { asset_classes: AssetClass[] }): UniverseFilterOptions {
  return { assetClasses: req.asset_classes };
}

/** Final backtest pool: base (asset classes) ∪ pinned/guaranteed AI supplement tickers. */
export function combinedUniverseFromRequest(req: {
  asset_classes: AssetClass[];
  universe_supplement_tickers?: string[] | null;
}): UniverseFilterOptions {
  const base = getTickers({ assetClasses: req.asset_classes });
  const sup = (req.universe_supplement_tickers ?? []).filter(Boolean);
  if (!sup.length) return { assetClasses: req.asset_classes };
  const merged = [...new Set([...base, ...sup])];
  return { tickers: merged };
}

/** @deprecated Use baseUniverseFromRequest or combinedUniverseFromRequest */
export function universeFilterFromRequest(req: {
  asset_classes: AssetClass[];
  universe_categories?: string[] | null;
  universe_tickers?: string[] | null;
  universe_supplement_tickers?: string[] | null;
}): UniverseFilterOptions {
  if (req.universe_supplement_tickers?.length) {
    return combinedUniverseFromRequest(req);
  }
  return {
    assetClasses: req.asset_classes,
    categories: req.universe_categories,
    tickers: req.universe_tickers,
  };
}

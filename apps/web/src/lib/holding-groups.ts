/**
 * Holdings composition grouping for model-portfolio UI (pie + ranked bars).
 */

import { sectorLabel } from "./etf-category-i18n";
import type { Lang } from "./i18n";
import type { UniverseItem } from "./universe";
import { getUniverseMap } from "./universe";

export type HoldingView = "assetClass" | "sector" | "region";

export type UniverseMeta = Pick<
  UniverseItem,
  "ticker" | "asset_class" | "region" | "sector" | "category" | "product_type"
>;

export type HoldingSlice = {
  key: string;
  label: string;
  weight: number;
  count: number;
};

export type WeightedHolding = { ticker: string; weight: number };

export type LabeledHolding = WeightedHolding & {
  sectorKey: string;
};

export const COMPOSITION_COLORS = [
  "#2563eb",
  "#4f46e5",
  "#0891b2",
  "#059669",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#64748b",
  "#0d9488",
  "#ea580c",
  "#9333ea",
  "#475569",
];

const NON_EQUITY_SECTOR_KEYS = new Set([
  "bond",
  "commodity",
  "real_estate",
  "alternative",
]);

let warnedMissing = false;

/** Resolve grouping key for sector view (equity → GICS-like sector). */
export function resolveSectorKey(meta: UniverseMeta | undefined): string {
  if (!meta) return "other";
  const asset = String(meta.asset_class || "equity");
  if (asset !== "equity") {
    return NON_EQUITY_SECTOR_KEYS.has(asset) ? asset : "other";
  }
  const sector = String(meta.sector || "").trim();
  if (sector) return sector;
  return "other";
}

function groupKeyForView(
  meta: UniverseMeta | undefined,
  ticker: string,
  view: HoldingView,
): string {
  if (!meta) {
    if (!warnedMissing && typeof console !== "undefined") {
      console.warn("[holding-groups] missing universe meta for ticker:", ticker);
      warnedMissing = true;
    }
    if (view === "region") return "other";
    if (view === "assetClass") return "other";
    return "other";
  }
  if (view === "assetClass") {
    return String(meta.asset_class || "other");
  }
  if (view === "region") {
    return String(meta.region || "other");
  }
  return resolveSectorKey(meta);
}

export type SliceLabelContext = {
  lang: Lang;
  assetClassLabel: (key: string) => string;
  regionLabel: (key: string) => string;
};

export function labelForGroupKey(
  key: string,
  view: HoldingView,
  ctx: SliceLabelContext,
): string {
  if (view === "assetClass") {
    return ctx.assetClassLabel(key) || key;
  }
  if (view === "region") {
    return ctx.regionLabel(key) || key;
  }
  return sectorLabel(ctx.lang, key);
}

/** Aggregate holdings into weighted slices for charts. */
export function groupHoldings(
  holdings: WeightedHolding[],
  view: HoldingView,
  universe: Map<string, UniverseMeta>,
  ctx: SliceLabelContext,
): HoldingSlice[] {
  const buckets = new Map<string, { weight: number; count: number }>();
  for (const h of holdings) {
    if (h.weight <= 0) continue;
    const ticker = String(h.ticker || "").toUpperCase();
    if (!ticker) continue;
    const meta = universe.get(ticker);
    const key = groupKeyForView(meta, ticker, view);
    const prev = buckets.get(key) ?? { weight: 0, count: 0 };
    buckets.set(key, {
      weight: prev.weight + h.weight,
      count: prev.count + 1,
    });
  }
  const slices: HoldingSlice[] = [];
  for (const [key, { weight, count }] of buckets) {
    slices.push({
      key,
      label: labelForGroupKey(key, view, ctx),
      weight,
      count,
    });
  }
  slices.sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));
  return slices;
}

/** Keep at most ``topN`` slices; merge overflow into ``other`` (pie-friendly). */
export function capSlicesForChart(
  slices: HoldingSlice[],
  topN: number,
  otherLabel: string,
): HoldingSlice[] {
  if (topN < 1 || slices.length <= topN) return slices;
  const keep = topN - 1;
  const head = slices.slice(0, keep);
  const tail = slices.slice(keep);
  const otherWeight = tail.reduce((s, x) => s + x.weight, 0);
  const otherCount = tail.reduce((s, x) => s + x.count, 0);
  if (otherWeight <= 1e-12) return head;
  return [
    ...head,
    {
      key: "other",
      label: otherLabel,
      weight: otherWeight,
      count: otherCount,
    },
  ];
}

/** Holdings annotated with sector keys for grouped detail tables. */
export function labelHoldingsWithSector(
  holdings: WeightedHolding[],
  universe: Map<string, UniverseMeta>,
): LabeledHolding[] {
  return holdings
    .filter((h) => h.weight > 0)
    .map((h) => {
      const ticker = String(h.ticker || "").toUpperCase();
      const meta = universe.get(ticker);
      return {
        ticker,
        weight: h.weight,
        sectorKey: resolveSectorKey(meta),
      };
    })
    .sort((a, b) => b.weight - a.weight || a.ticker.localeCompare(b.ticker));
}

/** True when region view would show only one meaningful bucket. */
export function shouldHideRegionView(
  holdings: WeightedHolding[],
  universe: Map<string, UniverseMeta>,
): boolean {
  const keys = new Set<string>();
  for (const h of holdings) {
    if (h.weight <= 0) continue;
    const meta = universe.get(String(h.ticker).toUpperCase());
    keys.add(String(meta?.region || "other"));
  }
  return keys.size <= 1;
}

/** Normalize slice weights to sum to 1 for pie charts. */
export function normalizeSliceWeights(
  slices: HoldingSlice[],
): { name: string; value: number; key: string; count: number }[] {
  const total = slices.reduce((s, x) => s + x.weight, 0) || 1;
  return slices.map((s) => ({
    name: s.label,
    value: s.weight / total,
    key: s.key,
    count: s.count,
  }));
}

/** Default universe map (memoize at call site in React). */
export function defaultUniverseMap(): Map<string, UniverseMeta> {
  return getUniverseMap();
}

/** Reset missing-ticker warning (tests). */
export function resetHoldingGroupsWarnings(): void {
  warnedMissing = false;
}

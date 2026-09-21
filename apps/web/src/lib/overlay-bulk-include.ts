/**
 * Overlay「全部／整類」批次納入 — BFF 確定性展開。
 * @see docs/design/overlay-batch-add-by-class.md
 */
import { ASSET_CLASSES, CATEGORY_LABELS } from "@/lib/constants";
import type {
  OverlayBulkInclude,
  OverlayExtractOutput,
  OverlayProposedTicker,
} from "@/lib/overlay-schema";
import {
  filterSellableProposed,
  type SellableCtx,
} from "@/lib/sellable-overrides";
import { getUniverseItems, type UniverseItem } from "@/lib/universe";

/** Soft UI page size only — not an expansion hard cap (§13 Q1). */
export const BULK_UI_PAGE_SIZE = 50;
/** Max batch-scope groups per interpret turn. */
export const MAX_BULK_INCLUDE_GROUPS = 4;

export type BulkInclude = OverlayBulkInclude;

export type BulkGroupReport = {
  id: string;
  label: string;
  matched: number;
  kept: number;
  unresolved?: boolean;
};

const PRODUCT_TYPE_ORDER: Record<string, number> = {
  etf: 0,
  fund: 1,
  stock: 2,
};

const ASSET_CLASS_SET = new Set<string>(ASSET_CLASSES);
const CATEGORY_KEY_SET = new Set(Object.keys(CATEGORY_LABELS));

/**
 * Theme phrase → regex matchers against name + category + asset_class.
 * Inspired by THEME_PROPOSAL_BUCKETS / universe-filter-fallback keywords.
 */
export const BULK_THEME_MATCHERS: { id: string; match: RegExp }[] = [
  {
    id: "ai",
    match:
      /\bai\b|artificial\s*intelligence|人工智慧|人工智能|機器人|机器人|반도체|semi|科技|tech\b/i,
  },
  {
    id: "esg",
    match: /\besg\b|永續|可持續|可持续|社會責任|책임\s*투자|sustainab|responsible\s*invest/i,
  },
  {
    id: "clean_energy",
    match: /clean\s*energy|潔淨能源|清洁能源|綠能|绿能|태양광|solar|climate|氣候|기후/i,
  },
  {
    id: "dividend",
    match: /配息|股息|dividend|income|高息|高配息|인컴|배당/i,
  },
  {
    id: "gold",
    match: /黃金|黄金|gold|precious|貴金屬|贵金属/i,
  },
  {
    id: "energy",
    match: /能源|energy|原油|oil|천연가스|gas\b/i,
  },
  {
    id: "reit",
    match: /reit|不動產|不动产|房地產|房地产|부동산|real\s*estate/i,
  },
  {
    id: "long_bond",
    match: /長天期|长天期|long\s*(duration|term)|長期債|장기\s*채|20\+?\s*year/i,
  },
  {
    id: "green_bond",
    match: /green\s*bond|綠債|绿色债券|綠色債券|기후\s*채권|sustainable\s*bond/i,
  },
  {
    id: "utilities",
    match: /utilit|公用|인프라|infra|infrastructure|基建|基礎設施/i,
  },
];

function itemHaystack(item: UniverseItem): string {
  return [item.name, item.category ?? "", item.asset_class ?? ""]
    .join(" ")
    .toLowerCase();
}

/** Match theme phrase against universe items (static table + substring fallback). */
export function matchThemeToUniverseItems(
  theme: string,
  items: readonly UniverseItem[],
): UniverseItem[] {
  const raw = theme.trim();
  if (!raw) return [];
  const matcher = BULK_THEME_MATCHERS.find((m) => m.match.test(raw));
  if (matcher) {
    return items.filter((item) => matcher.match.test(itemHaystack(item)));
  }
  const needle = raw.toLowerCase();
  return items.filter((item) => itemHaystack(item).includes(needle));
}

function rationaleFor(
  label: string,
  lang: "en" | "zh" | "ko",
): string {
  if (lang === "zh") return `整類納入：${label}`;
  if (lang === "ko") return `일괄 포함: ${label}`;
  return `Batch include: ${label}`;
}

function sortUniverseItems(items: UniverseItem[]): UniverseItem[] {
  return items.slice().sort((a, b) => {
    const pa = PRODUCT_TYPE_ORDER[(a.product_type ?? "etf").toLowerCase()] ?? 9;
    const pb = PRODUCT_TYPE_ORDER[(b.product_type ?? "etf").toLowerCase()] ?? 9;
    if (pa !== pb) return pa - pb;
    return a.ticker.localeCompare(b.ticker);
  });
}

function entryHasScope(entry: BulkInclude): boolean {
  return Boolean(
    entry.asset_class || entry.product_type || entry.category || entry.theme,
  );
}

/**
 * Expand bulk_include scopes into full sellable proposed_tickers (no hard cap).
 * Does NOT exclude anchor / model holdings (§13 Q2).
 */
export function expandBulkInclude(
  entries: readonly BulkInclude[],
  opts: {
    ctx?: SellableCtx;
    lang: "en" | "zh" | "ko";
    excludeTickers?: ReadonlySet<string>;
    supplementTickers?: ReadonlySet<string>;
    priorProposedTickers?: ReadonlySet<string>;
  },
): { proposed: OverlayProposedTicker[]; reports: BulkGroupReport[] } {
  const catalog = getUniverseItems();
  const exclude = opts.excludeTickers ?? new Set<string>();
  const supplement = opts.supplementTickers ?? new Set<string>();
  const prior = opts.priorProposedTickers ?? new Set<string>();
  const seen = new Set<string>();
  for (const t of prior) seen.add(t.toUpperCase());

  const proposed: OverlayProposedTicker[] = [];
  const reports: BulkGroupReport[] = [];

  for (const entry of entries.slice(0, MAX_BULK_INCLUDE_GROUPS)) {
    if (!entryHasScope(entry)) {
      reports.push({
        id: entry.id,
        label: entry.label,
        matched: 0,
        kept: 0,
      });
      continue;
    }

    if (entry.asset_class && !ASSET_CLASS_SET.has(entry.asset_class)) {
      reports.push({
        id: entry.id,
        label: entry.label,
        matched: 0,
        kept: 0,
      });
      continue;
    }

    if (entry.category && !CATEGORY_KEY_SET.has(entry.category)) {
      reports.push({
        id: entry.id,
        label: entry.label,
        matched: 0,
        kept: 0,
        unresolved: true,
      });
      continue;
    }

    let matchedItems = catalog.slice();

    if (entry.asset_class) {
      matchedItems = matchedItems.filter(
        (u) => u.asset_class === entry.asset_class,
      );
    }
    if (entry.product_type) {
      const want = entry.product_type.toLowerCase();
      matchedItems = matchedItems.filter(
        (u) => (u.product_type ?? "etf").toLowerCase() === want,
      );
    }
    if (entry.category) {
      matchedItems = matchedItems.filter((u) => u.category === entry.category);
    }
    if (entry.theme) {
      matchedItems = matchThemeToUniverseItems(entry.theme, matchedItems);
    }

    const matched = matchedItems.length;
    const themeOrCategoryPrimary =
      Boolean(entry.theme || entry.category) &&
      !entry.asset_class &&
      !entry.product_type;

    if (matched === 0 && themeOrCategoryPrimary) {
      reports.push({
        id: entry.id,
        label: entry.label,
        matched: 0,
        kept: 0,
        unresolved: true,
      });
      continue;
    }

    const asProposed: OverlayProposedTicker[] = sortUniverseItems(matchedItems).map(
      (u) => ({
        ticker: u.ticker.toUpperCase(),
        name: u.name,
        category: u.category,
        asset_class: ASSET_CLASS_SET.has(u.asset_class)
          ? (u.asset_class as OverlayProposedTicker["asset_class"])
          : undefined,
        rationale: rationaleFor(entry.label, opts.lang),
        bulk_id: entry.id,
      }),
    );

    const { kept: sellableKept } = filterSellableProposed(asProposed, opts.ctx);

    const keptRows: OverlayProposedTicker[] = [];
    for (const row of sellableKept) {
      const key = row.ticker.toUpperCase();
      if (exclude.has(key)) continue;
      if (supplement.has(key)) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      keptRows.push(row);
    }

    proposed.push(...keptRows);
    reports.push({
      id: entry.id,
      label: entry.label,
      matched,
      kept: keptRows.length,
    });
  }

  return { proposed, reports };
}

/**
 * Interpret-route wrapper: expand extract.universe.bulk_include into proposed_tickers.
 * Skips when construction === direct_index (§11 E8).
 */
export function expandBulkIncludeInExtract(
  extract: OverlayExtractOutput,
  opts: {
    ctx?: SellableCtx;
    lang: "en" | "zh" | "ko";
  },
): { extract: OverlayExtractOutput; reports: BulkGroupReport[] } {
  const bulk = extract.universe.bulk_include;
  if (!bulk?.length) {
    return { extract, reports: [] };
  }

  if (extract.universe.construction === "direct_index") {
    console.info(
      "[overlay/bulk] skipping expand: construction=direct_index",
    );
    return {
      extract: {
        ...extract,
        universe: {
          ...extract.universe,
          bulk_include: undefined,
        },
      },
      reports: [],
    };
  }

  const exclude = new Set(
    (extract.universe.exclude_tickers ?? []).map((t) => t.toUpperCase()),
  );
  const supplement = new Set(
    (extract.universe.supplement_tickers ?? []).map((t) => t.toUpperCase()),
  );
  const curated = extract.universe.proposed_tickers ?? [];
  const priorProposed = new Set(curated.map((p) => p.ticker.toUpperCase()));

  const { proposed: bulkProposed, reports } = expandBulkInclude(bulk, {
    ctx: opts.ctx,
    lang: opts.lang,
    excludeTickers: exclude,
    supplementTickers: supplement,
    priorProposedTickers: priorProposed,
  });

  // Drop unresolved groups from bulk_include (clarify path); keep empty matched groups.
  const unresolvedIds = new Set(
    reports.filter((r) => r.unresolved).map((r) => r.id),
  );
  const keptBulk = bulk.filter((b) => !unresolvedIds.has(b.id));

  return {
    extract: {
      ...extract,
      universe: {
        ...extract.universe,
        bulk_include: keptBulk.length ? keptBulk : undefined,
        proposed_tickers: [...curated, ...bulkProposed].length
          ? [...curated, ...bulkProposed]
          : undefined,
      },
    },
    reports,
  };
}

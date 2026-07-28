import { getUniverseItems } from "@/lib/universe";
import { MAINSTREAM_DEMO_TICKERS } from "@/lib/model-portfolios";

/** v3: full universe includes stocks + mutual funds (product_type). Bump invalidates stale v2 localStorage. */
export const INVESTMENT_POOL_STORAGE_KEY = "jasper_investment_pool_v3";

export type PoolProductType = "etf" | "stock" | "fund" | "structured" | "bond" | "other";

export type PoolItem = {
  ticker: string;
  name: string;
  asset_class: string;
  region: string;
  product_type: PoolProductType | string;
  enabled: boolean;
};

export type PoolImportReport = {
  upserted: number;
  skipped: number;
  errors: string[];
};

function universeLookup(): Map<
  string,
  { name: string; asset_class: string; region: string; product_type?: string }
> {
  const map = new Map<
    string,
    { name: string; asset_class: string; region: string; product_type?: string }
  >();
  for (const u of getUniverseItems()) {
    map.set(u.ticker.toUpperCase(), {
      name: u.name,
      asset_class: u.asset_class,
      region: u.region ?? "us",
      product_type: u.product_type,
    });
  }
  return map;
}

/** Bundled demo ETFs from MAINSTREAM_DEMO_TICKERS + universe metadata. */
export function buildDemoPool(): PoolItem[] {
  const lookup = universeLookup();
  return MAINSTREAM_DEMO_TICKERS.map((ticker) => {
    const meta = lookup.get(ticker);
    return {
      ticker,
      name: meta?.name ?? ticker,
      asset_class: meta?.asset_class ?? "equity",
      region: meta?.region ?? "us",
      product_type: meta?.product_type ?? "etf",
      enabled: true,
    };
  });
}

/** Full universe as pool (ETFs + stocks + funds; all enabled). */
export function buildFullUniversePool(): PoolItem[] {
  return getUniverseItems().map((u) => ({
    ticker: u.ticker.toUpperCase(),
    name: u.name,
    asset_class: u.asset_class,
    region: u.region ?? "us",
    product_type: u.product_type ?? "etf",
    enabled: true,
  }));
}

function normalizeItem(raw: Record<string, unknown>): PoolItem | null {
  const ticker = String(raw.ticker ?? "")
    .trim()
    .toUpperCase();
  if (!ticker) return null;
  const name = String(raw.name ?? ticker).trim() || ticker;
  const enabledRaw = raw.enabled;
  let enabled = true;
  if (typeof enabledRaw === "boolean") enabled = enabledRaw;
  else if (typeof enabledRaw === "string") {
    const v = enabledRaw.trim().toLowerCase();
    enabled = !(v === "false" || v === "0" || v === "no");
  }
  return {
    ticker,
    name,
    asset_class: String(raw.asset_class ?? "equity").trim() || "equity",
    region: String(raw.region ?? "us").trim() || "us",
    product_type: String(raw.product_type ?? "etf").trim() || "etf",
    enabled,
  };
}

export function readInvestmentPool(): PoolItem[] {
  if (typeof window === "undefined") return buildFullUniversePool();
  try {
    const raw = localStorage.getItem(INVESTMENT_POOL_STORAGE_KEY);
    if (!raw) return buildFullUniversePool();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return buildFullUniversePool();
    const items = parsed
      .map((row) => normalizeItem((row ?? {}) as Record<string, unknown>))
      .filter((x): x is PoolItem => x != null);
    return items.length ? items : buildFullUniversePool();
  } catch {
    return buildFullUniversePool();
  }
}

export function writeInvestmentPool(items: PoolItem[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(INVESTMENT_POOL_STORAGE_KEY, JSON.stringify(items));
  } catch {
    /* quota / private mode */
  }
}

export function getEnabledPoolTickers(pool?: PoolItem[]): Set<string> {
  const items = pool ?? readInvestmentPool();
  return new Set(
    items.filter((i) => i.enabled).map((i) => i.ticker.toUpperCase()),
  );
}

export function setPoolItemEnabled(
  ticker: string,
  enabled: boolean,
  pool?: PoolItem[],
): PoolItem[] {
  const items = [...(pool ?? readInvestmentPool())];
  const key = ticker.toUpperCase();
  const next = items.map((i) =>
    i.ticker.toUpperCase() === key ? { ...i, enabled } : i,
  );
  writeInvestmentPool(next);
  return next;
}

export function replaceInvestmentPool(items: PoolItem[]): PoolItem[] {
  writeInvestmentPool(items);
  return items;
}

/** Parse CSV text (header row required). Upsert by ticker. */
export function importPoolFromCsv(
  csvText: string,
  existing?: PoolItem[],
): { items: PoolItem[]; report: PoolImportReport } {
  const base = [...(existing ?? readInvestmentPool())];
  const byTicker = new Map(base.map((i) => [i.ticker.toUpperCase(), { ...i }]));
  const report: PoolImportReport = { upserted: 0, skipped: 0, errors: [] };

  const lines = csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    report.errors.push("CSV needs a header row and at least one data row");
    return { items: base, report };
  }

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const tickerIdx = idx("ticker");
  const nameIdx = idx("name");
  if (tickerIdx < 0 || nameIdx < 0) {
    report.errors.push("Missing required columns: ticker, name");
    return { items: base, report };
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const ticker = (cols[tickerIdx] ?? "").trim().toUpperCase();
    if (!ticker) {
      report.skipped += 1;
      report.errors.push(`Row ${i + 1}: empty ticker`);
      continue;
    }
    const name = (cols[nameIdx] ?? "").trim() || ticker;
    const get = (col: string, fallback: string) => {
      const j = idx(col);
      if (j < 0) return fallback;
      return (cols[j] ?? "").trim() || fallback;
    };
    const enabledRaw = get("enabled", "true").toLowerCase();
    const enabled = !(
      enabledRaw === "false" ||
      enabledRaw === "0" ||
      enabledRaw === "no"
    );
    byTicker.set(ticker, {
      ticker,
      name,
      asset_class: get("asset_class", "equity"),
      region: get("region", "us"),
      product_type: get("product_type", "etf"),
      enabled,
    });
    report.upserted += 1;
  }

  const items = [...byTicker.values()].sort((a, b) =>
    a.ticker.localeCompare(b.ticker),
  );
  writeInvestmentPool(items);
  return { items, report };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function poolToCsv(items: PoolItem[]): string {
  const header = "ticker,name,asset_class,region,product_type,enabled";
  const rows = items.map(
    (i) =>
      `${i.ticker},"${i.name.replace(/"/g, '""')}",${i.asset_class},${i.region},${i.product_type},${i.enabled}`,
  );
  return [header, ...rows].join("\n");
}

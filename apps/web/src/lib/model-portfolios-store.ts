import {
  getAnchorPortfolios,
  SPY_ANCHOR,
  type ModelPortfolio,
} from "@/lib/model-portfolios";
import {
  getEnabledPoolTickers,
  type PoolItem,
} from "@/lib/investment-pool";

export const MODEL_PORTFOLIOS_STORAGE_KEY = "jasper_model_portfolios_v4";

export type ManagedModelPortfolio = ModelPortfolio & {
  enabled: boolean;
  /** Tickers missing from enabled Investment Pool */
  conflict_tickers: string[];
};

export type ModelImportReport = {
  portfolios: number;
  skipped: number;
  errors: string[];
  conflicts: string[];
};

/** Stored / imported rows may omit newer AM fields — normalize before use. */
type StoredPortfolio = Omit<
  ModelPortfolio,
  "am_id" | "asset_manager" | "theme"
> & {
  enabled?: boolean;
  am_id?: string;
  asset_manager?: string;
  theme?: string;
};

function normalizePortfolioFields(
  p: StoredPortfolio,
): ModelPortfolio & { enabled?: boolean } {
  const theme = p.theme || p.name;
  const asset_manager = p.asset_manager || "Demo AM";
  const am_id =
    p.am_id ||
    asset_manager
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") ||
    "demo-am";
  return {
    ...p,
    theme,
    name: p.name || theme,
    asset_manager,
    am_id,
  };
}

function withConflicts(
  portfolio: StoredPortfolio,
  enabledTickers: Set<string>,
): ManagedModelPortfolio {
  const conflict_tickers: string[] = [];
  for (const h of portfolio.holdings) {
    const t = h.ticker.toUpperCase();
    if (t === "CASH") continue;
    if (!enabledTickers.has(t)) conflict_tickers.push(t);
  }
  const bm = portfolio.benchmark?.toUpperCase();
  if (bm && !enabledTickers.has(bm) && !conflict_tickers.includes(bm)) {
    conflict_tickers.push(bm);
  }
  return {
    ...normalizePortfolioFields(portfolio),
    enabled: portfolio.enabled !== false,
    conflict_tickers: [...new Set(conflict_tickers)],
  };
}

export function buildBundledManagedPortfolios(
  pool?: PoolItem[],
): ManagedModelPortfolio[] {
  const enabled = getEnabledPoolTickers(pool);
  return getAnchorPortfolios().map((p) =>
    withConflicts({ ...p, enabled: true }, enabled),
  );
}

function readStoredRaw(): StoredPortfolio[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(MODEL_PORTFOLIOS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed as StoredPortfolio[];
  } catch {
    return null;
  }
}

function writeStored(portfolios: StoredPortfolio[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      MODEL_PORTFOLIOS_STORAGE_KEY,
      JSON.stringify(portfolios),
    );
  } catch {
    /* ignore */
  }
}

export function readManagedPortfolios(
  pool?: PoolItem[],
): ManagedModelPortfolio[] {
  const enabled = getEnabledPoolTickers(pool);
  const stored = readStoredRaw();
  if (!stored || stored.length === 0) {
    return buildBundledManagedPortfolios(pool);
  }
  return stored.map((p) => withConflicts(p, enabled));
}

export function replaceManagedPortfolios(
  portfolios: ManagedModelPortfolio[],
): ManagedModelPortfolio[] {
  const toStore: StoredPortfolio[] = portfolios.map((item) => {
    const rest = { ...item };
    delete (rest as { conflict_tickers?: string[] }).conflict_tickers;
    return rest;
  });
  writeStored(toStore);
  return readManagedPortfolios();
}

export function setModelPortfolioEnabled(
  id: string,
  enabled: boolean,
  pool?: PoolItem[],
): ManagedModelPortfolio[] {
  const current = readManagedPortfolios(pool);
  const next = current.map((p) => (p.id === id ? { ...p, enabled } : p));
  return replaceManagedPortfolios(next);
}

export function resetManagedPortfoliosToBundled(
  pool?: PoolItem[],
): ManagedModelPortfolio[] {
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(MODEL_PORTFOLIOS_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  return buildBundledManagedPortfolios(pool);
}

/** Anchors usable in stage-3 selector: enabled and no pool conflicts. */
export function getSelectableAnchorPortfolios(
  pool?: PoolItem[],
): ModelPortfolio[] {
  return readManagedPortfolios(pool)
    .filter((p) => p.enabled && p.conflict_tickers.length === 0)
    .map((item) => {
      const rest: Record<string, unknown> = { ...item };
      delete rest.conflict_tickers;
      delete rest.enabled;
      return rest as Omit<typeof item, "conflict_tickers" | "enabled">;
    });
}

export function getManagedPortfolioById(
  id: string,
  pool?: PoolItem[],
): ManagedModelPortfolio | undefined {
  return readManagedPortfolios(pool).find((p) => p.id === id);
}

/**
 * Flat CSV (scheme A):
 * portfolio_id,portfolio_name,risk_profile,ticker,weight,benchmark_ticker,enabled
 * Same portfolio_id rows replace holdings entirely.
 */
export function importModelsFromCsv(
  csvText: string,
  pool?: PoolItem[],
): { portfolios: ManagedModelPortfolio[]; report: ModelImportReport } {
  const report: ModelImportReport = {
    portfolios: 0,
    skipped: 0,
    errors: [],
    conflicts: [],
  };
  const lines = csvText
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    report.errors.push("CSV needs a header row and at least one data row");
    return { portfolios: readManagedPortfolios(pool), report };
  }

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const idIdx = idx("portfolio_id");
  const nameIdx = idx("portfolio_name");
  const tickerIdx = idx("ticker");
  const weightIdx = idx("weight");
  if (idIdx < 0 || nameIdx < 0 || tickerIdx < 0 || weightIdx < 0) {
    report.errors.push(
      "Missing required columns: portfolio_id, portfolio_name, ticker, weight",
    );
    return { portfolios: readManagedPortfolios(pool), report };
  }

  type Acc = {
    id: string;
    name: string;
    theme: string;
    asset_manager: string;
    am_id: string;
    risk_level: string;
    benchmark: string;
    enabled: boolean;
    holdings: { ticker: string; weight: number; name: string }[];
  };
  const groups = new Map<string, Acc>();

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    const id = (cols[idIdx] ?? "").trim();
    const pname = (cols[nameIdx] ?? "").trim();
    const ticker = (cols[tickerIdx] ?? "").trim().toUpperCase();
    let weight = parseFloat((cols[weightIdx] ?? "").trim());
    if (!id || !pname || !ticker || !Number.isFinite(weight)) {
      report.skipped += 1;
      report.errors.push(`Row ${i + 1}: invalid id/name/ticker/weight`);
      continue;
    }
    if (weight > 1.5) weight = weight / 100;

    const get = (col: string, fallback: string) => {
      const j = idx(col);
      if (j < 0) return fallback;
      return (cols[j] ?? "").trim() || fallback;
    };
    const risk = get("risk_profile", "moderate");
    const benchmark = get("benchmark_ticker", "SPY").toUpperCase();
    const asset_manager = get("asset_manager", "Demo AM");
    const am_id = get(
      "am_id",
      asset_manager
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "demo-am",
    );
    const theme = get("theme", pname);
    const enabledRaw = get("enabled", "true").toLowerCase();
    const enabled = !(
      enabledRaw === "false" ||
      enabledRaw === "0" ||
      enabledRaw === "no"
    );

    let acc = groups.get(id);
    if (!acc) {
      acc = {
        id,
        name: pname,
        theme,
        asset_manager,
        am_id,
        risk_level: risk,
        benchmark,
        enabled,
        holdings: [],
      };
      groups.set(id, acc);
    }
    acc.holdings.push({ ticker, weight, name: ticker });
    acc.name = pname;
    acc.theme = theme;
    acc.asset_manager = asset_manager;
    acc.am_id = am_id;
    acc.risk_level = risk;
    acc.benchmark = benchmark;
    acc.enabled = enabled;
  }

  const enabledTickers = getEnabledPoolTickers(pool);
  const existing = readManagedPortfolios(pool);
  const byId = new Map(existing.map((p) => [p.id, p]));

  for (const acc of groups.values()) {
    const sum = acc.holdings.reduce((s, h) => s + h.weight, 0);
    if (sum <= 0) {
      report.errors.push(`Portfolio ${acc.id}: weight sum is 0`);
      continue;
    }
    if (Math.abs(sum - 1) > 0.02) {
      report.errors.push(
        `Portfolio ${acc.id}: weight sum ${sum.toFixed(3)} (expected ~1.0); normalized`,
      );
    }
    const holdings = acc.holdings.map((h) => ({
      ...h,
      weight: h.weight / sum,
    }));
    const mix: Record<string, number> = {};
    // Simplified mix: treat all as equity unless ticker looks like bond/gold
    for (const h of holdings) {
      const cls = inferAssetClass(h.ticker);
      mix[cls] = (mix[cls] ?? 0) + h.weight;
    }
    const portfolio: ManagedModelPortfolio = withConflicts(
      {
        id: acc.id,
        am_id: acc.am_id,
        asset_manager: acc.asset_manager,
        theme: acc.theme,
        name: acc.name,
        description: `Imported model portfolio ${acc.name}`,
        source: { name: "CSV import", url: "" },
        asset_class_mix: mix,
        holdings,
        benchmark: acc.benchmark,
        risk_level: acc.risk_level,
        enabled: acc.enabled,
      },
      enabledTickers,
    );
    if (portfolio.conflict_tickers.length) {
      report.conflicts.push(
        `${acc.id}: ${portfolio.conflict_tickers.join(", ")}`,
      );
    }
    byId.set(acc.id, portfolio);
    report.portfolios += 1;
  }

  const next = [...byId.values()];
  replaceManagedPortfolios(next);
  return { portfolios: readManagedPortfolios(pool), report };
}

function inferAssetClass(ticker: string): string {
  const t = ticker.toUpperCase();
  if (["AGG", "BND", "TLT", "IEF", "SHY", "LQD", "HYG"].includes(t)) {
    return "fixed_income";
  }
  if (["GLD", "PDBC", "IAU", "SLV"].includes(t)) return "commodity";
  if (["VNQ", "IYR"].includes(t)) return "real_estate";
  return "equity";
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

export function modelsToCsv(portfolios: ManagedModelPortfolio[]): string {
  const header =
    "portfolio_id,portfolio_name,asset_manager,am_id,theme,risk_profile,ticker,weight,benchmark_ticker,enabled";
  const rows: string[] = [];
  for (const p of portfolios) {
    for (const h of p.holdings) {
      rows.push(
        [
          p.id,
          `"${p.name.replace(/"/g, '""')}"`,
          `"${(p.asset_manager || "Demo AM").replace(/"/g, '""')}"`,
          p.am_id || "demo-am",
          `"${(p.theme || p.name).replace(/"/g, '""')}"`,
          p.risk_level,
          h.ticker,
          h.weight,
          p.benchmark,
          p.enabled,
        ].join(","),
      );
    }
  }
  return [header, ...rows].join("\n");
}

/** Prefer suggested id; else first selectable matching risk. */
export function resolveSuggestedAnchorId(
  suggestedId: string | null | undefined,
  riskProfile: string,
  pool?: PoolItem[],
): string {
  const selectable = getSelectableAnchorPortfolios(pool);
  if (suggestedId && selectable.some((p) => p.id === suggestedId)) {
    return suggestedId;
  }
  const riskLevels =
    riskProfile === "conservative"
      ? ["conservative", "moderate_conservative", "moderate"]
      : riskProfile === "aggressive"
        ? ["aggressive", "moderate_aggressive", "moderate"]
        : ["moderate", "moderate_aggressive", "moderate_conservative"];
  for (const level of riskLevels) {
    const match = selectable.find((p) => p.risk_level === level);
    if (match) return match.id;
  }
  return selectable[0]?.id ?? SPY_ANCHOR.id;
}

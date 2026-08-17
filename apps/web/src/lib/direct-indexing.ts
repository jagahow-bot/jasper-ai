import { getUniverseItems, type UniverseItem } from "./universe";
import type { Lang } from "./universe-filter-locale";

/** Thematic / satellite ETFs that must not stand in for a stock sleeve. */
export const THEMATIC_SUBSTITUTE_ETFS = new Set([
  "AIQ",
  "IRBO",
  "BOTZ",
  "ROBO",
  "THNQ",
  "IGPT",
  "TECB",
  "ROBT",
  "CHAT",
  "ARKK",
  "ARKW",
  "ARKG",
  "CIBR",
  "CLOU",
  "WCLD",
  "SKYY",
  "SMH",
  "SOXX",
  "XSD",
  "IGV",
]);

const THEMATIC_CATEGORIES = new Set(["us_thematic", "intl_thematic"]);

export const DEFAULT_DIRECT_INDEX_SLEEVE = 8;
/** Align with BacktestRequest.max_holdings le=50. */
export const MAX_DIRECT_INDEX_SLEEVE = 50;

/** Preferred AI names used as overweight *within* an SPX sleeve (must exist in universe). */
const AI_STOCK_PRIORITY = [
  "NVDA",
  "MSFT",
  "AAPL",
  "GOOGL",
  "AMZN",
  "META",
  "AVGO",
  "AMD",
  "AMAT",
  "QCOM",
  "ORCL",
  "CRM",
  "ADBE",
  "NOW",
  "INTU",
  "MU",
  "KLAC",
  "LRCX",
  "TSLA",
];

/** Compact default sleeve when the brief does not specify a count. */
const MEGA_STOCK_PRIORITY = [
  "AAPL",
  "MSFT",
  "AMZN",
  "GOOGL",
  "META",
  "NVDA",
  "AVGO",
  "BRK-B",
  "JPM",
  "JNJ",
  "UNH",
  "XOM",
  "V",
  "PG",
  "HD",
  "MA",
  "LLY",
  "COST",
];

/**
 * Ordered S&P 500 / US large-cap names in typical market-cap order.
 * Used when the brief asks for top N (e.g. top 30 / 前 30).
 */
const SPX_LARGE_CAP_PRIORITY = [
  "NVDA",
  "MSFT",
  "AAPL",
  "AMZN",
  "GOOGL",
  "META",
  "AVGO",
  "BRK-B",
  "TSLA",
  "LLY",
  "JPM",
  "WMT",
  "V",
  "XOM",
  "MA",
  "UNH",
  "ORCL",
  "COST",
  "NFLX",
  "HD",
  "PG",
  "JNJ",
  "ABBV",
  "BAC",
  "CRM",
  "KO",
  "CVX",
  "MRK",
  "AMD",
  "PEP",
  "CSCO",
  "TMO",
  "LIN",
  "MCD",
  "GE",
  "ABT",
  "DIS",
  "WFC",
  "PM",
  "IBM",
  "CAT",
  "RTX",
  "ADBE",
  "NOW",
  "INTU",
  "AMAT",
  "QCOM",
  "TXN",
  "AMGN",
  "PFE",
  "HON",
  "NEE",
  "LOW",
  "UNP",
  "COP",
  "BA",
  "BLK",
  "GS",
  "AXP",
  "VZ",
];

const DIRECT_INDEX_RE =
  /direct[\s-]*index|directindexing|直接索引|直接指數化|直接指数化|直接指數|直接指数|직접\s*인덱싱|다이렉트\s*인덱싱|직접지수화|직접\s*지수/i;

const AI_TILT_RE =
  /\bai\b|artificial intelligence|machine learning|genai|generative ai|人工智慧|人工智能|機器人|机器人|인공지능|로봇/i;

const CN_COUNT_WORDS: Record<string, number> = {
  十: 10,
  二十: 20,
  三十: 30,
  四十: 40,
  五十: 50,
};

let _stockSet: Set<string> | null = null;
let _itemByTicker: Map<string, UniverseItem> | null = null;

function itemMap(): Map<string, UniverseItem> {
  if (!_itemByTicker) {
    _itemByTicker = new Map(
      getUniverseItems().map((u) => [u.ticker.toUpperCase(), u]),
    );
  }
  return _itemByTicker;
}

function stockTickerSet(): Set<string> {
  if (!_stockSet) {
    _stockSet = new Set(
      getUniverseItems()
        .filter((u) => (u.product_type ?? "etf") === "stock")
        .map((u) => u.ticker.toUpperCase()),
    );
  }
  return _stockSet;
}

function uniqueUpper(tickers: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tickers) {
    const key = String(raw || "")
      .trim()
      .toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function clampSleeveCount(n: number): number {
  return Math.min(MAX_DIRECT_INDEX_SLEEVE, Math.max(2, Math.floor(n)));
}

function pushCount(matches: number[], raw: string | undefined): void {
  if (!raw) return;
  const n = Number(raw);
  if (!Number.isFinite(n)) return;
  if (n < 2 || n > MAX_DIRECT_INDEX_SLEEVE) return;
  matches.push(n);
}

/**
 * Parse an explicit sleeve size from overlay text, asks, prompts, or
 * clarification answers (e.g. "top 30", "前 30", "상위 30").
 * Returns undefined when no count is stated so callers keep the compact default.
 */
export function parseDirectIndexSleeveCount(text: string): number | undefined {
  const src = text?.trim() ?? "";
  if (!src) return undefined;
  const matches: number[] = [];

  for (const re of [
    /(?:top|largest|biggest|leading)\s*[-–]?\s*(\d{1,2})\b/gi,
    /前\s*(\d{1,2})\s*(?:大|檔|支|隻|只|名|個股)?/g,
    /(?:상위|톱|시총\s*상위|시가총액\s*상위)\s*(\d{1,2})/g,
    /(\d{1,2})\s*(?:large-?cap\s+)?(?:constituents?|names|stocks|equities|個股|檔股票|隻股票|종목)/gi,
  ]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      pushCount(matches, m[1]);
    }
  }

  const wordRe = /前\s*(十|二十|三十|四十|五十)/g;
  let wm: RegExpExecArray | null;
  while ((wm = wordRe.exec(src)) !== null) {
    const n = CN_COUNT_WORDS[wm[1]];
    if (n != null) matches.push(n);
  }

  if (!matches.length) return undefined;
  return clampSleeveCount(matches[matches.length - 1]);
}

export function resolveDirectIndexSleeveCount(text: string, limit?: number): number {
  if (limit != null && Number.isFinite(limit)) return clampSleeveCount(limit);
  return clampSleeveCount(parseDirectIndexSleeveCount(text) ?? DEFAULT_DIRECT_INDEX_SLEEVE);
}

export function detectDirectIndexing(text: string): boolean {
  return Boolean(text?.trim() && DIRECT_INDEX_RE.test(text));
}

export function detectAiTilt(text: string): boolean {
  return Boolean(text?.trim() && AI_TILT_RE.test(text));
}

export function isUniverseStock(ticker: string): boolean {
  return stockTickerSet().has(ticker.trim().toUpperCase());
}

export function isThematicSubstituteEtf(ticker: string): boolean {
  const key = ticker.trim().toUpperCase();
  if (THEMATIC_SUBSTITUTE_ETFS.has(key)) return true;
  const item = itemMap().get(key);
  if (!item) return false;
  if ((item.product_type ?? "etf") === "stock") return false;
  return THEMATIC_CATEGORIES.has(String(item.category ?? ""));
}

/** Keep core ETFs + stocks; drop thematic ETF substitutes unless explicitly named. */
export function filterTickersForDirectIndex(
  tickers: readonly string[],
  opts?: { allowExplicit?: ReadonlySet<string> | readonly string[] },
): string[] {
  const allow = new Set(
    [...(opts?.allowExplicit ?? [])].map((t) => t.toUpperCase()),
  );
  return uniqueUpper(tickers).filter((t) => {
    if (isUniverseStock(t)) return true;
    if (!isThematicSubstituteEtf(t)) return true;
    return allow.has(t);
  });
}

function isUsStockCategory(category: string): boolean {
  return category.startsWith("us_stock");
}

function pickFromPrefer(
  prefer: readonly string[],
  limit: number,
  fillCats: ReadonlySet<string> | "us_stock",
): string[] {
  const stocks = stockTickerSet();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of prefer) {
    if (!stocks.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= limit) return out;
  }
  for (const item of getUniverseItems()) {
    if (out.length >= limit) break;
    if ((item.product_type ?? "etf") !== "stock") continue;
    const t = item.ticker.toUpperCase();
    if (seen.has(t)) continue;
    const cat = String(item.category ?? "");
    const ok = fillCats === "us_stock" ? isUsStockCategory(cat) : fillCats.has(cat);
    if (!ok) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function overweightAiWithin(sleeve: string[]): string[] {
  const ai = new Set(AI_STOCK_PRIORITY);
  return [...sleeve.filter((t) => ai.has(t)), ...sleeve.filter((t) => !ai.has(t))];
}

export function pickDirectIndexStocks(text: string, limit?: number): string[] {
  const parsed = parseDirectIndexSleeveCount(text);
  const n = resolveDirectIndexSleeveCount(text, limit);
  const honorSpx = parsed != null || (limit != null && limit > DEFAULT_DIRECT_INDEX_SLEEVE);

  if (honorSpx) {
    const sleeve = pickFromPrefer(SPX_LARGE_CAP_PRIORITY, n, "us_stock");
    return detectAiTilt(text) ? overweightAiWithin(sleeve).slice(0, n) : sleeve;
  }

  const prefer = detectAiTilt(text) ? AI_STOCK_PRIORITY : MEGA_STOCK_PRIORITY;
  const fillCats = detectAiTilt(text)
    ? new Set(["us_stock_semi", "us_stock_tech", "us_stock_mega"])
    : new Set(["us_stock_mega"]);
  return pickFromPrefer(prefer, n, fillCats);
}

export type DirectIndexProposedTicker = {
  ticker: string;
  name?: string;
  category?: string;
  rationale?: string;
};

export function proposedTickersForDirectIndex(
  text: string,
  lang: Lang,
  limit?: number,
): DirectIndexProposedTicker[] {
  const stocks = pickDirectIndexStocks(text, limit);
  const rationale =
    lang === "zh"
      ? "直接指數化個股袖套（非主題 ETF）"
      : lang === "ko"
        ? "직접 인덱싱 개별 주식 슬리브 (테마 ETF 아님)"
        : "Direct-index stock sleeve (not a thematic ETF)";
  return stocks.map((ticker) => {
    const meta = itemMap().get(ticker);
    return {
      ticker,
      name: meta?.name,
      category: meta?.category,
      rationale,
    };
  });
}

export function directIndexAskCopy(lang: Lang): {
  title: string;
  summary: string;
} {
  if (lang === "zh") {
    return {
      title: "直接指數化（個股）",
      summary:
        "以個股複製／傾斜基準 ETF（如 SPY），AI 超配用 NVDA、MSFT 等股票，而非 AIQ／BOTZ／IRBO 等主題 ETF。",
    };
  }
  if (lang === "ko") {
    return {
      title: "직접 인덱싱 (개별 주식)",
      summary:
        "기준 ETF(예: SPY)를 개별 주식으로 복제·틸트합니다. AI 비중은 AIQ/BOTZ/IRBO가 아니라 NVDA·MSFT 등 주식으로 표현합니다.",
    };
  }
  return {
    title: "Direct index with stocks",
    summary:
      "Replicate or tilt around the benchmark ETF (e.g. SPY) with individual equities. Express AI overweight via names like NVDA/MSFT — not thematic ETFs such as AIQ, BOTZ, or IRBO.",
  };
}

export function directIndexUniversePrompt(lang: Lang): string {
  if (lang === "zh") {
    return "以個股直接指數化基準 ETF；可保留縮小的核心 ETF，主題超配用個股而非主題 ETF";
  }
  if (lang === "ko") {
    return "개별 주식으로 벤치마크 ETF 직접 인덱싱; 코어 ETF는 축소 유지, 테마 틸트는 주식";
  }
  return "Direct-index the benchmark ETF with individual stocks; keep a reduced core ETF sleeve and express tilts via stocks, not thematic ETFs";
}

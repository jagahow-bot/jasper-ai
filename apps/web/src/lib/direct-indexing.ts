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

/** Preferred AI / mega-cap names for a DI stock overlay (must exist in universe). */
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

const DIRECT_INDEX_RE =
  /direct[\s-]*index|directindexing|直接索引|直接指數化|直接指数化|直接指數|直接指数|직접\s*인덱싱|다이렉트\s*인덱싱|직접지수화|직접\s*지수/i;

const AI_TILT_RE =
  /\bai\b|artificial intelligence|machine learning|genai|generative ai|人工智慧|人工智能|機器人|机器人|인공지능|로봇/i;

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

export function pickDirectIndexStocks(text: string, limit = 8): string[] {
  const stocks = stockTickerSet();
  const prefer = detectAiTilt(text) ? AI_STOCK_PRIORITY : MEGA_STOCK_PRIORITY;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of prefer) {
    if (!stocks.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= limit) return out;
  }
  const fillCats = detectAiTilt(text)
    ? new Set(["us_stock_semi", "us_stock_tech", "us_stock_mega"])
    : new Set(["us_stock_mega"]);
  for (const item of getUniverseItems()) {
    if (out.length >= limit) break;
    if ((item.product_type ?? "etf") !== "stock") continue;
    const t = item.ticker.toUpperCase();
    if (seen.has(t)) continue;
    if (!fillCats.has(String(item.category ?? ""))) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
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
  limit = 8,
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

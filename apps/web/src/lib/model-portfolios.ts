import modelPortfoliosFile from "@/data/model-portfolios.json";
import type { AssetClass } from "@/lib/constants";
import type { BacktestRequest, ParamControl } from "@/lib/types";
import type { Lang } from "@/lib/i18n";

export type ModelPortfolioHolding = {
  ticker: string;
  weight: number;
  name: string;
};

export type ModelPortfolioSource = {
  name: string;
  url: string;
};

export type ModelPortfolio = {
  id: string;
  /** Stable issuer family id (e.g. blackrock-ishares). */
  am_id: string;
  /** Display name of the Asset Manager / issuer family. */
  asset_manager: string;
  /** Product / theme title (also mirrored in `name`). */
  theme: string;
  name: string;
  description: string;
  source: ModelPortfolioSource;
  asset_class_mix: Record<string, number>;
  holdings: ModelPortfolioHolding[];
  benchmark: string;
  risk_level: string;
};

type ModelPortfoliosFile = {
  version: string;
  updated: string;
  description?: string;
  portfolios: ModelPortfolio[];
};

const file = modelPortfoliosFile as unknown as ModelPortfoliosFile;

export function getModelPortfolios(): ModelPortfolio[] {
  return file.portfolios;
}

export function getModelPortfolioById(id: string): ModelPortfolio | undefined {
  return file.portfolios.find((p) => p.id === id);
}

export function getModelPortfolioTickers(): string[] {
  const tickers = new Set<string>();
  for (const p of file.portfolios) {
    for (const h of p.holdings) tickers.add(h.ticker.toUpperCase());
    tickers.add(p.benchmark.toUpperCase());
  }
  return [...tickers].sort();
}

/** Mainstream building blocks for JASPER demo (ETF + stock + fund cores). */
export const MAINSTREAM_DEMO_TICKERS = [
  "SPY",
  "QQQ",
  "IWM",
  "IVV",
  "DIA",
  "VTI",
  "VXUS",
  "EFA",
  "AGG",
  "BND",
  "TLT",
  "IEF",
  "SHY",
  "LQD",
  "HYG",
  "GLD",
  "PDBC",
  "XLV",
  "XLF",
  // Stocks
  "AAPL",
  "MSFT",
  "NVDA",
  "GOOGL",
  "AMZN",
  "META",
  "AVGO",
  "AMD",
  "JPM",
  "JNJ",
  "PG",
  "BRK-B",
  "COST",
  "NEE",
  "UNH",
  // Mutual funds
  "VFIAX",
  "VTSAX",
  "VBTLX",
  "VWELX",
  "FXAIX",
  "FDGRX",
  "FZILX",
  "DODIX",
] as const;

export const SPY_ANCHOR_ID = "spy-benchmark";

/** Baseline = selected client holdings; not tied to any house model portfolio. */
export const CURRENT_HOLDINGS_ANCHOR_ID = "current-holdings";

export const SPY_ANCHOR: ModelPortfolio = {
  id: SPY_ANCHOR_ID,
  am_id: "state-street-spdr",
  asset_manager: "State Street SPDR",
  theme: "S&P 500 Benchmark",
  name: "S&P 500 Benchmark",
  description:
    "State Street SPDR single-ticker US large-cap benchmark (SPY). Common anchor for personalized ETF variants.",
  source: {
    name: "SPDR S&P 500 ETF Trust",
    url: "https://www.ssga.com/us/en/individual/etfs/funds/spdr-sp-500-etf-trust-spy",
  },
  asset_class_mix: { equity: 1 },
  holdings: [
    { ticker: "SPY", weight: 1, name: "SPDR S&P 500 ETF Trust" },
  ],
  benchmark: "SPY",
  risk_level: "moderate",
};

/** Localized AM labels keyed by `am_id` (house catalog + SPY benchmark). */
const ASSET_MANAGER_LABELS: Record<Lang, Record<string, string>> = {
  en: {
    "jasper-house": "JASPER Model",
    "state-street-spdr": "State Street SPDR",
    "client-book": "Client book",
  },
  zh: {
    "jasper-house": "JASPER 模型",
    "state-street-spdr": "State Street SPDR",
    "client-book": "客戶現況",
  },
  ko: {
    "jasper-house": "JASPER 모델",
    "state-street-spdr": "State Street SPDR",
    "client-book": "고객 보유",
  },
};

/** Theme / product title (card title). */
const PORTFOLIO_LABELS: Record<Lang, Record<string, string>> = {
  en: {
    [SPY_ANCHOR_ID]: "S&P 500 Benchmark",
    [CURRENT_HOLDINGS_ANCHOR_ID]: "Current holdings (no model)",
    "classic-60-40": "Balanced Core",
    "bogleheads-three-fund-80-20": "Three-Fund Plus",
    "global-equity-market-cap": "Global Equity",
    "us-multi-cap-equity": "US Large Cap Core",
    "us-sector-growth-tilt": "Tech Growth",
    "all-weather-simplified": "All Weather Defensive",
    "vanguard-equity-tilt-80-20": "Equity Tilt 80/20",
  },
  zh: {
    [SPY_ANCHOR_ID]: "標普 500 基準",
    [CURRENT_HOLDINGS_ANCHOR_ID]: "現況持倉（不參照模型）",
    "classic-60-40": "平衡核心",
    "bogleheads-three-fund-80-20": "三基金強化",
    "global-equity-market-cap": "全球股票",
    "us-multi-cap-equity": "美國大型股核心",
    "us-sector-growth-tilt": "科技成長",
    "all-weather-simplified": "全天候防禦",
    "vanguard-equity-tilt-80-20": "股票傾斜 80/20",
  },
  ko: {
    [SPY_ANCHOR_ID]: "S&P 500 벤치마크",
    [CURRENT_HOLDINGS_ANCHOR_ID]: "현재 보유(모델 미참조)",
    "classic-60-40": "균형 코어",
    "bogleheads-three-fund-80-20": "3-펀드 플러스",
    "global-equity-market-cap": "글로벌 주식",
    "us-multi-cap-equity": "미국 대형주 코어",
    "us-sector-growth-tilt": "테크 성장",
    "all-weather-simplified": "올웨더 방어형",
    "vanguard-equity-tilt-80-20": "주식 틸트 80/20",
  },
};

export function getAssetManagerLabel(
  portfolio: ModelPortfolio,
  lang: Lang,
): string {
  return (
    (portfolio.am_id
      ? ASSET_MANAGER_LABELS[lang][portfolio.am_id]
      : undefined) ??
    portfolio.asset_manager ??
    "Demo AM"
  );
}

/** Theme / product name for the selected anchor. */
export function getPortfolioLabel(portfolio: ModelPortfolio, lang: Lang): string {
  return (
    PORTFOLIO_LABELS[lang][portfolio.id] ??
    portfolio.theme ??
    portfolio.name
  );
}

/** "AM · Theme" composite for compact displays. */
export function getAmThemeLabel(portfolio: ModelPortfolio, lang: Lang): string {
  return `${getAssetManagerLabel(portfolio, lang)} · ${getPortfolioLabel(portfolio, lang)}`;
}

/**
 * Localized performance-benchmark label for charts / institutional sections.
 * Prefer the selected anchor model-portfolio name when provided (e.g. Multi-Cap
 * whose official benchmark_ticker is still SPY), and always surface the ticker
 * when it is not already in the display name.
 */
export function formatBenchmarkDisplayLabel(
  ticker: string,
  lang: Lang,
  opts?: { anchorPortfolio?: ModelPortfolio | null },
): string {
  const upper = ticker.trim().toUpperCase();
  if (!upper) return "SPY";

  const withTicker = (name: string) =>
    name.toUpperCase().includes(upper) ? name : `${name} (${upper})`;

  if (opts?.anchorPortfolio) {
    return withTicker(getPortfolioLabel(opts.anchorPortfolio, lang));
  }

  // Without an explicit anchor, prefer the pure single-ticker catalog match.
  if (upper === "SPY") {
    const spy = getAnchorPortfolioById(SPY_ANCHOR_ID);
    if (spy) return withTicker(getPortfolioLabel(spy, lang));
  }
  const byTicker = getAnchorPortfolios().find(
    (p) => p.benchmark.toUpperCase() === upper,
  );
  if (byTicker) return withTicker(getPortfolioLabel(byTicker, lang));
  return upper;
}

/**
 * True when the selected model portfolio is more than a single-ticker clone of
 * the performance benchmark (so UX should clarify anchor vs ticker).
 */
export function anchorDiffersFromBenchmarkTicker(
  portfolio: ModelPortfolio | null | undefined,
  benchmarkTicker: string,
): boolean {
  if (!portfolio) return false;
  const ticker = benchmarkTicker.trim().toUpperCase();
  if (!ticker) return false;
  if (
    portfolio.holdings.length === 1 &&
    portfolio.holdings[0].ticker.toUpperCase() === ticker &&
    Math.abs(portfolio.holdings[0].weight - 1) < 1e-6
  ) {
    return false;
  }
  return true;
}

export function getAnchorPortfolios(): ModelPortfolio[] {
  return [SPY_ANCHOR, ...file.portfolios];
}

export function getAnchorPortfolioById(id: string): ModelPortfolio | undefined {
  if (id === SPY_ANCHOR_ID) return SPY_ANCHOR;
  // Dynamic — use buildCurrentHoldingsAnchor with live scope holdings.
  if (id === CURRENT_HOLDINGS_ANCHOR_ID) return undefined;
  return getModelPortfolioById(id);
}

/**
 * Synthetic anchor from the client's selected scope holdings (not a house model).
 * Cash is excluded from the investable baseline and weights are renormalized.
 */
export function buildCurrentHoldingsAnchor(
  holdings: Array<{ ticker: string; weight: number; name?: string; asset_class?: string }>,
): ModelPortfolio | null {
  const invested = holdings.filter((h) => {
    const t = h.ticker.toUpperCase();
    const cls = (h.asset_class ?? "").toLowerCase();
    if (t === "CASH" || cls === "cash" || cls.includes("cash") || cls.includes("現金")) {
      return false;
    }
    return h.weight > 0;
  });
  if (!invested.length) return null;

  const sum = invested.reduce((s, h) => s + h.weight, 0);
  const scale = sum > 0 ? 1 / sum : 1;
  const normalized: ModelPortfolioHolding[] = invested.map((h) => ({
    ticker: h.ticker.toUpperCase(),
    weight: h.weight * scale,
    name: h.name?.trim() || h.ticker.toUpperCase(),
  }));

  const mix: Record<string, number> = {};
  for (const h of normalized) {
    const cls = inferMixClass(h.ticker, holdings.find((x) => x.ticker.toUpperCase() === h.ticker)?.asset_class);
    mix[cls] = (mix[cls] ?? 0) + h.weight;
  }

  return {
    id: CURRENT_HOLDINGS_ANCHOR_ID,
    am_id: "client-book",
    asset_manager: "Client book",
    theme: "Current holdings",
    name: "Current holdings",
    description:
      "Baseline is the selected client holdings; this run is not anchored to a house model portfolio.",
    source: { name: "Client current holdings", url: "" },
    asset_class_mix: mix,
    holdings: normalized,
    benchmark: normalized[0]?.ticker ?? "SPY",
    risk_level: "moderate",
  };
}

function inferMixClass(ticker: string, assetClass?: string): string {
  const c = (assetClass ?? "").toLowerCase();
  if (c.includes("bond") || c.includes("fixed") || c.includes("債")) return "fixed_income";
  if (c.includes("commodity") || c.includes("gold") || c.includes("商品")) return "commodity";
  if (c.includes("real_estate") || c.includes("reit") || c.includes("不動產")) return "real_estate";
  const t = ticker.toUpperCase();
  if (["AGG", "BND", "TLT", "IEF", "SHY", "LQD", "HYG", "VBTLX", "DODIX"].includes(t)) {
    return "fixed_income";
  }
  if (["GLD", "PDBC", "IAU", "SLV"].includes(t)) return "commodity";
  if (["VNQ", "IYR"].includes(t)) return "real_estate";
  return "equity";
}

const PORTFOLIO_DESCRIPTIONS: Record<Lang, Record<string, string>> = {
  en: {
    [SPY_ANCHOR_ID]:
      "State Street SPDR single-ticker US large-cap benchmark (SPY). Common starting point for personalized variants.",
    [CURRENT_HOLDINGS_ANCHOR_ID]:
      "Use the selected client holdings as the baseline — do not tie this run to a house model portfolio. Suitable for satellite / stock sleeves customized on their own.",
    "classic-60-40":
      "60/40 balanced core: S&P 500 ETF + flagship equity mutual fund, aggregate bond ETF + bond fund, with blue-chip stock satellites (JPM, JNJ).",
    "bogleheads-three-fund-80-20":
      "Classic three-fund equity/bond mix enriched with a total-market mutual fund and mega-cap stock satellites (AAPL, MSFT).",
    "global-equity-market-cap":
      "Global equity theme: US/international ETF cores, Fidelity ZERO international fund, and a small basket of global-facing mega-caps.",
    "us-multi-cap-equity":
      "US large-cap core with SPY/sector ETFs, Fidelity 500 Index fund, and mega-cap tech stock satellites for thematic customization.",
    "us-sector-growth-tilt":
      "Nasdaq-100 / growth tilt: QQQ core, Fidelity Growth Company fund, AI mega-caps, and a small commodity diversifier.",
    "all-weather-simplified":
      "Defensive multi-asset book: equity ETF + quality mutual fund, Treasury/aggregate bonds + bond fund, gold ETF, and a dividend aristocrat stock sleeve.",
    "vanguard-equity-tilt-80-20":
      "Simple 80/20 equity-tilt sleeve using Vanguard ETF + mutual fund cores, with a Berkshire stock satellite.",
  },
  zh: {
    [SPY_ANCHOR_ID]:
      "State Street SPDR 單一標的美股大型股基準（SPY），常用於客製化變體的起點。",
    [CURRENT_HOLDINGS_ANCHOR_ID]:
      "以本次勾選的客戶現況持倉為基準，不掛靠任一自家模型組合。適合只優化個股／衛星部位時使用。",
    "classic-60-40":
      "約 60/40 平衡核心：標普 500 ETF＋旗艦股票基金、綜合債 ETF＋債券基金，並配置藍籌個股衛星（JPM、JNJ）。",
    "bogleheads-three-fund-80-20":
      "經典三基金股債架構，搭配全市場共同基金與大型科技個股衛星（AAPL、MSFT），便於客戶溝通。",
    "global-equity-market-cap":
      "全球股票主題：美股／國際 ETF 核心、Fidelity ZERO 國際基金，以及少量全球導向大型股。",
    "us-multi-cap-equity":
      "美國大型股核心：SPY／產業 ETF、Fidelity 500 Index 基金，以及大型科技個股衛星，便於主題客製化。",
    "us-sector-growth-tilt":
      "Nasdaq-100／成長傾斜：QQQ 核心、Fidelity 成長基金、AI 大型股，並搭配小幅商品分散。",
    "all-weather-simplified":
      "防禦型多元資產：股票 ETF＋優質共同基金、公債／綜合債＋債券基金、黃金 ETF，以及股息貴族個股。",
    "vanguard-equity-tilt-80-20":
      "簡潔 80/20 股票傾斜：Vanguard ETF＋共同基金核心，搭配 Berkshire 個股衛星。",
  },
  ko: {
    [SPY_ANCHOR_ID]:
      "State Street SPDR 미국 대형주 단일 벤치마크(SPY). 맞춤 변형의 출발점.",
    [CURRENT_HOLDINGS_ANCHOR_ID]:
      "선택한 고객 보유를 기준으로 하며 하우스 모델에 묶지 않습니다. 개별주/위성 구간만 최적화할 때 적합합니다.",
    "classic-60-40":
      "약 60/40 균형 코어: S&P 500 ETF + 대표 주식 펀드, 종합채권 ETF + 채권 펀드, 블루칩 개별주 위성(JPM, JNJ).",
    "bogleheads-three-fund-80-20":
      "클래식 3-펀드 주식/채권 구조에 전시장 뮤추얼펀드와 메가캡 개별주 위성(AAPL, MSFT)을 더함.",
    "global-equity-market-cap":
      "글로벌 주식 테마: 미국/국제 ETF 코어, Fidelity ZERO 국제 펀드, 소규모 글로벌 메가캡.",
    "us-multi-cap-equity":
      "미국 대형주 코어: SPY/섹터 ETF, Fidelity 500 Index 펀드, 메가캡 테크 개별주 위성.",
    "us-sector-growth-tilt":
      "Nasdaq-100/성장 틸트: QQQ 코어, Fidelity 성장 펀드, AI 메가캡, 소규모 원자재 분산.",
    "all-weather-simplified":
      "방어형 멀티에셋: 주식 ETF + 퀄리티 뮤추얼펀드, 국채/종합채권 + 채권 펀드, 금 ETF, 배당 귀족 개별주.",
    "vanguard-equity-tilt-80-20":
      "단순한 80/20 주식 틸트: Vanguard ETF + 뮤추얼펀드 코어, Berkshire 개별주 위성.",
  },
};

export function getPortfolioDescription(portfolio: ModelPortfolio, lang: Lang): string {
  return PORTFOLIO_DESCRIPTIONS[lang][portfolio.id] ?? portfolio.description;
}

export function getCustomizedVsAnchorLabel(
  anchor: ModelPortfolio,
  lang: Lang,
): string {
  const anchorLabel = getPortfolioLabel(anchor, lang);
  if (lang === "zh") return `客製化配置 vs ${anchorLabel}`;
  if (lang === "ko") return `맞춤 구성 vs ${anchorLabel}`;
  return `Customized vs ${anchorLabel}`;
}

function mixToAssetClasses(mix: Record<string, number>): AssetClass[] {
  const classes: AssetClass[] = [];
  if ((mix.equity ?? 0) > 0) classes.push("equity");
  if ((mix.fixed_income ?? mix.bond ?? 0) > 0) classes.push("bond");
  if ((mix.commodity ?? mix.gold ?? 0) > 0) classes.push("commodity");
  if ((mix.real_estate ?? 0) > 0) classes.push("real_estate");
  if ((mix.alternative ?? 0) > 0) classes.push("alternative");
  return classes.length ? classes : ["equity"];
}

function mixToSleeveControls(
  mix: Record<string, number>,
): Record<string, ParamControl> {
  const keyMap: Record<string, string> = {
    equity: "w_equity",
    fixed_income: "w_bond",
    bond: "w_bond",
    commodity: "w_commodity",
    gold: "w_commodity",
    real_estate: "w_real_estate",
    alternative: "w_alternative",
  };
  const out: Record<string, ParamControl> = {};
  for (const [mixKey, paramKey] of Object.entries(keyMap)) {
    const val = mix[mixKey];
    if (val != null && val > 0) {
      out[paramKey] = { mode: "fixed", fixed: val, min: 0, max: 1 };
    }
  }
  return out;
}

/**
 * Build a base (anchor) BacktestRequest from a model portfolio.
 * Universe is locked to the model holdings (static replay + whitelist).
 */
export function buildAnchorBacktestRequest(
  portfolio: ModelPortfolio,
  defaults: BacktestRequest,
): BacktestRequest {
  const holdingTickers = portfolio.holdings.map((h) => h.ticker.toUpperCase());
  const staticHoldings: Record<string, number> = {};
  for (const h of portfolio.holdings) {
    staticHoldings[h.ticker.toUpperCase()] = h.weight;
  }
  const assetClasses = mixToAssetClasses(portfolio.asset_class_mix);
  const sleeveControls = mixToSleeveControls(portfolio.asset_class_mix);

  return {
    ...defaults,
    scenario_id: `anchor-${portfolio.id}`,
    benchmark_ticker: portfolio.benchmark,
    asset_classes: assetClasses,
    universe_tickers: holdingTickers,
    // Same list as whitelist so customized/API paths can pin holdings without
    // opening the full asset-class fund pool.
    universe_supplement_tickers: holdingTickers,
    max_holdings: holdingTickers.length,
    trials: 5,
    top_models: 1,
    optimization_mode: "standard",
    regime_adaptive: false,
    enable_iterative_refinement: false,
    static_replay_holdings: staticHoldings,
    anchor_weights: staticHoldings,
    customization_drift: defaults.customization_drift ?? 0.5,
    param_controls: {
      ...(defaults.param_controls ?? {}),
      ...sleeveControls,
      max_holdings_actual: { mode: "fixed", fixed: holdingTickers.length },
    },
    enforce_class_weights: Object.keys(sleeveControls).length > 0,
  };
}

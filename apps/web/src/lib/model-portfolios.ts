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
  /** Stable publisher AM id (e.g. amundi-demo). */
  am_id: string;
  /** Display name of the Asset Manager publisher. */
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

const file = modelPortfoliosFile as ModelPortfoliosFile;

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

/** Mainstream ETF building blocks for JASPER demo (not full 346-ticker universe). */
export const MAINSTREAM_DEMO_TICKERS = [
  "SPY",
  "QQQ",
  "IWM",
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
] as const;

export const SPY_ANCHOR_ID = "spy-benchmark";

export const SPY_ANCHOR: ModelPortfolio = {
  id: SPY_ANCHOR_ID,
  am_id: "state-street-demo",
  asset_manager: "State Street Demo",
  theme: "S&P 500 Benchmark",
  name: "S&P 500 Benchmark",
  description:
    "State Street Demo single-ticker US large-cap benchmark (SPY). Common anchor for personalized ETF variants.",
  source: {
    name: "Demo AM catalog — State Street Demo S&P 500 Benchmark",
    url: "https://www.ssga.com/us/en/individual/etfs/funds/spdr-sp-500-etf-trust-spy",
  },
  asset_class_mix: { equity: 1 },
  holdings: [
    { ticker: "SPY", weight: 1, name: "SPDR S&P 500 ETF Trust" },
  ],
  benchmark: "SPY",
  risk_level: "moderate",
};

const ASSET_MANAGER_LABELS: Record<Lang, Record<string, string>> = {
  en: {
    [SPY_ANCHOR_ID]: "State Street Demo",
    "classic-60-40": "Amundi",
    "bogleheads-three-fund-80-20": "Vanguard-style Demo",
    "global-equity-market-cap": "Julia Demo AM",
    "us-multi-cap-equity": "Julius Baer Model",
    "us-sector-growth-tilt": "BlackRock",
    "all-weather-simplified": "Pictet",
  },
  zh: {
    [SPY_ANCHOR_ID]: "State Street Demo",
    "classic-60-40": "Amundi",
    "bogleheads-three-fund-80-20": "Vanguard-style Demo",
    "global-equity-market-cap": "Julia Demo AM",
    "us-multi-cap-equity": "Julius Baer Model",
    "us-sector-growth-tilt": "BlackRock",
    "all-weather-simplified": "Pictet",
  },
  ko: {
    [SPY_ANCHOR_ID]: "State Street Demo",
    "classic-60-40": "Amundi",
    "bogleheads-three-fund-80-20": "Vanguard-style Demo",
    "global-equity-market-cap": "Julia Demo AM",
    "us-multi-cap-equity": "Julius Baer Model",
    "us-sector-growth-tilt": "BlackRock",
    "all-weather-simplified": "Pictet",
  },
};

/** Theme / product title (card title). */
const PORTFOLIO_LABELS: Record<Lang, Record<string, string>> = {
  en: {
    [SPY_ANCHOR_ID]: "S&P 500 Benchmark",
    "classic-60-40": "Balanced 60/40",
    "bogleheads-three-fund-80-20": "Three-Fund",
    "global-equity-market-cap": "Global Market-Cap Equity",
    "us-multi-cap-equity": "Growth Multi-Cap",
    "us-sector-growth-tilt": "US Equity Core",
    "all-weather-simplified": "All Weather Defensive",
  },
  zh: {
    [SPY_ANCHOR_ID]: "標普 500 基準",
    "classic-60-40": "平衡 60/40",
    "bogleheads-three-fund-80-20": "三基金組合",
    "global-equity-market-cap": "全球市值加權股票",
    "us-multi-cap-equity": "成長多市值",
    "us-sector-growth-tilt": "美國股票核心",
    "all-weather-simplified": "全天候防禦",
  },
  ko: {
    [SPY_ANCHOR_ID]: "S&P 500 벤치마크",
    "classic-60-40": "균형 60/40",
    "bogleheads-three-fund-80-20": "3-펀드",
    "global-equity-market-cap": "글로벌 시가총액 주식",
    "us-multi-cap-equity": "성장 멀티캡",
    "us-sector-growth-tilt": "미국 주식 코어",
    "all-weather-simplified": "올웨더 방어형",
  },
};

export function getAssetManagerLabel(
  portfolio: ModelPortfolio,
  lang: Lang,
): string {
  return (
    ASSET_MANAGER_LABELS[lang][portfolio.id] ??
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
  return getModelPortfolioById(id);
}

const PORTFOLIO_DESCRIPTIONS: Record<Lang, Record<string, string>> = {
  en: {},
  zh: {
    [SPY_ANCHOR_ID]:
      "State Street Demo 單一標的美股大型股基準（SPY），常用於客製化變體的起點。",
    "classic-60-40":
      "Amundi 風格平衡配置：60% 股票成長＋40% 投資級債券。成分以主流 ETF 示意。",
    "bogleheads-three-fund-80-20":
      "Vanguard-style Demo 三基金主題：美股、國際股與債券，約 80/20 股債比（非官方產品）。",
    "global-equity-market-cap":
      "Julia Demo AM 全球市值加權主題（約 60% 美股／40% 國際），示意未來可掛入標的池的財富產品。",
    "us-multi-cap-equity":
      "Julius Baer Model 成長多市值示意：美股大型、成長科技與小型股袖口。",
    "us-sector-growth-tilt":
      "BlackRock 風格美國股票核心，成長傾斜並含醫療與金融產業袖口。",
    "all-weather-simplified":
      "Pictet 風格全天候防禦：股、債、黃金與大宗商品風險平衡。",
  },
  ko: {
    [SPY_ANCHOR_ID]:
      "State Street Demo 미국 대형주 단일 벤치마크(SPY). 맞춤 변형의 출발점.",
    "classic-60-40":
      "Amundi 스타일 균형: 주식 60% + 투자등급 채권 40%. 구성은 주요 ETF로 예시.",
    "bogleheads-three-fund-80-20":
      "Vanguard-style Demo 3-펀드 테마: 미국·국제 주식과 채권 80/20 (공식 상품 아님).",
    "global-equity-market-cap":
      "Julia Demo AM 글로벌 시가총액 테마(미국 ~60% / 국제 ~40%). 향후 Investment Pool 매핑용 예시.",
    "us-multi-cap-equity":
      "Julius Baer Model 성장 멀티캡: 미국 대형·성장·소형 슬리브.",
    "us-sector-growth-tilt":
      "BlackRock 스타일 미국 주식 코어 + 성장 틸트, 헬스케어·금융 섹터.",
    "all-weather-simplified":
      "Pictet 스타일 올웨더 방어형: 주식·채권·금·원자재 리스크 균형.",
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
 * Universe is limited to mainstream demo ETFs plus anchor holdings.
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
    universe_supplement_tickers: holdingTickers,
    max_holdings: holdingTickers.length,
    trials: 5,
    top_models: 1,
    optimization_mode: "standard",
    regime_adaptive: false,
    enable_iterative_refinement: false,
    static_replay_holdings: staticHoldings,
    param_controls: {
      ...(defaults.param_controls ?? {}),
      ...sleeveControls,
    },
    enforce_class_weights: Object.keys(sleeveControls).length > 0,
  };
}

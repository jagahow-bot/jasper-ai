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
  name: "S&P 500 (SPY)",
  description:
    "Single-ticker US large-cap benchmark. Common anchor for personalized ETF variants.",
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

const PORTFOLIO_LABELS: Record<Lang, Record<string, string>> = {
  en: {
    [SPY_ANCHOR_ID]: "S&P 500 (SPY)",
    "classic-60-40": "Classic 60/40 Balanced",
    "bogleheads-three-fund-80-20": "Bogleheads Three-Fund (80/20)",
    "global-equity-market-cap": "Global Equity (Market-Cap)",
    "us-multi-cap-equity": "US Multi-Cap Equity",
    "us-sector-growth-tilt": "US Large Cap + Growth Tilt",
    "all-weather-simplified": "All Weather (Simplified)",
  },
  zh: {
    [SPY_ANCHOR_ID]: "標普 500",
    "classic-60-40": "經典 60/40 平衡",
    "bogleheads-three-fund-80-20": "三基金組合（80/20）",
    "global-equity-market-cap": "全球股票（市值加權）",
    "us-multi-cap-equity": "美國多市值股票",
    "us-sector-growth-tilt": "美國大型股＋成長傾斜",
    "all-weather-simplified": "全天候（簡化版）",
  },
  ko: {
    [SPY_ANCHOR_ID]: "S&P 500",
    "classic-60-40": "클래식 60/40 균형",
    "bogleheads-three-fund-80-20": "보글헤즈 3-펀드 (80/20)",
    "global-equity-market-cap": "글로벌 주식 (시가총액)",
    "us-multi-cap-equity": "미국 멀티캡 주식",
    "us-sector-growth-tilt": "미국 대형주 + 성장",
    "all-weather-simplified": "올웨더 (간소화)",
  },
};

export function getPortfolioLabel(portfolio: ModelPortfolio, lang: Lang): string {
  return PORTFOLIO_LABELS[lang][portfolio.id] ?? portfolio.name;
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
    [SPY_ANCHOR_ID]: "美國大型股單一標的基準，常用於客製化 ETF 變體的起點。",
    "classic-60-40": "60% 標普 500（SPY）＋ 40% 投資級債券（AGG），機構常用的平衡基準。",
    "bogleheads-three-fund-80-20": "被動三基金：美國股票、國際股票與美國債券，80/20 股債比。",
    "global-equity-market-cap": "全球股票配置，約 60% 美國、40% 國際，依市值加權。",
    "us-multi-cap-equity": "美國大型（SPY）、成長科技（QQQ）與小型股（IWM）的全市值覆蓋。",
    "us-sector-growth-tilt": "標普核心搭配那斯達克成長與醫療、金融產業傾斜。",
    "all-weather-simplified": "股、債、黃金與大宗商品風險平衡，適應不同總經環境。",
  },
  ko: {
    [SPY_ANCHOR_ID]: "미국 대형주 단일 벤치마크. 맞춤 ETF 변형의 출발점.",
    "classic-60-40": "SPY 60% + AGG 40%. 기관에서 흔히 쓰는 균형 벤치마크.",
    "bogleheads-three-fund-80-20": "미국·국제 주식과 미국 채권의 패시브 3-펀드 80/20.",
    "global-equity-market-cap": "미국 약 60%, 국제 약 40%의 시가총액 가중 글로벌 주식.",
    "us-multi-cap-equity": "SPY·QQQ·IWM으로 미국 대형·성장·소형을 포괄.",
    "us-sector-growth-tilt": "S&P 코어 + 나스닥 성장 + 헬스케어·금융 섹터.",
    "all-weather-simplified": "주식·채권·금·원자재 리스크 균형 배분.",
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

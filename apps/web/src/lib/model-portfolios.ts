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

/** Mainstream ETF building blocks for JASPER demo (not full 346-ticker universe). */
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
] as const;

export const SPY_ANCHOR_ID = "spy-benchmark";

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

const ASSET_MANAGER_LABELS: Record<Lang, Record<string, string>> = {
  en: {
    [SPY_ANCHOR_ID]: "State Street SPDR",
    "classic-60-40": "BlackRock iShares",
    "bogleheads-three-fund-80-20": "Vanguard",
    "global-equity-market-cap": "Vanguard",
    "us-multi-cap-equity": "State Street SPDR",
    "us-sector-growth-tilt": "Invesco",
    "all-weather-simplified": "BlackRock iShares",
    "vanguard-equity-tilt-80-20": "Vanguard",
  },
  zh: {
    [SPY_ANCHOR_ID]: "State Street SPDR",
    "classic-60-40": "BlackRock iShares",
    "bogleheads-three-fund-80-20": "Vanguard",
    "global-equity-market-cap": "Vanguard",
    "us-multi-cap-equity": "State Street SPDR",
    "us-sector-growth-tilt": "Invesco",
    "all-weather-simplified": "BlackRock iShares",
    "vanguard-equity-tilt-80-20": "Vanguard",
  },
  ko: {
    [SPY_ANCHOR_ID]: "State Street SPDR",
    "classic-60-40": "BlackRock iShares",
    "bogleheads-three-fund-80-20": "Vanguard",
    "global-equity-market-cap": "Vanguard",
    "us-multi-cap-equity": "State Street SPDR",
    "us-sector-growth-tilt": "Invesco",
    "all-weather-simplified": "BlackRock iShares",
    "vanguard-equity-tilt-80-20": "Vanguard",
  },
};

/** Theme / product title (card title). */
const PORTFOLIO_LABELS: Record<Lang, Record<string, string>> = {
  en: {
    [SPY_ANCHOR_ID]: "S&P 500 Benchmark",
    "classic-60-40": "Balanced Core",
    "bogleheads-three-fund-80-20": "Three-Fund",
    "global-equity-market-cap": "Global Equity",
    "us-multi-cap-equity": "US Large Cap Core",
    "us-sector-growth-tilt": "Tech Growth",
    "all-weather-simplified": "All Weather Defensive",
    "vanguard-equity-tilt-80-20": "Equity Tilt 80/20",
  },
  zh: {
    [SPY_ANCHOR_ID]: "標普 500 基準",
    "classic-60-40": "平衡核心",
    "bogleheads-three-fund-80-20": "三基金組合",
    "global-equity-market-cap": "全球股票",
    "us-multi-cap-equity": "美國大型股核心",
    "us-sector-growth-tilt": "科技成長",
    "all-weather-simplified": "全天候防禦",
    "vanguard-equity-tilt-80-20": "股票傾斜 80/20",
  },
  ko: {
    [SPY_ANCHOR_ID]: "S&P 500 벤치마크",
    "classic-60-40": "균형 코어",
    "bogleheads-three-fund-80-20": "3-펀드",
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
      "State Street SPDR 單一標的美股大型股基準（SPY），常用於客製化變體的起點。",
    "classic-60-40":
      "BlackRock iShares 平衡核心：60% 美股大型（IVV）＋40% 美國綜合債（AGG）。成分均為該發行機構 ETF。",
    "bogleheads-three-fund-80-20":
      "Vanguard 三基金：全美股市、國際股與美國債，約 80/20 股債比。成分均為該發行機構 ETF。",
    "global-equity-market-cap":
      "Vanguard 全球股票主題（約 60% 美股／40% 國際），僅用 VTI 與 VXUS。成分均為該發行機構 ETF。",
    "us-multi-cap-equity":
      "State Street SPDR 美國大型股核心：SPY 加上醫療與金融產業 Select Sector。成分均為該發行機構 ETF。",
    "us-sector-growth-tilt":
      "Invesco 科技成長：QQQ 為主，搭配小幅商品衛星（PDBC）。成分均為該發行機構 ETF。",
    "all-weather-simplified":
      "BlackRock iShares 全天候防禦：大型股股票＋長中短期公債。成分均為該發行機構 ETF。",
    "vanguard-equity-tilt-80-20":
      "Vanguard 股票傾斜 80/20：VTI 80%＋BND 20%。成分均為該發行機構 ETF。",
  },
  ko: {
    [SPY_ANCHOR_ID]:
      "State Street SPDR 미국 대형주 단일 벤치마크(SPY). 맞춤 변형의 출발점.",
    "classic-60-40":
      "BlackRock iShares 균형 코어: 미국 대형주(IVV) 60% + 종합채권(AGG) 40%. 구성은 모두 해당 운용사 ETF.",
    "bogleheads-three-fund-80-20":
      "Vanguard 3-펀드: 미국·국제 주식과 채권 80/20. 구성은 모두 해당 운용사 ETF.",
    "global-equity-market-cap":
      "Vanguard 글로벌 주식(미국 ~60% / 국제 ~40%), VTI·VXUS만 사용. 구성은 모두 해당 운용사 ETF.",
    "us-multi-cap-equity":
      "State Street SPDR 미국 대형주 코어: SPY + 헬스케어·금융 섹터. 구성은 모두 해당 운용사 ETF.",
    "us-sector-growth-tilt":
      "Invesco 테크 성장: QQQ 중심 + 소규모 원자재(PDBC). 구성은 모두 해당 운용사 ETF.",
    "all-weather-simplified":
      "BlackRock iShares 올웨더 방어형: 대형주 + 장·중·단기 국채. 구성은 모두 해당 운용사 ETF.",
    "vanguard-equity-tilt-80-20":
      "Vanguard 주식 틸트 80/20: VTI 80% + BND 20%. 구성은 모두 해당 운용사 ETF.",
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
    param_controls: {
      ...(defaults.param_controls ?? {}),
      ...sleeveControls,
      max_holdings_actual: { mode: "fixed", fixed: holdingTickers.length },
    },
    enforce_class_weights: Object.keys(sleeveControls).length > 0,
  };
}

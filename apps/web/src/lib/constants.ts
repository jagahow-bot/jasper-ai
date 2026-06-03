export const ASSET_CLASSES = [
  "equity",
  "bond",
  "commodity",
  "real_estate",
  "alternative",
] as const;

export type AssetClass = (typeof ASSET_CLASSES)[number];

export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  equity: "Equity",
  bond: "Bond",
  commodity: "Commodity",
  real_estate: "REIT",
  alternative: "Alt",
};

export const DEFAULT_ASSET_CLASSES: AssetClass[] = [...ASSET_CLASSES];

/** Sub-asset / regional sleeve keys (Optuna + quota display). */
export const SUB_ASSET_CLASS_KEYS = [
  "equity:us",
  "equity:intl",
  "equity:em",
  "bond:us",
  "bond:intl",
  "bond:credit",
  "commodity:precious",
  "commodity:broad",
  "real_estate:us",
  "real_estate:intl",
] as const;

export type SubAssetClassKey = (typeof SUB_ASSET_CLASS_KEYS)[number];

export const SUB_ASSET_CLASS_LABELS: Record<SubAssetClassKey, string> = {
  "equity:us": "US equity",
  "equity:intl": "Intl developed equity",
  "equity:em": "EM equity",
  "bond:us": "US Treasuries / agg",
  "bond:intl": "Intl / EM bonds",
  "bond:credit": "US credit (IG/HY)",
  "commodity:precious": "Precious metals",
  "commodity:broad": "Broad commodities",
  "real_estate:us": "US REIT",
  "real_estate:intl": "Intl REIT",
};

export const SUB_ASSET_PARAM_KEYS: Record<SubAssetClassKey, string> = {
  "equity:us": "w_equity_us",
  "equity:intl": "w_equity_intl",
  "equity:em": "w_equity_em",
  "bond:us": "w_bond_us",
  "bond:intl": "w_bond_intl",
  "bond:credit": "w_bond_credit",
  "commodity:precious": "w_commodity_precious",
  "commodity:broad": "w_commodity_broad",
  "real_estate:us": "w_reit_us",
  "real_estate:intl": "w_reit_intl",
};

/** Universe `category` field labels for filters / tooltips. */
export const CATEGORY_LABELS: Record<string, string> = {
  us_broad: "US broad market",
  us_growth: "US growth / Nasdaq",
  us_size: "US cap size",
  us_factor: "US factors / dividends",
  us_sector: "US sectors",
  us_industry: "US industries",
  us_thematic: "US thematic",
  us_esg: "US ESG",
  intl_developed: "Developed ex-US",
  intl_country: "Single country",
  intl_em: "Emerging markets",
  intl_frontier: "Frontier markets",
  intl_broad: "Intl broad",
  intl_thematic: "Intl thematic",
  global_broad: "Global equity",
  treasury: "US Treasuries",
  bond_floating: "Floating rate",
  bond_mbs: "Mortgage-backed",
  credit_ig: "Investment-grade credit",
  credit_hy: "High yield",
  muni: "Municipal",
  inflation: "TIPS / inflation",
  aggregate: "US aggregate bond",
  intl_bond: "Intl sovereign",
  em_bond: "EM debt",
  precious: "Precious metals",
  energy: "Energy commodities",
  industrial: "Industrial metals",
  broad: "Broad commodities",
  commodity_agriculture: "Agriculture",
  reit: "REIT",
  reit_mortgage: "Mortgage REIT",
  reit_sector: "REIT sector",
  preferred: "Preferreds",
  credit_alt: "Private / bank loans",
  income: "Income / MLP",
  multi_alt: "Multi-strategy alt",
  alt_managed_futures: "Managed futures",
  alt_hedge: "Hedge / anti-beta",
};

export const OBJECTIVE_LABELS: Record<string, string> = {
  dynamic: "Dynamic (regime-based)",
  max_sharpe: "Max Sharpe",
  max_return: "Max CAGR",
  min_max_drawdown: "Min Max DD",
  max_sortino: "Max Sortino",
  min_cvar: "Min CVaR",
  risk_parity_erc: "Risk Parity (ERC)",
  max_diversification: "Max Diversification",
  mean_variance_utility: "Mean-Variance Utility",
  custom: "Custom objective",
};

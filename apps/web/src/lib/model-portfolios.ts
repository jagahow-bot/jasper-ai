import modelPortfoliosFile from "@/data/model-portfolios.json";

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

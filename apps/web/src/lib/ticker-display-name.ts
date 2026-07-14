import { getUniverseItems } from "@/lib/universe";
import { getAnchorPortfolios } from "@/lib/model-portfolios";
import { readInvestmentPool } from "@/lib/investment-pool";

/** Resolve ETF / product display name from universe, pool, then model portfolios. */
export function resolveTickerDisplayName(ticker: string): string {
  const upper = ticker.trim().toUpperCase();
  if (!upper) return ticker;

  for (const item of getUniverseItems()) {
    if (item.ticker.toUpperCase() === upper && item.name?.trim()) {
      return item.name.trim();
    }
  }

  if (typeof window !== "undefined") {
    try {
      for (const item of readInvestmentPool()) {
        if (item.ticker.toUpperCase() === upper && item.name?.trim()) {
          return item.name.trim();
        }
      }
    } catch {
      /* ignore localStorage errors */
    }
  }

  for (const p of getAnchorPortfolios()) {
    for (const h of p.holdings) {
      if (h.ticker.toUpperCase() === upper && h.name?.trim()) {
        return h.name.trim();
      }
    }
  }

  return upper;
}

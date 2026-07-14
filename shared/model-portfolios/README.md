# JASPER Demo AM Model Portfolios

Demo **Asset Manager (AM)** model portfolios for JASPER Benchmark Personalization. Each entry mimics a themed wealth product published by an AM; holdings use **mainstream ETFs as placeholders**. Later AMs can list their own products mapped into the Investment Pool.

## Files

| Path | Purpose |
|------|---------|
| `shared/model-portfolios/model-portfolios.json` | Canonical source |
| `apps/web/src/data/model-portfolios.json` | Web bundle (run `npm run sync-model-portfolios`) |

## Schema

Each portfolio entry includes:

- `id` — stable id (keep for `suggested_model_portfolio_id`)
- `am_id`, `asset_manager` — publisher AM (demo brands / clearly labeled)
- `theme` / `name` — product or theme title shown in Anchor cards
- `description` — short AM theme copy
- `source` — `{ name, url }` for demo credibility
- `asset_class_mix` — high-level weights by asset class
- `holdings` — `[{ ticker, weight, name }]` (ETF placeholders)
- `benchmark` — default benchmark ticker for backtests (unchanged for engine)
- `risk_level` — `moderate_conservative` \| `moderate` \| `moderate_aggressive` \| `aggressive`

## Included portfolios (6 + SPY anchor in UI)

| ID | Asset Manager | Theme | Key tickers | Equity % |
|----|---------------|-------|-------------|----------|
| `classic-60-40` | Amundi | Balanced 60/40 | SPY, AGG | 60% |
| `bogleheads-three-fund-80-20` | Vanguard-style Demo | Three-Fund | SPY, VXUS, BND | 80% |
| `global-equity-market-cap` | Julia Demo AM | Global Market-Cap Equity | SPY, VXUS | 100% |
| `us-multi-cap-equity` | Julius Baer Model | Growth Multi-Cap | SPY, QQQ, IWM | 100% |
| `us-sector-growth-tilt` | BlackRock | US Equity Core | SPY, QQQ, XLV, XLF | 100% |
| `all-weather-simplified` | Pictet | All Weather Defensive | SPY, TLT, IEF, GLD, PDBC | 30% |

Plus UI-only `spy-benchmark` (State Street Demo · S&P 500 Benchmark).

All tickers are US-listed ETFs available on yfinance and present in `shared/etf-universe.json`.

## Price data

Download OHLCV for portfolio tickers (and optionally the full ETF universe):

```bash
cd apps/api
.venv\Scripts\python.exe ..\..\scripts\download_universe_prices.py

# Portfolio tickers only (default)
.venv\Scripts\python.exe ..\..\scripts\download_universe_prices.py --scope portfolios

# Full ETF universe (~328 tickers)
.venv\Scripts\python.exe ..\..\scripts\download_universe_prices.py --scope universe

# Both
.venv\Scripts\python.exe ..\..\scripts\download_universe_prices.py --scope all
```

Output: `data/prices/closes.parquet` (wide adjusted close panel) and `data/prices/ohlcv/{TICKER}.parquet` per symbol.

## UI integration

Import from `@/lib/model-portfolios` for the **Anchor portfolio** selector (`AnchorPortfolioSelector`) in Benchmark Personalization. Admin list: `/models`.

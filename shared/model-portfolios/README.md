# JASPER Demo Model Portfolios

Publicly documented ETF model portfolios for JASPER demos, proposal credibility, and future **Base portfolio → Overlay** backtest flows.

## Files

| Path | Purpose |
|------|---------|
| `shared/model-portfolios/model-portfolios.json` | Canonical source |
| `apps/web/src/data/model-portfolios.json` | Web bundle (run `npm run sync-model-portfolios`) |

## Schema

Each portfolio entry includes:

- `id`, `name`, `description`
- `source` — `{ name, url }` for demo credibility
- `asset_class_mix` — high-level weights by asset class
- `holdings` — `[{ ticker, weight, name }]`
- `benchmark` — default benchmark ticker for backtests
- `risk_level` — `moderate_conservative` \| `moderate` \| `moderate_aggressive` \| `aggressive`

## Included portfolios (6)

| ID | Focus | Equity % | Source |
|----|-------|----------|--------|
| `classic-60-40` | Balanced stocks/bonds | 60% | [Lazy Portfolio ETF](https://www.lazyportfolioetf.com/allocation/stocks-bonds-60-40/) |
| `bogleheads-three-fund-80-20` | Passive three-fund | 80% | [Bogleheads Wiki](https://www.bogleheads.org/wiki/Three-fund_portfolio) |
| `global-equity-market-cap` | All-equity global | 100% | [Elm Wealth](https://elmwealth.com/vt-vs-vti-vxus/) |
| `us-factor-tilt-equity` | Factor premiums | 100% | [FactorIQ](https://factoriq.dev/blog/multi-factor-investing-portfolio) |
| `us-sector-growth-tilt` | US large cap + sectors | 100% | [Freenance](https://freenance.io/strategies/60-40-portfolio-guide/) |
| `all-weather-simplified` | Risk-balanced multi-asset | 30% | [ETF Central](https://www.etfcentral.com/news/the-ray-dalio-all-weather-etf-portfolio) |

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

## UI integration (future)

Import from `@/lib/model-portfolios` for a **Base portfolio** selector in the overlay flow. Not yet wired into the main scenario form.

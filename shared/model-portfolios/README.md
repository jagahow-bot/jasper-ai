# JASPER Wealth Model Portfolios

House model portfolios for JASPER Benchmark Personalization. Each model mixes **ETF cores**, **mutual-fund sleeves**, and/or **single-stock satellites** — reflecting private-banking books, not ETF-only AM wrappers.

## Files

| Path | Purpose |
|------|---------|
| `shared/model-portfolios/model-portfolios.json` | Canonical source |
| `apps/web/src/data/model-portfolios.json` | Web bundle (run `npm run sync-model-portfolios`) |

## Schema

Each portfolio entry includes:

- `id` — stable id (keep for `suggested_model_portfolio_id`)
- `am_id`, `asset_manager` — house / model family label (v3+: `jasper-house`)
- `theme` / `name` — investment theme shown as the card title
- `description` — short product copy
- `source` — `{ name, url }`
- `asset_class_mix` — high-level weights by asset class
- `holdings` — `[{ ticker, weight, name }]` (ETF / stock / fund in the Investment Pool)
- `benchmark` — default benchmark ticker
- `risk_level` — `moderate_conservative` \| `moderate` \| `moderate_aggressive` \| `aggressive`

## Included portfolios (7 + SPY anchor in UI)

| ID | Theme | Mix highlights | Equity % |
|----|-------|----------------|----------|
| `classic-60-40` | Balanced Core | IVV · VFIAX · JPM · JNJ · AGG · VBTLX | 60% |
| `bogleheads-three-fund-80-20` | Three-Fund Plus | VTI · VTSAX · VXUS · AAPL · MSFT · BND · VBTLX | 80% |
| `global-equity-market-cap` | Global Equity | VTI · VXUS · FZILX · GOOGL · AVGO · AMD | 100% |
| `us-multi-cap-equity` | US Large Cap Core | SPY · FXAIX · XLV · XLF · NVDA · AAPL · MSFT | 100% |
| `us-sector-growth-tilt` | Tech Growth | QQQ · FDGRX · NVDA · META · AMZN · AVGO · PDBC | 90% |
| `all-weather-simplified` | All Weather Defensive | IVV · VWELX · PG · TLT · AGG · DODIX · SHY · GLD | 30% |
| `vanguard-equity-tilt-80-20` | Equity Tilt 80/20 | VTI · VTSAX · BRK-B · BND · VBTLX | 80% |

Plus UI-only `spy-benchmark` (State Street SPDR · S&P 500 Benchmark).

All tickers must exist in `shared/etf-universe.json` (ETF + stock + fund catalog).

## Price data

```bash
cd apps/api
.venv\Scripts\python.exe ..\..\scripts\download_universe_prices.py --scope portfolios
```

## UI integration

Import from `@/lib/model-portfolios` for the **Anchor portfolio** selector in Benchmark Personalization. Admin list: `/models`.

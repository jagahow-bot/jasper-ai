# JASPER AM Model Portfolios

**Asset Manager (AM)** model portfolios for JASPER Benchmark Personalization. Each entry is a themed product whose holdings are ETFs from **one issuer family only** (BlackRock iShares, Vanguard, State Street SPDR, Invesco), so the UI can truthfully show the AM badge.

## Files

| Path | Purpose |
|------|---------|
| `shared/model-portfolios/model-portfolios.json` | Canonical source |
| `apps/web/src/data/model-portfolios.json` | Web bundle (run `npm run sync-model-portfolios`) |

## Schema

Each portfolio entry includes:

- `id` — stable id (keep for `suggested_model_portfolio_id`)
- `am_id`, `asset_manager` — real issuer family
- `theme` / `name` — investment theme shown as the card title
- `description` — short AM theme copy
- `source` — `{ name, url }`
- `asset_class_mix` — high-level weights by asset class
- `holdings` — `[{ ticker, weight, name }]` (same-AM ETFs only)
- `benchmark` — default benchmark ticker (prefer same AM family)
- `risk_level` — `moderate_conservative` \| `moderate` \| `moderate_aggressive` \| `aggressive`

## Included portfolios (7 + SPY anchor in UI)

| ID | Asset Manager | Theme | Holdings | Equity % |
|----|---------------|-------|----------|----------|
| `classic-60-40` | BlackRock iShares | Balanced Core | IVV 60 · AGG 40 | 60% |
| `bogleheads-three-fund-80-20` | Vanguard | Three-Fund | VTI 60 · VXUS 20 · BND 20 | 80% |
| `global-equity-market-cap` | Vanguard | Global Equity | VTI 60 · VXUS 40 | 100% |
| `us-multi-cap-equity` | State Street SPDR | US Large Cap Core | SPY 70 · XLV 15 · XLF 15 | 100% |
| `us-sector-growth-tilt` | Invesco | Tech Growth | QQQ 85 · PDBC 15 | 85% |
| `all-weather-simplified` | BlackRock iShares | All Weather Defensive | IVV 30 · TLT 40 · IEF 15 · SHY 15 | 30% |
| `vanguard-equity-tilt-80-20` | Vanguard | Equity Tilt 80/20 | VTI 80 · BND 20 | 80% |

Plus UI-only `spy-benchmark` (State Street SPDR · S&P 500 Benchmark).

All tickers are US-listed ETFs in `shared/etf-universe.json` and (for demo backtests) in `shared/demo-tickers.json` / `MAINSTREAM_DEMO_TICKERS`.

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

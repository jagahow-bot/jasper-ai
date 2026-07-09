"""Download OHLCV price history for demo model portfolios and/or ETF universe.

Stores:
  data/prices/closes.parquet     — wide panel of adjusted close prices
  data/prices/ohlcv/{TICKER}.parquet — per-ticker OHLCV
  data/prices/meta.json          — download metadata

Usage (from repo root, with apps/api venv active):
  python scripts/download_universe_prices.py
  python scripts/download_universe_prices.py --scope portfolios --start 2010-01-01
  python scripts/download_universe_prices.py --scope all --start 2010-01-01
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
MODEL_PORTFOLIOS_PATH = ROOT / "shared" / "model-portfolios" / "model-portfolios.json"
UNIVERSE_PATH = ROOT / "shared" / "etf-universe.json"
DEMO_TICKERS_PATH = ROOT / "shared" / "demo-tickers.json"
OUTPUT_DIR = ROOT / "data" / "prices"
BUNDLED_OUTPUT_DIR = ROOT / "apps" / "api" / "data" / "bundled_prices"
OHLCV_DIR = OUTPUT_DIR / "ohlcv"
YFINANCE_CHUNK = 25
DEFAULT_START = "2010-01-01"


def load_portfolio_tickers() -> list[str]:
    data = json.loads(MODEL_PORTFOLIOS_PATH.read_text(encoding="utf-8"))
    tickers: list[str] = []
    for p in data.get("portfolios", []):
        for h in p.get("holdings", []):
            tickers.append(str(h["ticker"]).upper())
        bench = p.get("benchmark")
        if bench:
            tickers.append(str(bench).upper())
    return sorted(dict.fromkeys(tickers))


def load_universe_tickers() -> list[str]:
    data = json.loads(UNIVERSE_PATH.read_text(encoding="utf-8"))
    return sorted(dict.fromkeys(str(u["ticker"]).upper() for u in data["universe"]))


def load_demo_tickers() -> list[str]:
    data = json.loads(DEMO_TICKERS_PATH.read_text(encoding="utf-8"))
    return sorted(dict.fromkeys(str(t).upper() for t in data.get("tickers", [])))


def resolve_tickers(scope: str) -> list[str]:
    if scope == "portfolios":
        return load_portfolio_tickers()
    if scope == "universe":
        return load_universe_tickers()
    if scope == "demo":
        return load_demo_tickers()
    if scope == "all":
        combined = [*load_portfolio_tickers(), *load_universe_tickers()]
        return sorted(dict.fromkeys(combined))
    raise ValueError(f"Unknown scope: {scope}")


def download_ohlcv(tickers: list[str], start: str, end: str) -> dict[str, pd.DataFrame]:
    import yfinance as yf

    by_ticker: dict[str, pd.DataFrame] = {}
    for i in range(0, len(tickers), YFINANCE_CHUNK):
        chunk = tickers[i : i + YFINANCE_CHUNK]
        data = yf.download(
            chunk,
            start=start,
            end=end,
            auto_adjust=True,
            progress=True,
            group_by="column",
            threads=False,
        )
        if data.empty:
            continue

        if isinstance(data.columns, pd.MultiIndex):
            for ticker in chunk:
                if ticker not in data.columns.get_level_values(1):
                    continue
                sub = data.xs(ticker, axis=1, level=1).copy()
                sub.columns = [str(c) for c in sub.columns]
                by_ticker[ticker] = sub
        else:
            ticker = chunk[0]
            frame = data.copy()
            frame.columns = [str(c) for c in frame.columns]
            by_ticker[ticker] = frame

    return by_ticker


def build_close_panel(ohlcv: dict[str, pd.DataFrame]) -> pd.DataFrame:
    closes: dict[str, pd.Series] = {}
    for ticker, frame in ohlcv.items():
        if "Close" not in frame.columns:
            continue
        closes[ticker] = frame["Close"].astype(float)
    if not closes:
        raise SystemExit("No close prices downloaded")
    panel = pd.DataFrame(closes).sort_index()
    panel = panel.replace([np.inf, -np.inf], np.nan)
    return panel


def save_outputs(
    ohlcv: dict[str, pd.DataFrame],
    closes: pd.DataFrame,
    *,
    tickers_requested: list[str],
    start: str,
    end: str,
    scope: str,
) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    OHLCV_DIR.mkdir(parents=True, exist_ok=True)

    for ticker, frame in ohlcv.items():
        out = OHLCV_DIR / f"{ticker}.parquet"
        frame.to_parquet(out)

    closes.to_parquet(OUTPUT_DIR / "closes.parquet")

    meta = {
        "scope": scope,
        "start": start,
        "end": end,
        "tickers_requested": len(tickers_requested),
        "tickers_downloaded": len(ohlcv),
        "missing_tickers": sorted(set(tickers_requested) - set(ohlcv.keys())),
        "close_rows": len(closes),
        "close_columns": len(closes.columns),
        "downloaded_at": date.today().isoformat(),
    }
    (OUTPUT_DIR / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Download ETF/stock OHLCV via yfinance")
    parser.add_argument(
        "--scope",
        choices=("portfolios", "universe", "demo", "all"),
        default="portfolios",
        help="Which ticker set to download (default: portfolios; demo = bundled Render prices)",
    )
    parser.add_argument(
        "--bundled",
        action="store_true",
        help="Write closes.parquet to apps/api/data/bundled_prices (for Docker / Render)",
    )
    parser.add_argument("--start", default=DEFAULT_START, help="Start date YYYY-MM-DD")
    parser.add_argument(
        "--end",
        default=None,
        help="End date YYYY-MM-DD (default: today)",
    )
    args = parser.parse_args()

    end = args.end or date.today().isoformat()
    tickers = resolve_tickers(args.scope)
    if not tickers:
        raise SystemExit("No tickers resolved")

    out_dir = BUNDLED_OUTPUT_DIR if args.bundled else OUTPUT_DIR
    print(f"Downloading {len(tickers)} tickers ({args.scope}) from {args.start} to {end}")
    print(f"Output directory: {out_dir}")
    ohlcv = download_ohlcv(tickers, args.start, end)
    closes = build_close_panel(ohlcv)
    if args.bundled:
        out_dir.mkdir(parents=True, exist_ok=True)
        closes.to_parquet(out_dir / "closes.parquet")
        meta = {
            "scope": args.scope,
            "start": args.start,
            "end": end,
            "tickers_requested": len(tickers),
            "tickers_downloaded": len(ohlcv),
            "missing_tickers": sorted(set(tickers) - set(ohlcv.keys())),
            "close_rows": len(closes),
            "close_columns": len(closes.columns),
            "downloaded_at": date.today().isoformat(),
        }
        (out_dir / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    else:
        save_outputs(
            ohlcv,
            closes,
            tickers_requested=tickers,
            start=args.start,
            end=end,
            scope=args.scope,
        )

    missing = sorted(set(tickers) - set(ohlcv.keys()))
    if args.bundled:
        print(
            f"Saved bundled close panel ({closes.shape[0]} rows x {closes.shape[1]} cols) "
            f"to {out_dir / 'closes.parquet'}"
        )
    else:
        print(f"Saved {len(ohlcv)} OHLCV files to {OHLCV_DIR}")
        print(
            f"Saved close panel ({closes.shape[0]} rows x {closes.shape[1]} cols) "
            f"to {OUTPUT_DIR / 'closes.parquet'}"
        )
    if missing:
        print(f"Missing tickers ({len(missing)}): {', '.join(missing[:20])}{'...' if len(missing) > 20 else ''}")
        sys.exit(1)


if __name__ == "__main__":
    main()

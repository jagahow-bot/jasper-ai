#!/usr/bin/env python3
"""Fetch / backfill ISIN codes for ETF/FUND rows in shared/etf-universe.json.

Stocks are never assigned an ISIN (UI shows "-"). Primary fill uses a curated
public ISIN map for liquid names; optional ``--yfinance`` attempts live lookup
(Yahoo often returns blank ISINs for US ETFs).

After writing shared/, run ``npm run sync-universe``.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UNIVERSE_PATH = ROOT / "shared" / "etf-universe.json"

ISIN_PRODUCT_TYPES = frozenset({"etf", "fund"})

# Public ISINs for liquid US-listed ETF/FUND tickers (not invented).
CURATED_ISIN: dict[str, str] = {
    "SPY": "US78462F1030",
    "IVV": "US4642872000",
    "VOO": "US9229083632",
    "VTI": "US9229087690",
    "QQQ": "US46090E1038",
    "IWM": "US4642876555",
    "EFA": "US4642874659",
    "EEM": "US4642872349",
    "AGG": "US4642872265",
    "BND": "US9219378356",
    "TLT": "US4642874329",
    "IEF": "US4642874402",
    "LQD": "US4642872422",
    "HYG": "US4642885135",
    "GLD": "US78463V1070",
    "IAU": "US4642852044",
    "VNQ": "US9229085538",
    "VEA": "US9219438580",
    "VWO": "US9220428588",
    "VXUS": "US9219108738",
    "VT": "US9220427424",
    "ACWI": "US4642882579",
    "IEFA": "US46432F8427",
    "IEMG": "US46434G1031",
    "SCHB": "US8085241024",
    "SCHD": "US8085247976",
    "SCHX": "US8085242014",
    "VIG": "US9219088443",
    "VYM": "US9219088500",
    "DVY": "US4642871689",
    "SDY": "US78464A7634",
    "MDY": "US78467Y1073",
    "DIA": "US78467X1090",
    "XLF": "US81369Y6059",
    "XLK": "US81369Y8030",
    "XLE": "US81369Y5069",
    "XLV": "US81369Y2090",
    "XLI": "US81369Y7040",
    "XLY": "US81369Y4070",
    "XLP": "US81369Y3080",
    "XLU": "US81369Y8865",
    "XLB": "US81369Y1001",
    "XLRE": "US81369Y8602",
    "XLC": "US81369Y8529",
    "TIP": "US4642871762",
    "SHY": "US4642874576",
    "SHV": "US4642886794",
    "BIL": "US78468R6633",
    "GOVT": "US46429B2676",
    "MUB": "US4642884146",
    "VCIT": "US92206C5739",
    "VCSH": "US92206C4096",
    "BNDX": "US92203J4076",
    "BWX": "US78464A5166",
    "EMB": "US4642882819",
    "JNK": "US78468R6229",
    "USO": "US91232N1082",
    "DBC": "US88160G1014",
    "PDBC": "US72201R5850",
    "SLV": "US46428Q1094",
    "ARKK": "US00214Q1040",
    "ARKW": "US00214Q4010",
    "BOTZ": "US37954Y7159",
    "SMH": "US46138G5657",
    "SOXX": "US4642875235",
    "IBB": "US4642875565",
    "XBI": "US78464A8707",
    "KWEB": "US5007673065",
    "FXI": "US4642871846",
    "MCHI": "US46429B6719",
    "EWJ": "US4642868487",
    "EWZ": "US4642864007",
    "INDA": "US46429B5984",
    "EWY": "US4642867354",
    "EWG": "US4642868063",
    "EWU": "US4642862347",
    "VGK": "US9220428745",
    "VSS": "US9220427184",
    "VB": "US9229087518",
    "VO": "US9229086296",
    "VV": "US9229086528",
    "VTV": "US9229087443",
    "VUG": "US9229087369",
    "MTUM": "US46432F3964",
    "QUAL": "US46432F3394",
    "USMV": "US46429B6974",
}


def _fetch_isin_yfinance(ticker: str) -> str | None:
    try:
        import yfinance as yf  # type: ignore
    except ImportError:
        print("yfinance is required: pip install yfinance", file=sys.stderr)
        raise

    t = yf.Ticker(ticker)
    isin = None
    try:
        isin = getattr(t, "isin", None)
    except Exception:
        isin = None
    if not isin or isin in ("-", "N/A"):
        try:
            info = t.get_info() if hasattr(t, "get_info") else (t.info or {})
            isin = info.get("isin") or info.get("ISIN")
        except Exception:
            isin = None
    if isinstance(isin, str):
        cleaned = isin.strip().upper()
        if len(cleaned) >= 10 and cleaned not in ("N/A", "-"):
            return cleaned
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write updated universe back to shared/etf-universe.json",
    )
    parser.add_argument(
        "--yfinance",
        action="store_true",
        help="Also try yfinance for tickers still missing after curated map",
    )
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--sleep", type=float, default=0.15)
    parser.add_argument("--tickers", nargs="*", default=None)
    args = parser.parse_args()

    data = json.loads(UNIVERSE_PATH.read_text(encoding="utf-8"))
    universe = data.get("universe") or []
    whitelist = {t.upper() for t in args.tickers} if args.tickers else None

    filled_curated = 0
    for row in universe:
        pt = str(row.get("product_type") or "etf").lower()
        if pt not in ISIN_PRODUCT_TYPES:
            continue
        ticker = str(row.get("ticker") or "").upper()
        if whitelist is not None and ticker not in whitelist:
            continue
        if row.get("isin"):
            continue
        if ticker in CURATED_ISIN:
            row["isin"] = CURATED_ISIN[ticker]
            filled_curated += 1

    print(f"Curated fill: {filled_curated}")

    if args.yfinance:
        targets = [
            row
            for row in universe
            if str(row.get("product_type") or "etf").lower() in ISIN_PRODUCT_TYPES
            and not row.get("isin")
            and (
                whitelist is None
                or str(row.get("ticker") or "").upper() in whitelist
            )
        ]
        if args.limit > 0:
            targets = targets[: args.limit]
        print(f"yfinance lookup for {len(targets)} remaining…")
        filled_yf = 0
        for row in targets:
            ticker = str(row["ticker"]).upper()
            try:
                isin = _fetch_isin_yfinance(ticker)
            except Exception as exc:  # noqa: BLE001
                print(f"  {ticker} → error {exc}")
                isin = None
            if isin:
                row["isin"] = isin
                filled_yf += 1
                print(f"  {ticker} → {isin}")
            else:
                print(f"  {ticker} → (missing)")
            if args.sleep > 0:
                time.sleep(args.sleep)
        print(f"yfinance filled {filled_yf}/{len(targets)}")

    if args.write:
        data["updated"] = time.strftime("%Y-%m-%d")
        UNIVERSE_PATH.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"Wrote {UNIVERSE_PATH}")
        print("Next: npm run sync-universe")
    else:
        print("Dry run — pass --write to persist")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

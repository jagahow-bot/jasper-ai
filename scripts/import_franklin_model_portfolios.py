# -*- coding: utf-8 -*-
"""Import Franklin Templeton full-holdings funds as model portfolios.

Source: TV需求資料 Excel with one sheet per fund, quarterly snapshots.
Takes the latest snapshot per sheet, groups share classes of the same ticker,
drops unlisted/cash/junk identifiers, renormalizes weights to 1.0.

Usage:
    python scripts/import_franklin_model_portfolios.py <xlsx_path> [--validate-yf]

--validate-yf: verify every new ticker resolves on yfinance (slow, ~2 min).
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
UNIVERSE_PATH = ROOT / "shared" / "etf-universe.json"
MODELS_PATH = ROOT / "shared" / "model-portfolios" / "model-portfolios.json"

WCOL = "% of Portfolio"
# Tickers containing digits are CUSIP fragments / non-US local codes in this file.
JUNK_TICKER = re.compile(r"\d")
FUNDS = {
    "成長": {
        "id": "franklin-templeton-growth",
        "name": "Franklin Growth",
        "theme": "US Large-Cap Growth (Full Holdings)",
        "benchmark": "IVV",
        "category_default": "us_stock",
    },
    "高科技": {
        "id": "franklin-templeton-dynatech",
        "name": "Franklin DynaTech",
        "theme": "US High-Tech Growth (Full Holdings)",
        "benchmark": "QQQ",
        "category_default": "us_stock_tech",
    },
    "美國機會": {
        "id": "franklin-templeton-us-opportunities",
        "name": "Franklin US Opportunities",
        "theme": "US Opportunities Growth (Full Holdings)",
        "benchmark": "IVV",
        "category_default": "us_stock",
    },
}
NAME_NOISE = re.compile(
    r"\s+(COM|ORD|CNV PFD|CVPF|SPONSORED ADR|ADR|CLASS|CL)\b.*$", re.IGNORECASE
)


def clean_name(raw: str) -> str:
    name = NAME_NOISE.sub("", str(raw)).strip()
    name = re.sub(r"\s+", " ", name)
    return name.rstrip(" ,.")


def latest_holdings(df: pd.DataFrame) -> tuple[pd.DataFrame, str]:
    df = df[df["As of Date"].notna()].copy()
    latest = str(df["As of Date"].astype(str).max())
    snap = df[df["As of Date"].astype(str) == latest]
    listed = snap[
        snap["Market Ticker"].notna() & (snap["Instrument Type"] != "Cash")
    ].copy()
    listed["ticker"] = listed["Market Ticker"].astype(str).str.upper().str.strip()
    return listed, latest


def validate_with_yfinance(tickers: list[str]) -> tuple[list[str], list[str]]:
    import yfinance as yf

    ok, bad = [], []
    for i in range(0, len(tickers), 25):
        chunk = tickers[i : i + 25]
        data = yf.download(
            chunk, period="1mo", progress=False, group_by="column", threads=False
        )
        closes = data["Close"] if "Close" in data else data
        for t in chunk:
            try:
                col = closes[t].dropna()
                (ok if len(col) >= 3 else bad).append(t)
            except Exception:
                bad.append(t)
    return ok, bad


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx")
    ap.add_argument("--validate-yf", action="store_true")
    args = ap.parse_args()

    universe = json.loads(UNIVERSE_PATH.read_text(encoding="utf-8"))
    models = json.loads(MODELS_PATH.read_text(encoding="utf-8"))
    u_tickers = {str(x["ticker"]).upper() for x in universe["universe"]}

    xl = pd.ExcelFile(args.xlsx)
    report: list[str] = []
    new_universe: list[dict] = []
    new_portfolios: list[dict] = []

    for sheet, meta in FUNDS.items():
        if sheet not in xl.sheet_names:
            report.append(f"!! sheet missing: {sheet}")
            continue
        listed, latest = latest_holdings(pd.read_excel(xl, sheet))
        junk = sorted(t for t in listed["ticker"].unique() if JUNK_TICKER.search(t))
        listed = listed[~listed["ticker"].isin(junk)]
        grp = (
            listed.groupby("ticker")
            .agg(
                weight=(WCOL, "sum"),
                name=("Security Name", "first"),
                country=("Country Risk Code", "first"),
            )
            .sort_values("weight", ascending=False)
        )
        total = grp["weight"].sum()
        grp["w"] = grp["weight"] / total

        missing = [t for t in grp.index if t not in u_tickers]
        if args.validate_yf and missing:
            ok, bad = validate_with_yfinance(missing)
            if bad:
                report.append(f"[{sheet}] yfinance failed, dropped: {bad}")
                grp = grp.drop(index=[t for t in bad if t in grp.index])
                grp["w"] = grp["weight"] / grp["weight"].sum()
                missing = [t for t in ok]
        for t in missing:
            country = str(grp.loc[t, "country"]).upper()
            new_universe.append(
                {
                    "ticker": t,
                    "name": clean_name(grp.loc[t, "name"]),
                    "asset_class": "equity",
                    "region": "us" if country == "US" else "intl",
                    "category": (
                        meta["category_default"] if country.upper() == "US" else "intl_stock"
                    ),
                    "product_type": "stock",
                }
            )

        holdings = [
            {
                "ticker": t,
                "weight": round(float(grp.loc[t, "w"]), 6),
                "name": clean_name(grp.loc[t, "name"]),
            }
            for t in grp.index
        ]
        drift = 1.0 - sum(h["weight"] for h in holdings)
        holdings[0]["weight"] = round(holdings[0]["weight"] + drift, 6)

        new_portfolios.append(
            {
                "id": meta["id"],
                "am_id": "franklin-templeton",
                "asset_manager": "Franklin Templeton",
                "theme": meta["theme"],
                "name": meta["name"],
                "description": (
                    f"Full listed holdings of the fund as of {latest} "
                    f"({len(holdings)} positions). Unlisted private positions and cash "
                    "excluded; weights renormalized to 100%."
                ),
                "source": {
                    "name": "Franklin Templeton holdings disclosure (TV需求資料)",
                    "url": "",
                },
                "asset_class_mix": {"equity": 1.0},
                "holdings": holdings,
                "benchmark": meta["benchmark"],
                "risk_level": "aggressive",
            }
        )
        report.append(
            f"[{sheet}] {latest}: {len(holdings)} holdings imported; "
            f"junk dropped: {junk}; new universe tickers: {len(missing)}"
        )

    existing_ids = {p["id"] for p in models["portfolios"]}
    models["portfolios"].extend(
        p for p in new_portfolios if p["id"] not in existing_ids
    )
    models["updated"] = str(date.today())
    universe["universe"].extend(new_universe)
    universe["updated"] = str(date.today())

    UNIVERSE_PATH.write_text(
        json.dumps(universe, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    MODELS_PATH.write_text(
        json.dumps(models, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    report.append(
        f"TOTAL: +{len(new_portfolios)} portfolios, +{len(new_universe)} universe tickers"
    )
    print("\n".join(report))


if __name__ == "__main__":
    sys.exit(main())

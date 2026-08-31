#!/usr/bin/env python3
"""Backfill ``sector`` on shared/etf-universe.json for holdings composition UI."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UNIVERSE_PATH = ROOT / "shared" / "etf-universe.json"

# GICS-like sector keys used by the web holding-groups layer.
CATEGORY_TO_SECTOR: dict[str, str] = {
    "us_stock_tech": "tech",
    "us_stock_semi": "tech",
    "us_stock_financials": "financials",
    "us_stock_healthcare": "healthcare",
    "us_stock_consumer": "consumer_disc",
    "us_stock_staples": "consumer_staples",
    "us_stock_comms": "comms",
    "us_stock_energy": "energy",
    "us_stock_utilities": "utilities",
    "us_stock_materials": "materials",
    "us_stock_industrials": "industrials",
    # Thematic / sector ETFs → nearest equity sector bucket.
    "us_thematic": "tech",
    "us_sector": "broad_market",
    "us_industry": "industrials",
    "us_growth": "tech",
    "us_esg": "broad_market",
    "us_broad": "broad_market",
    "us_size": "broad_market",
    "us_factor": "broad_market",
    "intl_stock": "broad_market",
    "intl_developed": "broad_market",
    "intl_em": "broad_market",
    "intl_broad": "broad_market",
    "intl_thematic": "broad_market",
    "global_broad": "broad_market",
    "us_fund_core": "broad_market",
    "us_fund_growth": "tech",
    "us_fund_value": "financials",
    "us_fund_balanced": "broad_market",
    "us_fund_dividend": "financials",
    "us_fund_income": "financials",
    "us_fund_size": "broad_market",
    "us_fund_target": "broad_market",
    "us_fund_reit": "real_estate",
    "global_fund_core": "broad_market",
    "intl_fund_core": "broad_market",
    "intl_fund_growth": "tech",
    "intl_fund_value": "financials",
    "reit": "real_estate",
    "reit_sector": "real_estate",
    "reit_mortgage": "real_estate",
}

# Manual overrides for us_stock / us_stock_mega (no category suffix).
SECTOR_OVERRIDES: dict[str, str] = {
    "A": "healthcare",
    "AAPL": "tech",
    "ADI": "tech",
    "ADP": "industrials",
    "ADSK": "tech",
    "AME": "industrials",
    "AMZN": "consumer_disc",
    "APD": "materials",
    "APH": "tech",
    "APP": "tech",
    "ARES": "financials",
    "ARM": "tech",
    "AVGO": "tech",
    "AXON": "tech",
    "AZO": "consumer_disc",
    "BRBR": "consumer_staples",
    "BRK-B": "financials",
    "BSX": "healthcare",
    "BWXT": "industrials",
    "BX": "financials",
    "CMG": "consumer_disc",
    "CSGP": "real_estate",
    "CW": "industrials",
    "DASH": "consumer_disc",
    "DXCM": "healthcare",
    "ECL": "materials",
    "FAST": "industrials",
    "FICO": "tech",
    "FIG": "financials",
    "FRPT": "consumer_staples",
    "GEV": "industrials",
    "GOOG": "comms",
    "GOOGL": "comms",
    "HUBS": "tech",
    "ICE": "financials",
    "IR": "industrials",
    "JCI": "industrials",
    "LSCC": "tech",
    "MCK": "healthcare",
    "META": "comms",
    "MLM": "materials",
    "MNST": "consumer_staples",
    "MPWR": "tech",
    "MSCI": "financials",
    "MSFT": "tech",
    "MSI": "tech",
    "MTD": "healthcare",
    "NOC": "industrials",
    "NVDA": "tech",
    "ODFL": "industrials",
    "PH": "industrials",
    "PINS": "comms",
    "PTC": "tech",
    "QXO": "materials",
    "RBLX": "comms",
    "RSG": "industrials",
    "SARO": "industrials",
    "SNPS": "tech",
    "SPGI": "financials",
    "SPOT": "comms",
    "SYK": "healthcare",
    "TEM": "healthcare",
    "TRU": "financials",
    "TSLA": "consumer_disc",
    "TT": "industrials",
    "TW": "financials",
    "TYL": "tech",
    "UBER": "industrials",
    "VEEV": "healthcare",
    "VRSK": "financials",
    "WING": "consumer_disc",
    "XYL": "industrials",
}

NON_EQUITY_ASSET_TO_SECTOR = {
    "bond": "bond",
    "commodity": "commodity",
    "real_estate": "real_estate",
    "alternative": "alternative",
}


def resolve_sector(entry: dict) -> str | None:
    ticker = str(entry.get("ticker") or "").upper()
    asset_class = str(entry.get("asset_class") or "equity")
    category = str(entry.get("category") or "")
    product_type = str(entry.get("product_type") or "etf")

    if asset_class != "equity":
        return NON_EQUITY_ASSET_TO_SECTOR.get(asset_class, "other")

    if ticker in SECTOR_OVERRIDES:
        return SECTOR_OVERRIDES[ticker]

    if category in CATEGORY_TO_SECTOR:
        return CATEGORY_TO_SECTOR[category]

    if product_type == "stock":
        return "other"

    # Equity ETF / fund without a finer mapping.
    return "broad_market"


def backfill(universe: list[dict]) -> tuple[list[dict], list[str]]:
    missing: list[str] = []
    out: list[dict] = []
    for entry in universe:
        row = dict(entry)
        sector = resolve_sector(row)
        if sector:
            row["sector"] = sector
        else:
            missing.append(str(row.get("ticker") or "?"))
        out.append(row)
    return out, missing


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--write",
        action="store_true",
        help="Write updated universe back to shared/etf-universe.json",
    )
    args = parser.parse_args()

    payload = json.loads(UNIVERSE_PATH.read_text(encoding="utf-8"))
    universe = payload.get("universe") or []
    updated, missing = backfill(universe)

    stocks = [u for u in updated if u.get("product_type") == "stock"]
    stock_other = [u["ticker"] for u in stocks if u.get("sector") == "other"]
    print(f"universe entries: {len(updated)}")
    print(f"with sector: {sum(1 for u in updated if u.get('sector'))}")
    print(f"stocks still 'other': {len(stock_other)}")
    if stock_other:
        print("stock other:", ", ".join(sorted(stock_other)))

    if args.write:
        payload["universe"] = updated
        UNIVERSE_PATH.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"wrote {UNIVERSE_PATH}")
    elif missing:
        print("missing (dry run):", missing)


if __name__ == "__main__":
    main()

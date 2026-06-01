"""Merge liquid US-listed ETFs into shared/etf-universe.json (idempotent by ticker)."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UNIVERSE_PATH = ROOT / "shared" / "etf-universe.json"

# (ticker, name, asset_class, region, category)
ADDITIONS: list[tuple[str, str, str, str, str]] = [
    # US broad / cap
    ("RSP", "S&P 500 equal weight", "equity", "us", "us_broad"),
    ("SCHX", "US large-cap core", "equity", "us", "us_broad"),
    ("VV", "US large-cap", "equity", "us", "us_broad"),
    ("MGK", "US mega-cap growth", "equity", "us", "us_growth"),
    ("VONE", "Russell 1000", "equity", "us", "us_broad"),
    ("SPLG", "S&P 500 low cost", "equity", "us", "us_broad"),
    ("SPTM", "US total market", "equity", "us", "us_broad"),
    ("IJT", "S&P small-cap growth", "equity", "us", "us_size"),
    ("IJS", "S&P small-cap value", "equity", "us", "us_size"),
    ("IJK", "S&P mid-cap growth", "equity", "us", "us_size"),
    ("SPSM", "S&P 600 small-cap", "equity", "us", "us_size"),
    ("SPMD", "S&P 400 mid-cap", "equity", "us", "us_size"),
    ("VIOO", "S&P 600", "equity", "us", "us_size"),
    ("VIOG", "S&P 600 growth", "equity", "us", "us_size"),
    ("VIOV", "S&P 600 value", "equity", "us", "us_size"),
    ("IWN", "Russell 2000 value", "equity", "us", "us_size"),
    ("IWO", "Russell 2000 growth", "equity", "us", "us_size"),
    ("VBR", "Small-cap value", "equity", "us", "us_size"),
    ("VBK", "Small-cap growth", "equity", "us", "us_size"),
    # US factors
    ("SPHD", "S&P 500 high dividend low vol", "equity", "us", "us_factor"),
    ("DVY", "Dividend achievers", "equity", "us", "us_factor"),
    ("DGRO", "Dividend growth", "equity", "us", "us_factor"),
    ("DGRW", "Dividend growth (WisdomTree)", "equity", "us", "us_factor"),
    ("FVD", "Value line dividend", "equity", "us", "us_factor"),
    ("PRF", "Russell 1000 style neutral", "equity", "us", "us_factor"),
    ("PRFZ", "Russell 2000 style neutral", "equity", "us", "us_factor"),
    ("DFAC", "US core equity", "equity", "us", "us_factor"),
    ("AVUV", "US small-cap value", "equity", "us", "us_factor"),
    ("SPMO", "S&P 500 momentum", "equity", "us", "us_factor"),
    ("SPHQ", "S&P 500 quality", "equity", "us", "us_factor"),
    ("SPYV", "S&P 500 value", "equity", "us", "us_factor"),
    ("SPYG", "S&P 500 growth", "equity", "us", "us_factor"),
    ("IVE", "S&P 500 value (iShares)", "equity", "us", "us_factor"),
    ("IVW", "S&P 500 growth (iShares)", "equity", "us", "us_factor"),
    ("LRGF", "US large-cap multifactor", "equity", "us", "us_factor"),
    ("USMC", "US mega-cap", "equity", "us", "us_factor"),
    ("ESGU", "ESG US", "equity", "us", "us_esg"),
    ("ESGV", "ESG US (Vanguard)", "equity", "us", "us_esg"),
    ("SUSA", "MSCI USA ESG", "equity", "us", "us_esg"),
    # US GICS sector (Select Sector SPDR + Vanguard sector peers)
    ("XLB", "Materials", "equity", "us", "us_sector"),
    ("XLC", "Communication services", "equity", "us", "us_sector"),
    ("XLE", "Energy", "equity", "us", "us_sector"),
    ("XLF", "Financials", "equity", "us", "us_sector"),
    ("XLI", "Industrials", "equity", "us", "us_sector"),
    ("XLK", "Technology", "equity", "us", "us_sector"),
    ("XLP", "Consumer staples", "equity", "us", "us_sector"),
    ("XLU", "Utilities", "equity", "us", "us_sector"),
    ("XLV", "Health care", "equity", "us", "us_sector"),
    ("XLY", "Consumer discretionary", "equity", "us", "us_sector"),
    ("VDE", "Energy Vanguard", "equity", "us", "us_sector"),
    ("VFH", "Financials Vanguard", "equity", "us", "us_sector"),
    ("VGT", "Technology Vanguard", "equity", "us", "us_sector"),
    ("VHT", "Health care Vanguard", "equity", "us", "us_sector"),
    ("VIS", "Industrials Vanguard", "equity", "us", "us_sector"),
    ("VPU", "Utilities Vanguard", "equity", "us", "us_sector"),
    ("VCR", "Consumer disc Vanguard", "equity", "us", "us_sector"),
    ("VDC", "Consumer staples Vanguard", "equity", "us", "us_sector"),
    ("VOX", "Communication Vanguard", "equity", "us", "us_sector"),
    # US sub-industry / industry (liquid GICS industry ETFs)
    ("XBI", "Biotech", "equity", "us", "us_industry"),
    ("IBB", "Biotech (iShares)", "equity", "us", "us_industry"),
    ("XOP", "Oil & gas exploration", "equity", "us", "us_industry"),
    ("XAR", "Aerospace & defense", "equity", "us", "us_industry"),
    ("ITA", "Aerospace & defense (iShares)", "equity", "us", "us_industry"),
    ("KBE", "Banks", "equity", "us", "us_industry"),
    ("KRE", "Regional banks", "equity", "us", "us_industry"),
    ("XPH", "Pharma", "equity", "us", "us_industry"),
    ("XSW", "Software", "equity", "us", "us_industry"),
    ("IGV", "Software (iShares)", "equity", "us", "us_industry"),
    ("XSD", "Semiconductor SPDR", "equity", "us", "us_industry"),
    ("SMH", "Semiconductors (VanEck)", "equity", "us", "us_industry"),
    ("SOXX", "Semiconductors (iShares)", "equity", "us", "us_industry"),
    ("XES", "Oil & gas equipment", "equity", "us", "us_industry"),
    ("XTL", "Telecom", "equity", "us", "us_industry"),
    ("GDXJ", "Junior gold miners", "equity", "us", "us_industry"),
    ("XHB", "Homebuilders", "equity", "us", "us_industry"),
    ("ITB", "Home construction", "equity", "us", "us_industry"),
    ("XME", "Metals & mining", "equity", "us", "us_industry"),
    ("XRT", "Retail", "equity", "us", "us_industry"),
    ("XHE", "Healthcare equipment", "equity", "us", "us_industry"),
    ("IHI", "Medical devices", "equity", "us", "us_industry"),
    ("IYT", "Transportation", "equity", "us", "us_industry"),
    ("FXH", "Health care (First Trust)", "equity", "us", "us_industry"),
    ("FDN", "Internet", "equity", "us", "us_industry"),
    ("FTEC", "Technology (Fidelity)", "equity", "us", "us_industry"),
    ("XNTK", "Nasdaq 100 Technology", "equity", "us", "us_industry"),
    ("KIE", "Insurance", "equity", "us", "us_industry"),
    ("PPH", "Pharma (VanEck)", "equity", "us", "us_industry"),
    ("IYE", "Energy (iShares)", "equity", "us", "us_industry"),
    ("IYM", "Materials (iShares)", "equity", "us", "us_industry"),
    ("IYF", "Financials (iShares)", "equity", "us", "us_industry"),
    ("IYC", "Consumer disc (iShares)", "equity", "us", "us_industry"),
    ("IYK", "Consumer staples (iShares)", "equity", "us", "us_industry"),
    ("IDU", "Utilities (iShares)", "equity", "us", "us_industry"),
    ("IYW", "Technology (iShares)", "equity", "us", "us_industry"),
    ("IHF", "Health care providers", "equity", "us", "us_industry"),
    ("XHS", "Health care services", "equity", "us", "us_industry"),
    ("XWEB", "Internet & direct marketing", "equity", "us", "us_industry"),
    # US thematic
    ("SKYY", "Cloud computing", "equity", "us", "us_thematic"),
    ("CIBR", "Cybersecurity", "equity", "us", "us_thematic"),
    ("HACK", "Cybersecurity (ETFMG)", "equity", "us", "us_thematic"),
    ("ROBO", "Robotics", "equity", "us", "us_thematic"),
    ("DRIV", "Electric vehicles", "equity", "us", "us_thematic"),
    ("LIT", "Lithium & battery", "equity", "us", "us_thematic"),
    ("URA", "Uranium", "equity", "us", "us_thematic"),
    ("NLR", "Nuclear", "equity", "us", "us_thematic"),
    ("TAN", "Solar", "equity", "us", "us_thematic"),
    ("FAN", "Wind", "equity", "us", "us_thematic"),
    ("CLOU", "Cloud computing (Global X)", "equity", "us", "us_thematic"),
    ("ARKW", "Next-gen internet", "equity", "us", "us_thematic"),
    ("ARKG", "Genomic revolution", "equity", "us", "us_thematic"),
    ("PAVE", "Infrastructure", "equity", "us", "us_thematic"),
    ("JETS", "Airlines", "equity", "us", "us_thematic"),
    # Intl developed
    ("HEFA", "Dev ex-US currency hedged", "equity", "intl", "intl_developed"),
    ("DBEF", "Dev ex-US hedged", "equity", "intl", "intl_developed"),
    ("EFV", "EAFE value", "equity", "intl", "intl_developed"),
    ("EFAV", "EAFE min vol", "equity", "intl", "intl_developed"),
    ("HEWJ", "Japan hedged", "equity", "intl", "intl_developed"),
    ("DXJ", "Japan currency hedged", "equity", "intl", "intl_developed"),
    ("EWUS", "UK small-cap", "equity", "intl", "intl_developed"),
    ("EWL", "Switzerland", "equity", "intl", "intl_country"),
    ("EWN", "Netherlands", "equity", "intl", "intl_country"),
    ("EWP", "Spain", "equity", "intl", "intl_country"),
    ("EWQ", "France", "equity", "intl", "intl_country"),
    ("EWI", "Italy", "equity", "intl", "intl_country"),
    ("EWD", "Sweden", "equity", "intl", "intl_country"),
    ("EWH", "Hong Kong", "equity", "intl", "intl_country"),
    ("EWS", "Singapore", "equity", "intl", "intl_country"),
    ("EPI", "India (WisdomTree)", "equity", "intl", "intl_country"),
    ("EPOL", "Poland", "equity", "intl", "intl_country"),
    ("EIS", "Israel", "equity", "intl", "intl_country"),
    ("ENOR", "Norway", "equity", "intl", "intl_country"),
    ("THD", "Thailand", "equity", "intl", "intl_country"),
    ("VNM", "Vietnam", "equity", "intl", "intl_country"),
    ("UAE", "UAE", "equity", "intl", "intl_country"),
    ("KSA", "Saudi Arabia", "equity", "intl", "intl_country"),
    ("QAT", "Qatar", "equity", "intl", "intl_country"),
    ("FM", "Frontier markets", "equity", "intl", "intl_frontier"),
    ("SCHE", "EM small-cap", "equity", "intl", "intl_em"),
    ("EMXC", "EM ex-China", "equity", "intl", "intl_em"),
    ("SPEM", "EM (SPDR)", "equity", "intl", "intl_em"),
    ("GEM", "Active EM multifactor", "equity", "intl", "intl_em"),
    ("ASHR", "China A-shares", "equity", "intl", "intl_country"),
    ("GXC", "China large-cap (SPDR)", "equity", "intl", "intl_country"),
    ("EWW", "Mexico", "equity", "intl", "intl_country"),
    ("ECH", "Chile", "equity", "intl", "intl_country"),
    ("EPHE", "Philippines", "equity", "intl", "intl_country"),
    ("EIDO", "Indonesia", "equity", "intl", "intl_country"),
    ("EWM", "Malaysia", "equity", "intl", "intl_country"),
    ("VGK", "Europe", "equity", "intl", "intl_developed"),
    # Intl thematic
    ("CQQQ", "China tech", "equity", "intl", "intl_thematic"),
    ("EMQQ", "EM internet", "equity", "intl", "intl_thematic"),
    ("FINX", "Fintech", "equity", "global", "intl_thematic"),
    # Global equity
    ("GWL", "Developed world", "equity", "global", "global_broad"),
    ("IOO", "Global 100", "equity", "global", "global_broad"),
    ("VEU", "All-world ex-US", "equity", "global", "global_broad"),
    # Treasuries / duration
    ("ZROZ", "25+ year Treasury", "bond", "us", "treasury"),
    ("EDV", "Extended duration Treasury", "bond", "us", "treasury"),
    ("SPTL", "Long-term Treasury", "bond", "us", "treasury"),
    ("SPTI", "Intermediate Treasury", "bond", "us", "treasury"),
    ("SPTS", "Short-term Treasury", "bond", "us", "treasury"),
    ("SCHO", "Short-term Treasury (Schwab)", "bond", "us", "treasury"),
    ("SCHR", "Intermediate Treasury (Schwab)", "bond", "us", "treasury"),
    ("VGSH", "Short-term Treasury Vanguard", "bond", "us", "treasury"),
    ("VUSB", "Ultra-short bond", "bond", "us", "treasury"),
    ("SGOV", "0-3 month T-bills", "bond", "us", "treasury"),
    ("TBIL", "T-bill", "bond", "us", "treasury"),
    ("TFLO", "Floating rate Treasury", "bond", "us", "treasury"),
    ("USFR", "Floating rate Treasury (WisdomTree)", "bond", "us", "bond_floating"),
    ("FLOT", "Investment-grade floating rate", "bond", "us", "bond_floating"),
    # Credit IG / HY
    ("IGSB", "Short-term IG corporate", "bond", "us", "credit_ig"),
    ("IGIB", "Intermediate IG corporate", "bond", "us", "credit_ig"),
    ("IGLB", "Long-term IG corporate", "bond", "us", "credit_ig"),
    ("LMBS", "Mortgage-backed securities", "bond", "us", "bond_mbs"),
    ("MBB", "MBS (iShares)", "bond", "us", "bond_mbs"),
    ("VMBS", "MBS Vanguard", "bond", "us", "bond_mbs"),
    ("GNMA", "GNMA bonds", "bond", "us", "bond_mbs"),
    ("CMBS", "CMBS", "bond", "us", "bond_mbs"),
    ("FALN", "Fallen angels HY", "bond", "us", "credit_hy"),
    ("ANGL", "Fallen angels (VanEck)", "bond", "us", "credit_hy"),
    ("SHYG", "Short-term HY", "bond", "us", "credit_hy"),
    ("SJNK", "Short-term HY (SPDR)", "bond", "us", "credit_hy"),
    ("HYLB", "High yield corporate", "bond", "us", "credit_hy"),
    ("PHB", "High yield (PowerShares)", "bond", "us", "credit_hy"),
    ("SPBO", "Global IG corporate", "bond", "us", "credit_ig"),
    ("BIV", "Intermediate bond Vanguard", "bond", "us", "aggregate"),
    ("BSV", "Short-term bond Vanguard", "bond", "us", "aggregate"),
    ("BLV", "Long-term bond Vanguard", "bond", "us", "aggregate"),
    ("SCHZ", "US aggregate bond", "bond", "us", "aggregate"),
    ("SPAB", "US aggregate (SPDR)", "bond", "us", "aggregate"),
    # Muni / inflation
    ("HYD", "High yield muni", "bond", "us", "muni"),
    ("SUB", "Short-term muni", "bond", "us", "muni"),
    ("MUNI", "National muni", "bond", "us", "muni"),
    ("TIPX", "TIPS broad", "bond", "us", "inflation"),
    ("VTIP", "Short-term TIPS Vanguard", "bond", "us", "inflation"),
    ("LTPZ", "Long-term TIPS", "bond", "us", "inflation"),
    # Intl / EM bonds
    ("BWX", "International Treasury", "bond", "intl", "intl_bond"),
    ("BWZ", "Short-term intl Treasury", "bond", "intl", "intl_bond"),
    ("IGOV", "International Treasury (iShares)", "bond", "intl", "intl_bond"),
    ("EMLC", "EM local currency bonds", "bond", "intl", "em_bond"),
    ("LEMB", "EM local currency (iShares)", "bond", "intl", "em_bond"),
    ("PCY", "EM sovereign debt", "bond", "intl", "em_bond"),
    ("EMHY", "EM USD HY", "bond", "intl", "em_bond"),
    ("JPMB", "EM corporate", "bond", "intl", "em_bond"),
    # Commodities
    ("GLDM", "Gold mini", "commodity", "global", "precious"),
    ("SGOL", "Gold (Aberdeen)", "commodity", "global", "precious"),
    ("PPLT", "Platinum", "commodity", "global", "precious"),
    ("PALL", "Palladium", "commodity", "global", "precious"),
    ("UNG", "Natural gas", "commodity", "global", "energy"),
    ("BNO", "Brent crude", "commodity", "global", "energy"),
    ("USL", "Oil", "commodity", "global", "energy"),
    ("WEAT", "Wheat", "commodity", "global", "commodity_agriculture"),
    ("CORN", "Corn", "commodity", "global", "commodity_agriculture"),
    ("SOYB", "Soybeans", "commodity", "global", "commodity_agriculture"),
    ("DBA", "Agriculture broad", "commodity", "global", "commodity_agriculture"),
    ("TAGS", "Agriculture", "commodity", "global", "commodity_agriculture"),
    ("COMT", "Commodity broad", "commodity", "global", "broad"),
    ("GCC", "Commodity broad (WisdomTree)", "commodity", "global", "broad"),
    ("BCI", "Broad commodities", "commodity", "global", "broad"),
    # REIT
    ("RWR", "REIT (SPDR)", "real_estate", "us", "reit"),
    ("USRT", "REIT core", "real_estate", "us", "reit"),
    ("REM", "Mortgage REIT", "real_estate", "us", "reit_mortgage"),
    ("MORT", "Mortgage REIT (VanEck)", "real_estate", "us", "reit_mortgage"),
    ("RWO", "Global REIT", "real_estate", "global", "reit"),
    ("HAUZ", "International residential", "real_estate", "intl", "reit"),
    ("INDS", "Industrial REIT", "real_estate", "us", "reit_sector"),
    # Alternatives
    ("RLY", "Real assets", "alternative", "global", "multi_alt"),
    ("DBMF", "Managed futures", "alternative", "global", "alt_managed_futures"),
    ("KMLM", "Managed futures (KFA)", "alternative", "global", "alt_managed_futures"),
    ("CTA", "Managed futures (Simplify)", "alternative", "global", "alt_managed_futures"),
    ("BTAL", "Anti-beta", "alternative", "us", "alt_hedge"),
    ("MNA", "Merger arbitrage", "alternative", "us", "alt_hedge"),
    ("QAI", "Multi-strategy alt", "alternative", "global", "multi_alt"),
    ("PUTW", "Covered put write", "alternative", "us", "alt_hedge"),
    ("SVOL", "Short vol", "alternative", "us", "alt_hedge"),
    ("SRLN", "Senior loans", "alternative", "us", "credit_alt"),
    ("FTSL", "Senior loans (First Trust)", "alternative", "us", "credit_alt"),
    ("PFFD", "Preferred securities", "alternative", "us", "preferred"),
    ("PFFA", "Preferred & income", "alternative", "us", "preferred"),
    ("MLPA", "MLP", "alternative", "us", "income"),
    ("ENFR", "Energy infrastructure", "alternative", "us", "income"),
    ("ICAP", "Infrastructure income", "alternative", "us", "income"),
]

def main() -> None:
    data = json.loads(UNIVERSE_PATH.read_text(encoding="utf-8"))
    by_ticker: dict[str, dict] = {u["ticker"]: u for u in data["universe"]}

    added = 0
    updated = 0
    for row in ADDITIONS:
        ticker, name, ac, region, cat = row
        existing = by_ticker.get(ticker)
        if existing:
            if (
                existing.get("category") != cat
                or existing.get("asset_class") != ac
                or existing.get("region") != region
            ):
                by_ticker[ticker] = {
                    **existing,
                    "name": name,
                    "asset_class": ac,
                    "region": region,
                    "category": cat,
                }
                updated += 1
            continue
        by_ticker[ticker] = {
            "ticker": ticker,
            "name": name,
            "asset_class": ac,
            "region": region,
            "category": cat,
        }
        added += 1

    # Sort: equity, bond, commodity, real_estate, alternative; then ticker
    order = {"equity": 0, "bond": 1, "commodity": 2, "real_estate": 3, "alternative": 4}
    universe = sorted(
        by_ticker.values(),
        key=lambda u: (order.get(u["asset_class"], 9), u["ticker"]),
    )
    data["version"] = "1.1"
    data["updated"] = "2026-05-29"
    data["criteria"] = (
        "US-listed, typically >$500M AUM, diversified across asset classes and sub-categories"
    )
    data["universe"] = universe
    UNIVERSE_PATH.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"Added {added} ETFs, updated {updated}; total {len(universe)}")


if __name__ == "__main__":
    main()

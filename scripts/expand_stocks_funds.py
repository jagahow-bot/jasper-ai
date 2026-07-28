"""Merge popular US stocks and mutual funds into shared/etf-universe.json.

Idempotent by ticker. Adds product_type (stock | fund) so the investment pool
can distinguish ETF bricks from single-name equities and mutual funds.
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
UNIVERSE_PATH = ROOT / "shared" / "etf-universe.json"

# (ticker, name, asset_class, region, category, product_type)
STOCKS: list[tuple[str, str, str, str, str, str]] = [
    # Mega-cap tech / AI
    ("AAPL", "蘋果", "equity", "us", "us_stock_mega", "stock"),
    ("MSFT", "微軟", "equity", "us", "us_stock_mega", "stock"),
    ("NVDA", "輝達", "equity", "us", "us_stock_mega", "stock"),
    ("GOOGL", "Alphabet A", "equity", "us", "us_stock_mega", "stock"),
    ("GOOG", "Alphabet C", "equity", "us", "us_stock_mega", "stock"),
    ("AMZN", "亞馬遜", "equity", "us", "us_stock_mega", "stock"),
    ("META", "Meta", "equity", "us", "us_stock_mega", "stock"),
    ("TSLA", "特斯拉", "equity", "us", "us_stock_mega", "stock"),
    ("AVGO", "博通", "equity", "us", "us_stock_mega", "stock"),
    ("ORCL", "甲骨文", "equity", "us", "us_stock_tech", "stock"),
    ("CRM", "Salesforce", "equity", "us", "us_stock_tech", "stock"),
    ("ADBE", "Adobe", "equity", "us", "us_stock_tech", "stock"),
    ("AMD", "超微", "equity", "us", "us_stock_semi", "stock"),
    ("INTC", "英特爾", "equity", "us", "us_stock_semi", "stock"),
    ("QCOM", "高通", "equity", "us", "us_stock_semi", "stock"),
    ("TXN", "德州儀器", "equity", "us", "us_stock_semi", "stock"),
    ("MU", "美光", "equity", "us", "us_stock_semi", "stock"),
    ("AMAT", "應用材料", "equity", "us", "us_stock_semi", "stock"),
    ("LRCX", "Lam Research", "equity", "us", "us_stock_semi", "stock"),
    ("KLAC", "KLA", "equity", "us", "us_stock_semi", "stock"),
    ("INTU", "Intuit", "equity", "us", "us_stock_tech", "stock"),
    ("NOW", "ServiceNow", "equity", "us", "us_stock_tech", "stock"),
    ("PANW", "Palo Alto", "equity", "us", "us_stock_tech", "stock"),
    ("CRWD", "CrowdStrike", "equity", "us", "us_stock_tech", "stock"),
    ("SNOW", "Snowflake", "equity", "us", "us_stock_tech", "stock"),
    ("PLTR", "Palantir", "equity", "us", "us_stock_tech", "stock"),
    ("IBM", "IBM", "equity", "us", "us_stock_tech", "stock"),
    ("CSCO", "思科", "equity", "us", "us_stock_tech", "stock"),
    # Consumer / retail
    ("COST", "好市多", "equity", "us", "us_stock_consumer", "stock"),
    ("WMT", "沃爾瑪", "equity", "us", "us_stock_consumer", "stock"),
    ("HD", "Home Depot", "equity", "us", "us_stock_consumer", "stock"),
    ("MCD", "麥當勞", "equity", "us", "us_stock_consumer", "stock"),
    ("NKE", "Nike", "equity", "us", "us_stock_consumer", "stock"),
    ("SBUX", "星巴克", "equity", "us", "us_stock_consumer", "stock"),
    ("TGT", "Target", "equity", "us", "us_stock_consumer", "stock"),
    ("LOW", "Lowe's", "equity", "us", "us_stock_consumer", "stock"),
    ("TJX", "TJX", "equity", "us", "us_stock_consumer", "stock"),
    ("BKNG", "Booking", "equity", "us", "us_stock_consumer", "stock"),
    ("ABNB", "Airbnb", "equity", "us", "us_stock_consumer", "stock"),
    # Financials
    ("JPM", "摩根大通", "equity", "us", "us_stock_financials", "stock"),
    ("BAC", "美國銀行", "equity", "us", "us_stock_financials", "stock"),
    ("WFC", "富國銀行", "equity", "us", "us_stock_financials", "stock"),
    ("GS", "高盛", "equity", "us", "us_stock_financials", "stock"),
    ("MS", "摩根士丹利", "equity", "us", "us_stock_financials", "stock"),
    ("C", "花旗", "equity", "us", "us_stock_financials", "stock"),
    ("BLK", "貝萊德", "equity", "us", "us_stock_financials", "stock"),
    ("SCHW", "嘉信", "equity", "us", "us_stock_financials", "stock"),
    ("AXP", "美國運通", "equity", "us", "us_stock_financials", "stock"),
    ("V", "Visa", "equity", "us", "us_stock_financials", "stock"),
    ("MA", "Mastercard", "equity", "us", "us_stock_financials", "stock"),
    ("PYPL", "PayPal", "equity", "us", "us_stock_financials", "stock"),
    ("COF", "Capital One", "equity", "us", "us_stock_financials", "stock"),
    ("BRK-B", "波克夏 B", "equity", "us", "us_stock_mega", "stock"),
    # Healthcare
    ("UNH", "聯合健康", "equity", "us", "us_stock_healthcare", "stock"),
    ("JNJ", "嬌生", "equity", "us", "us_stock_healthcare", "stock"),
    ("LLY", "禮來", "equity", "us", "us_stock_healthcare", "stock"),
    ("ABBV", "艾伯維", "equity", "us", "us_stock_healthcare", "stock"),
    ("MRK", "默沙東", "equity", "us", "us_stock_healthcare", "stock"),
    ("PFE", "輝瑞", "equity", "us", "us_stock_healthcare", "stock"),
    ("TMO", "賽默飛", "equity", "us", "us_stock_healthcare", "stock"),
    ("ABT", "雅培", "equity", "us", "us_stock_healthcare", "stock"),
    ("DHR", "丹納赫", "equity", "us", "us_stock_healthcare", "stock"),
    ("ISRG", "直覺外科", "equity", "us", "us_stock_healthcare", "stock"),
    ("AMGN", "安進", "equity", "us", "us_stock_healthcare", "stock"),
    ("GILD", "吉利德", "equity", "us", "us_stock_healthcare", "stock"),
    ("VRTX", "Vertex", "equity", "us", "us_stock_healthcare", "stock"),
    ("REGN", "再生元", "equity", "us", "us_stock_healthcare", "stock"),
    ("BMY", "必治妥", "equity", "us", "us_stock_healthcare", "stock"),
    # Industrials / defense / transports
    ("CAT", "卡特彼勒", "equity", "us", "us_stock_industrials", "stock"),
    ("GE", "通用電氣", "equity", "us", "us_stock_industrials", "stock"),
    ("HON", "霍尼韋爾", "equity", "us", "us_stock_industrials", "stock"),
    ("UPS", "UPS", "equity", "us", "us_stock_industrials", "stock"),
    ("RTX", "RTX", "equity", "us", "us_stock_industrials", "stock"),
    ("BA", "波音", "equity", "us", "us_stock_industrials", "stock"),
    ("DE", "約翰迪爾", "equity", "us", "us_stock_industrials", "stock"),
    ("LMT", "洛克希德", "equity", "us", "us_stock_industrials", "stock"),
    ("ETN", "伊頓", "equity", "us", "us_stock_industrials", "stock"),
    ("UNP", "聯合太平洋", "equity", "us", "us_stock_industrials", "stock"),
    # Energy
    ("XOM", "艾克森美孚", "equity", "us", "us_stock_energy", "stock"),
    ("CVX", "雪佛龍", "equity", "us", "us_stock_energy", "stock"),
    ("COP", "康菲", "equity", "us", "us_stock_energy", "stock"),
    ("SLB", "Schlumberger", "equity", "us", "us_stock_energy", "stock"),
    ("EOG", "EOG", "equity", "us", "us_stock_energy", "stock"),
    # Communication / media
    ("NFLX", "Netflix", "equity", "us", "us_stock_comms", "stock"),
    ("DIS", "迪士尼", "equity", "us", "us_stock_comms", "stock"),
    ("CMCSA", "康卡斯特", "equity", "us", "us_stock_comms", "stock"),
    ("T", "AT&T", "equity", "us", "us_stock_comms", "stock"),
    ("VZ", "Verizon", "equity", "us", "us_stock_comms", "stock"),
    ("TMUS", "T-Mobile", "equity", "us", "us_stock_comms", "stock"),
    # Staples / utilities / other mega
    ("PEP", "百事", "equity", "us", "us_stock_staples", "stock"),
    ("KO", "可口可樂", "equity", "us", "us_stock_staples", "stock"),
    ("PG", "寶僑", "equity", "us", "us_stock_staples", "stock"),
    ("PM", "菲利普莫里斯", "equity", "us", "us_stock_staples", "stock"),
    ("MO", "Altria", "equity", "us", "us_stock_staples", "stock"),
    ("NEE", "NextEra", "equity", "us", "us_stock_utilities", "stock"),
    ("SO", "南方電力", "equity", "us", "us_stock_utilities", "stock"),
    ("DUK", "Duke Energy", "equity", "us", "us_stock_utilities", "stock"),
    ("LIN", "Linde", "equity", "us", "us_stock_materials", "stock"),
    ("SHW", "Sherwin-Williams", "equity", "us", "us_stock_materials", "stock"),
]

FUNDS: list[tuple[str, str, str, str, str, str]] = [
    # Vanguard core
    ("VFIAX", "Vanguard 500 Index Admiral", "equity", "us", "us_fund_core", "fund"),
    ("VTSAX", "Vanguard Total Stock Market Admiral", "equity", "us", "us_fund_core", "fund"),
    ("VIGAX", "Vanguard Growth Index Admiral", "equity", "us", "us_fund_growth", "fund"),
    ("VIMAX", "Vanguard Mid-Cap Index Admiral", "equity", "us", "us_fund_size", "fund"),
    ("VSMAX", "Vanguard Small-Cap Index Admiral", "equity", "us", "us_fund_size", "fund"),
    ("VTIAX", "Vanguard Total Intl Stock Admiral", "equity", "intl", "intl_fund_core", "fund"),
    ("VBTLX", "Vanguard Total Bond Market Admiral", "bond", "us", "us_fund_bond", "fund"),
    ("VWENX", "Vanguard Wellington Admiral", "equity", "us", "us_fund_balanced", "fund"),
    ("VWELX", "Vanguard Wellington Investor", "equity", "us", "us_fund_balanced", "fund"),
    ("VDIGX", "Vanguard Dividend Growth", "equity", "us", "us_fund_dividend", "fund"),
    ("VWNDX", "Vanguard Windsor", "equity", "us", "us_fund_value", "fund"),
    ("VHYAX", "Vanguard High Dividend Yield Admiral", "equity", "us", "us_fund_dividend", "fund"),
    ("VGSLX", "Vanguard Real Estate Index Admiral", "real_estate", "us", "us_fund_reit", "fund"),
    ("VTWAX", "Vanguard Total World Stock Admiral", "equity", "global", "global_fund_core", "fund"),
    # Fidelity
    ("FXAIX", "Fidelity 500 Index", "equity", "us", "us_fund_core", "fund"),
    ("FSKAX", "Fidelity Total Market Index", "equity", "us", "us_fund_core", "fund"),
    ("FZROX", "Fidelity ZERO Total Market", "equity", "us", "us_fund_core", "fund"),
    ("FZILX", "Fidelity ZERO International", "equity", "intl", "intl_fund_core", "fund"),
    ("FXNAX", "Fidelity U.S. Bond Index", "bond", "us", "us_fund_bond", "fund"),
    ("FDGRX", "Fidelity Growth Company", "equity", "us", "us_fund_growth", "fund"),
    ("FCNTX", "Fidelity Contrafund", "equity", "us", "us_fund_growth", "fund"),
    ("FBGRX", "Fidelity Blue Chip Growth", "equity", "us", "us_fund_growth", "fund"),
    ("FSPGX", "Fidelity Large Cap Growth Index", "equity", "us", "us_fund_growth", "fund"),
    ("FAGIX", "Fidelity Capital & Income", "bond", "us", "us_fund_credit", "fund"),
    ("FBALX", "Fidelity Balanced", "equity", "us", "us_fund_balanced", "fund"),
    ("FTBFX", "Fidelity Total Bond", "bond", "us", "us_fund_bond", "fund"),
    # American Funds
    ("AGTHX", "American Funds Growth Fund of America A", "equity", "us", "us_fund_growth", "fund"),
    ("CAIBX", "American Funds Capital Income Builder A", "equity", "global", "global_fund_income", "fund"),
    ("AMECX", "American Funds Income Fund of America A", "equity", "us", "us_fund_income", "fund"),
    ("ANCFX", "American Funds Fundamental Investors A", "equity", "us", "us_fund_core", "fund"),
    ("AWSHX", "American Funds Washington Mutual A", "equity", "us", "us_fund_value", "fund"),
    ("AIVSX", "American Funds Investment Co of America A", "equity", "us", "us_fund_core", "fund"),
    ("AMRMX", "American Funds American Mutual A", "equity", "us", "us_fund_value", "fund"),
    ("CWGFX", "American Funds Capital World Growth & Income A", "equity", "global", "global_fund_core", "fund"),
    ("RERFX", "American Funds EuroPacific Growth R5", "equity", "intl", "intl_fund_growth", "fund"),
    ("ABNDX", "American Funds Bond Fund of America A", "bond", "us", "us_fund_bond", "fund"),
    # T. Rowe Price / Dodge & Cox / others
    ("TRBCX", "T. Rowe Price Blue Chip Growth", "equity", "us", "us_fund_growth", "fund"),
    ("PRGFX", "T. Rowe Price Growth Stock", "equity", "us", "us_fund_growth", "fund"),
    ("PRWCX", "T. Rowe Price Capital Appreciation", "equity", "us", "us_fund_balanced", "fund"),
    ("DODGX", "Dodge & Cox Stock", "equity", "us", "us_fund_value", "fund"),
    ("DODFX", "Dodge & Cox International Stock", "equity", "intl", "intl_fund_value", "fund"),
    ("DODIX", "Dodge & Cox Income", "bond", "us", "us_fund_bond", "fund"),
    # Schwab
    ("SWPPX", "Schwab S&P 500 Index", "equity", "us", "us_fund_core", "fund"),
    ("SWTSX", "Schwab Total Stock Market Index", "equity", "us", "us_fund_core", "fund"),
    ("SWISX", "Schwab International Index", "equity", "intl", "intl_fund_core", "fund"),
    ("SWAGX", "Schwab U.S. Aggregate Bond Index", "bond", "us", "us_fund_bond", "fund"),
    ("SWYGX", "Schwab Target 2040 Index", "equity", "us", "us_fund_target", "fund"),
    ("SWYNX", "Schwab Target 2050 Index", "equity", "us", "us_fund_target", "fund"),
]


def main() -> None:
    data = json.loads(UNIVERSE_PATH.read_text(encoding="utf-8"))
    by_ticker: dict[str, dict] = {
        str(u["ticker"]).upper(): dict(u) for u in data.get("universe", [])
    }

    # Existing ETF rows default to product_type=etf when missing.
    for row in by_ticker.values():
        row.setdefault("product_type", "etf")

    added = 0
    updated = 0
    for ticker, name, ac, region, cat, ptype in [*STOCKS, *FUNDS]:
        ticker = ticker.upper()
        payload = {
            "ticker": ticker,
            "name": name,
            "asset_class": ac,
            "region": region,
            "category": cat,
            "product_type": ptype,
        }
        existing = by_ticker.get(ticker)
        if existing is None:
            by_ticker[ticker] = payload
            added += 1
            continue
        # Preserve ETF identity if ticker already exists as ETF (e.g. rare collisions).
        if existing.get("product_type", "etf") == "etf" and ptype != "etf":
            print(f"Skip {ticker}: already an ETF in universe")
            continue
        changed = False
        for key, val in payload.items():
            if existing.get(key) != val:
                existing[key] = val
                changed = True
        if changed:
            by_ticker[ticker] = existing
            updated += 1

    order = {"equity": 0, "bond": 1, "commodity": 2, "real_estate": 3, "alternative": 4}
    ptype_order = {"etf": 0, "stock": 1, "fund": 2}
    universe = sorted(
        by_ticker.values(),
        key=lambda u: (
            order.get(u["asset_class"], 9),
            ptype_order.get(str(u.get("product_type", "etf")), 9),
            u["ticker"],
        ),
    )
    data["version"] = "1.2"
    data["updated"] = date.today().isoformat()
    data["criteria"] = (
        "US-listed ETFs (typically >$500M AUM) plus popular mega/large-cap stocks "
        "and liquid mutual-fund share classes for wealth-management demos"
    )
    data["universe"] = universe
    UNIVERSE_PATH.write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    n_stock = sum(1 for u in universe if u.get("product_type") == "stock")
    n_fund = sum(1 for u in universe if u.get("product_type") == "fund")
    n_etf = sum(1 for u in universe if u.get("product_type", "etf") == "etf")
    print(
        f"Added {added}, updated {updated}; total {len(universe)} "
        f"(etf={n_etf}, stock={n_stock}, fund={n_fund})"
    )


if __name__ == "__main__":
    main()

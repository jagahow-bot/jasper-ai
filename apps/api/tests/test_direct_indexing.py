from app.direct_indexing import (
    detect_direct_indexing,
    expand_direct_index_locked_lists,
    parse_direct_index_sleeve_count,
    pick_direct_index_stocks,
)
from app.profiles import get_universe


def test_detect_direct_indexing_en_zh_ko():
    assert detect_direct_indexing("Implement direct indexing on SPY")
    assert detect_direct_indexing("實施 SPY 標普 500 指數直接索引策略，並適度提高 AI 產業配置權重")
    assert detect_direct_indexing("SPY 직접 인덱싱 전략")
    assert not detect_direct_indexing("Increase AI industry ETFs versus SPY")


def test_parse_direct_index_sleeve_count():
    assert parse_direct_index_sleeve_count("direct index S&P 500 top 30") == 30
    assert parse_direct_index_sleeve_count("實施標普 500 直接索引，前 30 檔") == 30
    assert parse_direct_index_sleeve_count("前三十大個股") == 30
    assert parse_direct_index_sleeve_count("S&P 500 직접 인덱싱 상위 30") == 30
    assert parse_direct_index_sleeve_count("Implement direct indexing on SPY") is None
    assert parse_direct_index_sleeve_count("S&P 500 direct indexing") is None


def test_pick_direct_index_stocks_are_catalog_stocks():
    catalog = {
        u["ticker"]: u
        for u in get_universe()
    }
    stocks = pick_direct_index_stocks("direct indexing SPY with AI overweight", limit=8)
    assert "NVDA" in stocks and "MSFT" in stocks
    assert "AIQ" not in stocks and "BOTZ" not in stocks and "IRBO" not in stocks
    for t in stocks:
        assert catalog[t].get("product_type") == "stock"
    assert 8 <= len(stocks) <= 12


def test_pick_direct_index_stocks_honors_top_30():
    catalog = {u["ticker"]: u for u in get_universe()}
    stocks = pick_direct_index_stocks(
        "direct indexing on SPY using S&P 500 top 30 with a moderate AI overweight"
    )
    assert len(stocks) >= 30
    assert "NVDA" in stocks and "MSFT" in stocks
    assert "BRK-B" in stocks and "JPM" in stocks
    for t in stocks:
        assert catalog[t].get("product_type") == "stock"
    zh = pick_direct_index_stocks("實施 SPY 標普 500 指數直接索引策略，使用前 30 檔")
    assert len(zh) >= 30


def test_expand_locked_spy_book_adds_stocks_not_thematic_etfs():
    tickers, supplements = expand_direct_index_locked_lists(
        universe_tickers=["SPY"],
        supplement_tickers=["SPY", "AIQ", "BOTZ", "IRBO"],
        filter_text="實施 SPY 標普 500 指數直接索引策略，並適度提高 AI 產業配置權重",
        filter_prompts=["實施 SPY 標普 500 指數直接索引策略，並適度提高 AI 產業配置權重"],
    )
    assert tickers is not None and supplements is not None
    assert "SPY" in tickers
    assert "NVDA" in tickers
    assert "MSFT" in tickers
    for t in ("AIQ", "BOTZ", "IRBO"):
        assert t not in tickers
        assert t not in supplements


def test_expand_locked_honors_top_30_count():
    tickers, _supplements = expand_direct_index_locked_lists(
        universe_tickers=["SPY"],
        supplement_tickers=["SPY"],
        filter_text="direct indexing S&P 500 top 30",
        filter_prompts=["direct indexing S&P 500 top 30"],
    )
    assert tickers is not None
    stock_n = sum(
        1
        for t in tickers
        if t != "SPY"
    )
    assert stock_n >= 30


def test_expand_is_noop_without_di_language():
    tickers, supplements = expand_direct_index_locked_lists(
        universe_tickers=["SPY"],
        supplement_tickers=["SPY", "BOTZ"],
        filter_text="Increase AI industry ETFs",
        filter_prompts=["Increase AI industry ETFs"],
    )
    assert tickers == ["SPY"]
    assert supplements == ["SPY", "BOTZ"]

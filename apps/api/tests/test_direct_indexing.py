from app.direct_indexing import (
    detect_direct_indexing,
    expand_direct_index_locked_lists,
    pick_direct_index_stocks,
)
from app.profiles import get_universe


def test_detect_direct_indexing_en_zh_ko():
    assert detect_direct_indexing("Implement direct indexing on SPY")
    assert detect_direct_indexing("實施 SPY 標普 500 指數直接索引策略，並適度提高 AI 產業配置權重")
    assert detect_direct_indexing("SPY 직접 인덱싱 전략")
    assert not detect_direct_indexing("Increase AI industry ETFs versus SPY")


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


def test_expand_is_noop_without_di_language():
    tickers, supplements = expand_direct_index_locked_lists(
        universe_tickers=["SPY"],
        supplement_tickers=["SPY", "BOTZ"],
        filter_text="Increase AI industry ETFs",
        filter_prompts=["Increase AI industry ETFs"],
    )
    assert tickers == ["SPY"]
    assert supplements == ["SPY", "BOTZ"]

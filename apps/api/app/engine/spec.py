"""Standardized backtest assumptions (Phase A)."""

from dataclasses import dataclass


@dataclass(frozen=True)
class BacktestSpec:
    benchmark_ticker: str = "SPY"
    risk_free_rate: float = 0.04
    fee_bps: float = 10.0
    rebalance_rule: str = "QE"
    min_holdings: int = 5
    max_holdings: int = 30

    @property
    def fee_rate(self) -> float:
        return self.fee_bps / 10_000.0


DEFAULT_SPEC = BacktestSpec()


def effective_top_n(top_n: int, spec: BacktestSpec) -> int:
    """Cap factor-screen / allocator sleeve count by run-level max holdings."""
    return int(max(1, min(int(top_n), int(spec.max_holdings))))

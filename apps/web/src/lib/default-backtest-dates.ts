/** ISO date (YYYY-MM-DD) for the last completed calendar month-end. */
export function lastCompletedMonthEnd(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based; month-end of previous month
  const end = new Date(y, m, 0); // day 0 of current month = last day of previous
  const yy = end.getFullYear();
  const mm = String(end.getMonth() + 1).padStart(2, "0");
  const dd = String(end.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export const DEFAULT_BACKTEST_START = "2018-01-01";

/** Minimum holdings so a book is not forced to all-at-cap equal weights.

Holdings must be strictly greater than ``1 / maxWeight`` → ``floor(1/w) + 1``.
*/
export function minHoldingsForCap(maxWeight: number, floor = 2): number {
  const w = Math.max(Number(maxWeight) || 0, 1e-12);
  if (w >= 1 - 1e-12) return Math.max(1, floor);
  return Math.max(Math.floor(1 / w) + 1, floor);
}

export function ensureMaxHoldingsForCap(
  maxWeight: number,
  maxHoldings: number,
  hardCap = 50,
): number {
  const need = minHoldingsForCap(maxWeight, 2);
  return Math.min(Math.max(Number(maxHoldings) || need, need), hardCap);
}

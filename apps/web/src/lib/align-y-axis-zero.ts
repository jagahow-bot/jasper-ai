/**
 * Min/max of values, always spanning 0 when data crosses or touches zero.
 *
 * When the data crosses zero and `minSideRatio` > 0, the smaller (minority)
 * side is expanded so it occupies at least that fraction of the total span.
 * This keeps a visible, padded negative band when metrics (Sharpe, CAGR,
 * Sortino, drawdown) go negative instead of squashing them into a sliver
 * against the axis edge.
 */
export function extentWithZero(
  values: number[],
  minSideRatio = 0,
): [number, number] {
  let min = 0;
  let max = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  if (min === max) {
    if (min === 0) return [-1, 1];
    if (min > 0) return [0, min * 1.1];
    return [min * 1.1, 0];
  }
  if (minSideRatio > 0 && min < 0 && max > 0) {
    const r = Math.min(minSideRatio, 0.49);
    const span = max - min;
    if (-min / span < r) min = (-r * max) / (1 - r);
    if (max / (max - min) < r) max = (-r * min) / (1 - r);
  }
  return [min, max];
}

export function zeroRatio(min: number, max: number): number {
  const span = max - min;
  if (span <= 0) return 0.5;
  return -min / span;
}

/** Domain includes 0 (all-positive → anchor at 0; all-negative → anchor at 0). */
function ensureIncludesZero([min, max]: [number, number]): [number, number] {
  if (min > 0) return [0, max];
  if (max < 0) return [min, 0];
  return [min, max];
}

function spansZero([min, max]: [number, number]): boolean {
  return min <= 0 && max >= 0 && max !== min;
}

function expandMinToZeroRatio(max: number, targetZ: number): number {
  if (targetZ >= 1 - 1e-9) return 0;
  return (max * targetZ) / (targetZ - 1);
}

function expandMaxToZeroRatio(min: number, targetZ: number): number {
  if (targetZ <= 1e-9) return 0;
  return (-min * (1 - targetZ)) / targetZ;
}

/** Align zero lines with the smallest domain expansion on either side. */
function alignZeroMinExpansion(
  left: [number, number],
  right: [number, number],
): [[number, number], [number, number]] {
  let [minL, maxL] = left;
  let [minR, maxR] = right;

  const zL = zeroRatio(minL, maxL);
  const zR = zeroRatio(minR, maxR);
  if (Math.abs(zL - zR) < 1e-6) {
    return [[minL, maxL], [minR, maxR]];
  }

  const spanL = maxL - minL;
  const spanR = maxR - minR;
  const leftZeroAtBottom = zL <= 1e-9;
  const leftZeroAtTop = zL >= 1 - 1e-9;
  const rightZeroAtBottom = zR <= 1e-9;
  const rightZeroAtTop = zR >= 1 - 1e-9;

  if (zL > zR) {
    if (rightZeroAtBottom || leftZeroAtTop) {
      minR = expandMinToZeroRatio(maxR, zL);
    } else {
      const newMinR = expandMinToZeroRatio(maxR, zL);
      const expandRight = maxR - newMinR - spanR;
      const newMaxL = expandMaxToZeroRatio(minL, zR);
      const expandLeft = newMaxL - maxL;

      if (expandLeft < expandRight) {
        maxL = newMaxL;
      } else {
        minR = newMinR;
      }
    }
  } else {
    if (leftZeroAtBottom || rightZeroAtTop) {
      minL = expandMinToZeroRatio(maxL, zR);
    } else {
      const newMaxR = expandMaxToZeroRatio(minR, zL);
      const expandRight = newMaxR - maxR;
      const newMinL = expandMinToZeroRatio(maxL, zR);
      const expandLeft = maxL - newMinL - spanL;

      if (expandRight < expandLeft) {
        maxR = newMaxR;
      } else {
        minL = newMinL;
      }
    }
  }

  return [[minL, maxL], [minR, maxR]];
}

const DEFAULT_PADDING = 0.1;

/** Pad domain while keeping the zero-line position fixed. */
function padDomainPreserveZero(
  [min, max]: [number, number],
  ratio = DEFAULT_PADDING,
): [number, number] {
  const z = zeroRatio(min, max);
  const span = max - min;
  const newSpan = span * (1 + 2 * ratio);
  return [-z * newSpan, (1 - z) * newSpan];
}

/**
 * Dual-Y domains with aligned zero lines when both axes include zero.
 * Handles mixed sign on one side (e.g. negative CAGR + positive MDD) and
 * all-positive on the other (e.g. Sharpe only).
 */
export function alignDualAxisZeroDomains(
  left: [number, number],
  right: [number, number],
): [[number, number], [number, number]] {
  const leftZ = ensureIncludesZero(left);
  const rightZ = ensureIncludesZero(right);

  if (!spansZero(leftZ) || !spansZero(rightZ)) {
    return [padDomainPreserveZero(leftZ), padDomainPreserveZero(rightZ)];
  }

  const [alignedLeft, alignedRight] = alignZeroMinExpansion(leftZ, rightZ);
  return [padDomainPreserveZero(alignedLeft), padDomainPreserveZero(alignedRight)];
}

/** Natural order for catalog codes (M0001, M0002, …). */
export function compareModelCode(a: string, b: string): number {
  const ma = /^M(\d+)$/i.exec(a.trim());
  const mb = /^M(\d+)$/i.exec(b.trim());
  if (ma && mb) return parseInt(ma[1], 10) - parseInt(mb[1], 10);
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

/** Tight upper bound: max(values) with ratio + absolute padding. */
export function tightMaxFromValues(
  values: number[],
  ratioPad = 0.06,
  absPad = 0.1,
): number {
  let max = -Infinity;
  for (const v of values) {
    if (Number.isFinite(v)) max = Math.max(max, v);
  }
  if (!Number.isFinite(max) || max === -Infinity) return 1;
  return Math.max(max * (1 + ratioPad), max + absPad);
}

/** Cap domain max while preserving the zero-line ratio. */
export function capDomainMax(
  domain: [number, number],
  maxCap: number,
): [number, number] {
  const [min, max] = domain;
  if (max <= maxCap) return domain;
  if (maxCap <= min) {
    const bump = Math.max(0.05, Math.abs(min) * 0.05 || 0.1);
    return [min, min + bump];
  }
  const z = zeroRatio(min, max);
  return [expandMinToZeroRatio(maxCap, z), maxCap];
}

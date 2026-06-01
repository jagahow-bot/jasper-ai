const WEIGHT_EPS = 0.0001;

export function minHoldingsForCap(maxWeight: number, floor = 5): number {
  return Math.max(Math.ceil(1 / maxWeight), floor);
}

export function projectMaxWeight(weights: number[], maxWeight: number): number[] {
  const w = weights.map((x) => Math.max(0, x));
  let sum = w.reduce((a, b) => a + b, 0);
  if (sum < 1e-12) return w;
  for (let i = 0; i < w.length; i++) w[i] /= sum;

  for (let iter = 0; iter < 100; iter++) {
    const mx = Math.max(...w);
    if (mx <= maxWeight + 1e-8) break;
    let surplus = 0;
    for (let i = 0; i < w.length; i++) {
      if (w[i] > maxWeight) {
        surplus += w[i] - maxWeight;
        w[i] = maxWeight;
      }
    }
    const underIdx = w.map((x, i) => (x < maxWeight - 1e-12 ? i : -1)).filter((i) => i >= 0);
    if (underIdx.length === 0 || surplus <= 0) break;
    const underSum = underIdx.reduce((a, i) => a + w[i], 0);
    if (underSum < 1e-12) break;
    for (const i of underIdx) w[i] += surplus * (w[i] / underSum);
  }
  sum = w.reduce((a, b) => a + b, 0);
  return sum > 0 ? w.map((x) => x / sum) : w;
}

export function buildFeasibleWeights(
  n: number,
  maxWeight: number,
  rand: () => number,
): number[] {
  const minK = minHoldingsForCap(maxWeight);
  const maxK = Math.min(n, 30);
  const k = minK + Math.floor(rand() * (maxK - minK + 1));

  for (let attempt = 0; attempt < 200; attempt++) {
    const indices = new Set<number>();
    while (indices.size < k) indices.add(Math.floor(rand() * n));
    const raw = Array.from(indices, () => rand());
    const sum = raw.reduce((a, b) => a + b, 0);
    const w = Array(n).fill(0);
    let i = 0;
    for (const idx of indices) w[idx] = raw[i++] / sum;
    const projected = projectMaxWeight(w, maxWeight);
    const active = projected.filter((x) => x > WEIGHT_EPS).length;
    const mx = Math.max(...projected);
    if (mx <= maxWeight + 1e-4 && active >= Math.min(minK, k)) return projected;
  }

  const w = Array(n).fill(0);
  const indices: number[] = [];
  while (indices.length < minK) {
    const idx = Math.floor(rand() * n);
    if (!indices.includes(idx)) indices.push(idx);
  }
  for (const idx of indices) w[idx] = 1 / indices.length;
  return projectMaxWeight(w, maxWeight);
}

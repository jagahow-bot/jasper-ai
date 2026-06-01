const NUMERIC_KEYS = [
  "top_sharpe",
  "top_max_drawdown",
  "top_cagr",
  "train_sharpe",
  "train_max_drawdown",
  "validation_sharpe",
  "validation_max_drawdown",
  "max_weight_constraint",
] as const;

function formatNum(n: number): string {
  const rounded = Math.round(n * 1000) / 1000;
  return String(rounded);
}

export function validateNarrative(
  text: string,
  facts: Record<string, unknown>,
): { ok: boolean; violations: string[] } {
  const allowed = new Set<string>();
  for (const key of NUMERIC_KEYS) {
    const v = facts[key];
    if (typeof v === "number" && !Number.isNaN(v)) {
      allowed.add(formatNum(v));
      allowed.add(formatNum(v * 100));
    }
  }

  const found = text.match(/-?\d+\.?\d*/g) ?? [];
  const violations: string[] = [];
  for (const raw of found) {
    const n = Number(raw);
    if (Number.isNaN(n)) continue;
    if (n >= 1900 && n <= 2100) continue;
    if (n === 0 || n === 1) continue;
    const f = formatNum(n);
    if (!allowed.has(f) && !allowed.has(raw)) {
      violations.push(raw);
    }
  }

  return { ok: violations.length === 0, violations: [...new Set(violations)] };
}

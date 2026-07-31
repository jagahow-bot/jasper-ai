import type { PortfolioCandidate } from "@/lib/types";

export type NeedsFloorRowKey =
  | "drawdown"
  | "singleName"
  | "theme"
  | "cash"
  | "income"
  | "mustInclude"
  | "drift";

export const NEEDS_TABLE_I18N: Record<NeedsFloorRowKey, string> = {
  drawdown: "results.needsTable.drawdown",
  singleName: "results.needsTable.singleName",
  theme: "results.needsTable.theme",
  cash: "results.needsTable.cash",
  income: "results.needsTable.income",
  mustInclude: "results.needsTable.mustInclude",
  drift: "results.needsTable.drift",
};

export type NeedsFloorRow = {
  key: NeedsFloorRowKey;
  pass: boolean | undefined;
  detail?: string;
};

function pct(v: number | undefined | null, digits = 1): string | null {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return `${(Number(v) * 100).toFixed(digits)}%`;
}

/** Build RM-facing needs ledger rows from champion/candidate attainment. */
export function needsFloorRows(
  na: PortfolioCandidate["needs_attainment"],
): NeedsFloorRow[] {
  if (!na) return [];
  const rows: NeedsFloorRow[] = [];

  if (na.max_drawdown_tolerance != null) {
    const actual = pct(na.max_drawdown_actual);
    const floor = pct(na.max_drawdown_tolerance);
    rows.push({
      key: "drawdown",
      pass: na.within_drawdown_tolerance,
      detail:
        actual && floor
          ? `${actual} / ${floor}`
          : actual ?? floor ?? undefined,
    });
  }
  if (na.max_single_name_pct != null) {
    const actual = pct(na.max_single_name_actual);
    const cap = pct(na.max_single_name_pct);
    rows.push({
      key: "singleName",
      pass: na.within_single_name_cap,
      detail: actual && cap ? `${actual} / ${cap}` : actual ?? cap ?? undefined,
    });
  }
  if (na.theme_exposure_cap_pct != null) {
    const actual = pct(na.theme_exposure_actual);
    const cap = pct(na.theme_exposure_cap_pct);
    rows.push({
      key: "theme",
      pass: na.within_theme_cap,
      detail: actual && cap ? `${actual} / ${cap}` : actual ?? cap ?? undefined,
    });
  }
  if (na.cash_reserve_pct != null) {
    const actual = pct(na.cash_weight_actual);
    const floor = pct(na.cash_reserve_pct);
    rows.push({
      key: "cash",
      pass: na.within_cash_reserve,
      detail:
        actual && floor ? `${actual} / ${floor}` : actual ?? floor ?? undefined,
    });
  }
  if (na.income_need_pct != null) {
    const actual = pct(na.income_actual);
    const need = pct(na.income_need_pct);
    rows.push({
      key: "income",
      pass: na.within_income_need,
      detail: actual && need ? `${actual} / ${need}` : actual ?? need ?? undefined,
    });
  }
  if (na.must_include_tickers != null || na.within_must_include != null) {
    const missing = na.missing_must_include ?? [];
    const required = na.must_include_tickers ?? [];
    rows.push({
      key: "mustInclude",
      pass: na.within_must_include,
      detail:
        missing.length > 0
          ? missing.join(", ")
          : required.length > 0
            ? required.join(", ")
            : undefined,
    });
  }
  if (
    na.customization_drift_cap != null ||
    na.within_customization_drift != null
  ) {
    const actual = pct(na.customization_drift_l1);
    const cap = pct(na.customization_drift_cap);
    rows.push({
      key: "drift",
      pass: na.within_customization_drift,
      detail: actual && cap ? `${actual} / ${cap}` : actual ?? cap ?? undefined,
    });
  }
  return rows;
}

export function needsAllPassed(
  na: PortfolioCandidate["needs_attainment"],
): boolean | null {
  const rows = needsFloorRows(na);
  if (!rows.length) return null;
  if (rows.some((r) => r.pass === false)) return false;
  if (rows.every((r) => r.pass === true)) return true;
  return null;
}

"use client";

import { useState } from "react";
import {
  NEEDS_TABLE_I18N,
  needsAllPassed,
  needsFloorRows,
  shouldEmphasizeClassQuota,
  type NeedsFloorRow,
} from "@/lib/needs-fulfillment";
import { useI18n } from "@/lib/i18n";
import type { PortfolioCandidate } from "@/lib/types";

export type ClassQuotaUnfilledItem = {
  asset_class: string;
  target_pct: number;
  reason?: string;
};

export type ClassQuotaInfeasibleItem = {
  asset_class: string;
  target_pct: number;
  max_weight?: number;
  required_names?: number;
  available_names?: number;
  feasible_max_pct?: number;
};

type Props = {
  needs: PortfolioCandidate["needs_attainment"];
  classQuotaUnfilled?: ClassQuotaUnfilledItem[] | null;
  classQuotaInfeasible?: ClassQuotaInfeasibleItem[] | null;
  className?: string;
};

function statusClass(pass: boolean | undefined): string {
  if (pass === true) return "text-emerald-700";
  if (pass === false) return "text-amber-800";
  return "text-dim";
}

function assetClassLabel(
  t: (key: string, params?: Record<string, string | number>) => string,
  assetClass: string,
): string {
  const key = `results.assetClass.${assetClass}`;
  const labeled = t(key);
  return labeled === key ? assetClass : labeled;
}

function NeedsRow({
  row,
  hint,
  emphasize,
}: {
  row: NeedsFloorRow;
  hint?: string;
  emphasize?: boolean;
}) {
  const { t } = useI18n();
  return (
    <tr
      key={row.key}
      className={`border-t border-[var(--border)] ${
        emphasize ? "bg-amber-50/60" : ""
      }`}
    >
      <td className="py-2 pr-3 font-medium">
        <div>{t(NEEDS_TABLE_I18N[row.key])}</div>
        {hint ? <div className="mt-0.5 text-xs font-normal text-dim">{hint}</div> : null}
      </td>
      <td className="py-2 pr-3 text-dim">{row.detail ?? "—"}</td>
      <td className={`py-2 text-right font-medium ${statusClass(row.pass)}`}>
        {row.pass == null
          ? "—"
          : row.pass
            ? t("results.needsTable.pass")
            : t("results.needsTable.fail")}
      </td>
    </tr>
  );
}

export function NeedsFulfillmentPanel({
  needs,
  classQuotaUnfilled,
  classQuotaInfeasible,
  className = "",
}: Props) {
  const { t } = useI18n();
  const rows: NeedsFloorRow[] = needsFloorRows(needs);
  const unfilled = classQuotaUnfilled?.filter(Boolean) ?? [];
  const infeasible = classQuotaInfeasible?.filter(Boolean) ?? [];
  if (!rows.length && !unfilled.length && !infeasible.length) return null;

  const classRow = rows.find((r) => r.key === "classQuota");
  const bandRow = rows.find((r) => r.key === "groupBands");
  const emphasizeQuota = shouldEmphasizeClassQuota({
    classQuotaPass: classRow?.pass,
    classQuotaUnfilledCount: unfilled.length,
  });
  // E10: only classQuota (no bands) → keep as primary, never hard-hide.
  const classQuotaAsSecondary = Boolean(classRow && bandRow);
  const primaryRows = rows.filter((r) => {
    if (r.key === "classQuota") return !classQuotaAsSecondary;
    return true;
  });
  const secondaryClassRow = classQuotaAsSecondary ? classRow : null;

  const [quotaExpanded, setQuotaExpanded] = useState(emphasizeQuota);

  const overall = needsAllPassed(needs);
  const border =
    overall === false || unfilled.length > 0 || infeasible.length > 0
      ? "border-amber-200 bg-amber-50/50"
      : overall === true
        ? "border-emerald-100 bg-emerald-50/40"
        : "border-[var(--border)]";

  const unfilledItems = unfilled
    .map((item) => {
      const label = assetClassLabel(t, item.asset_class);
      const pct = `${(Number(item.target_pct) * 100).toFixed(0)}%`;
      return `${label} (${pct})`;
    })
    .join(", ");

  const infeasibleItems = infeasible
    .map((item) => {
      const label = assetClassLabel(t, item.asset_class);
      const target = `${(Number(item.target_pct) * 100).toFixed(0)}%`;
      const feasible =
        item.feasible_max_pct != null
          ? `${(Number(item.feasible_max_pct) * 100).toFixed(0)}%`
          : "—";
      return `${label} (${target} → ${feasible})`;
    })
    .join(", ");

  const showSecondaryExpanded = emphasizeQuota || quotaExpanded;

  return (
    <section className={`pixel-panel ${border} ${className}`.trim()}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="ui-panel-title">{t("rm.report.needsTitle")}</h3>
          <p className="ui-hint mt-1">{t("rm.report.needsHint")}</p>
        </div>
        {overall != null ? (
          <span
            className={`pixel-badge text-xs ${
              overall && !unfilled.length && !infeasible.length
                ? "pixel-badge-cyan"
                : "pixel-badge-warn"
            }`}
          >
            {overall && !unfilled.length && !infeasible.length
              ? t("rm.report.needsOverallPass")
              : t("rm.report.needsOverallFail")}
          </span>
        ) : null}
      </div>
      {unfilled.length > 0 ? (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">
            {t("results.needsTable.classQuotaUnfilledTitle")}
          </p>
          <p className="mt-1">
            {t("results.needsClassQuotaUnfilled", { items: unfilledItems })}
          </p>
          <p className="mt-1 text-xs opacity-90">
            {t("results.needsClassQuotaUnfilledHint")}
          </p>
        </div>
      ) : null}
      {infeasible.length > 0 ? (
        <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">
            {t("results.needsTable.classQuotaInfeasibleTitle")}
          </p>
          <p className="mt-1">
            {t("results.needsClassQuotaInfeasible", { items: infeasibleItems })}
          </p>
          <p className="mt-1 text-xs opacity-90">
            {t("results.needsClassQuotaInfeasibleHint")}
          </p>
        </div>
      ) : null}
      {primaryRows.length > 0 ? (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[360px] text-left ui-body">
            <thead className="text-dim">
              <tr>
                <th className="pb-2 pr-3">{t("rm.report.needsColConstraint")}</th>
                <th className="pb-2 pr-3">{t("rm.report.needsColDetail")}</th>
                <th className="pb-2 text-right">{t("rm.report.needsColStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {primaryRows.map((row) => (
                <NeedsRow
                  key={row.key}
                  row={row}
                  hint={
                    row.key === "groupBands"
                      ? t("results.needsTable.groupBandsHint")
                      : row.key === "classQuota"
                        ? t("results.needsTable.classQuotaHint")
                        : undefined
                  }
                  emphasize={row.key === "classQuota" && emphasizeQuota}
                />
              ))}
              {secondaryClassRow && emphasizeQuota ? (
                <NeedsRow
                  key="classQuota-secondary"
                  row={secondaryClassRow}
                  hint={t("results.needsTable.classQuotaHint")}
                  emphasize
                />
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
      {secondaryClassRow && !emphasizeQuota ? (
        <div className="mt-3 rounded border border-[var(--border)]/70 bg-[var(--surface)]/40 px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm text-dim">
                {t("results.needsTable.classQuotaSecondary")}
              </p>
              <p className="mt-0.5 text-xs text-dim">
                {showSecondaryExpanded
                  ? secondaryClassRow.detail ?? "—"
                  : t("results.needsTable.classQuotaCollapsed")}
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 text-xs font-medium text-[var(--primary)] underline-offset-2 hover:underline"
              aria-expanded={showSecondaryExpanded}
              onClick={() => setQuotaExpanded((v) => !v)}
            >
              {showSecondaryExpanded
                ? t("results.needsTable.classQuotaCollapse")
                : t("results.needsTable.classQuotaExpand")}
            </button>
          </div>
          {showSecondaryExpanded ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[320px] text-left ui-body text-sm">
                <tbody>
                  <NeedsRow
                    row={secondaryClassRow}
                    hint={t("results.needsTable.classQuotaHint")}
                  />
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
      {(bandRow || classRow) && (
        <p className="ui-hint mt-3 text-xs opacity-80">
          {t("rm.report.needsPrimaryBandNote")}
        </p>
      )}
      <p className="ui-hint mt-2 text-xs opacity-80">
        {t("rm.report.needsDetailHint")}
      </p>
    </section>
  );
}

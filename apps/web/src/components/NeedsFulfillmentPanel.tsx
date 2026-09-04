"use client";

import {
  NEEDS_TABLE_I18N,
  needsAllPassed,
  needsFloorRows,
  type NeedsFloorRow,
} from "@/lib/needs-fulfillment";
import { useI18n } from "@/lib/i18n";
import type { PortfolioCandidate } from "@/lib/types";

export type ClassQuotaUnfilledItem = {
  asset_class: string;
  target_pct: number;
  reason?: string;
};

type Props = {
  needs: PortfolioCandidate["needs_attainment"];
  classQuotaUnfilled?: ClassQuotaUnfilledItem[] | null;
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

export function NeedsFulfillmentPanel({
  needs,
  classQuotaUnfilled,
  className = "",
}: Props) {
  const { t } = useI18n();
  const rows: NeedsFloorRow[] = needsFloorRows(needs);
  const unfilled = classQuotaUnfilled?.filter(Boolean) ?? [];
  if (!rows.length && !unfilled.length) return null;

  const overall = needsAllPassed(needs);
  const border =
    overall === false || unfilled.length > 0
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
              overall && !unfilled.length ? "pixel-badge-cyan" : "pixel-badge-warn"
            }`}
          >
            {overall && !unfilled.length
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
      {rows.length > 0 ? (
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
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-[var(--border)]">
                  <td className="py-2 pr-3 font-medium">
                    {t(NEEDS_TABLE_I18N[row.key])}
                  </td>
                  <td className="py-2 pr-3 text-dim">{row.detail ?? "—"}</td>
                  <td
                    className={`py-2 text-right font-medium ${statusClass(row.pass)}`}
                  >
                    {row.pass == null
                      ? "—"
                      : row.pass
                        ? t("results.needsTable.pass")
                        : t("results.needsTable.fail")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="ui-hint mt-3 text-xs opacity-80">
        {t("rm.report.needsDetailHint")}
      </p>
    </section>
  );
}

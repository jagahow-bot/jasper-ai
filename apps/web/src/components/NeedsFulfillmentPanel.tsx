"use client";

import {
  NEEDS_TABLE_I18N,
  needsAllPassed,
  needsFloorRows,
  type NeedsFloorRow,
} from "@/lib/needs-fulfillment";
import { useI18n } from "@/lib/i18n";
import type { PortfolioCandidate } from "@/lib/types";

type Props = {
  needs: PortfolioCandidate["needs_attainment"];
  className?: string;
};

function statusClass(pass: boolean | undefined): string {
  if (pass === true) return "text-emerald-700";
  if (pass === false) return "text-amber-800";
  return "text-dim";
}

export function NeedsFulfillmentPanel({ needs, className = "" }: Props) {
  const { t } = useI18n();
  const rows: NeedsFloorRow[] = needsFloorRows(needs);
  if (!rows.length) return null;

  const overall = needsAllPassed(needs);
  const border =
    overall === false
      ? "border-amber-200 bg-amber-50/50"
      : overall === true
        ? "border-emerald-100 bg-emerald-50/40"
        : "border-[var(--border)]";

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
              overall ? "pixel-badge-cyan" : "pixel-badge-warn"
            }`}
          >
            {overall
              ? t("rm.report.needsOverallPass")
              : t("rm.report.needsOverallFail")}
          </span>
        ) : null}
      </div>
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
      <p className="ui-hint mt-3 text-xs opacity-80">
        {t("rm.report.needsDetailHint")}
      </p>
    </section>
  );
}

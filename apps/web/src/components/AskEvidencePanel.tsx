"use client";

import {
  evaluateAskEvidence,
  groupTickerMapFromHoldingsGroups,
  type AskEvidenceStatus,
} from "@/lib/ask-evidence";
import type { DemoClient } from "@/lib/clients";
import { useI18n } from "@/lib/i18n";
import type { ClientOverlay } from "@/lib/overlay-schema";
import type { Objective, PortfolioCandidate } from "@/lib/types";

type Props = {
  overlay: ClientOverlay | null;
  weights?: Record<string, number> | null;
  needs?: PortfolioCandidate["needs_attainment"];
  objective?: Objective | string | null;
  client?: DemoClient | null;
  className?: string;
};

function statusClass(status: AskEvidenceStatus): string {
  if (status === "met") return "text-emerald-700";
  if (status === "partial") return "text-amber-800";
  if (status === "missed") return "text-rose-700";
  return "text-dim";
}

function statusKey(status: AskEvidenceStatus): string {
  if (status === "met") return "rm.report.askStatus.met";
  if (status === "partial") return "rm.report.askStatus.partial";
  if (status === "missed") return "rm.report.askStatus.missed";
  return "rm.report.askStatus.unknown";
}

export function AskEvidencePanel({
  overlay,
  weights,
  needs,
  objective,
  client = null,
  className = "",
}: Props) {
  const { t } = useI18n();
  const asks = overlay?.asks ?? [];
  if (!asks.length) return null;

  const groupTickers = groupTickerMapFromHoldingsGroups(client?.holdings_groups);
  const rows = evaluateAskEvidence(asks, {
    weights,
    needs,
    objective,
    groupTickers,
  });

  const hasMiss = rows.some((r) => r.status === "missed");
  const allMet = rows.length > 0 && rows.every((r) => r.status === "met");
  const border = hasMiss
    ? "border-amber-200 bg-amber-50/40"
    : allMet
      ? "border-emerald-100 bg-emerald-50/40"
      : "border-[var(--border)]";

  return (
    <section className={`pixel-panel ${border} ${className}`.trim()}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="ui-panel-title">{t("rm.report.askEvidenceTitle")}</h3>
          <p className="ui-hint mt-1">{t("rm.report.askEvidenceHint")}</p>
        </div>
        <span
          className={`pixel-badge text-xs ${
            allMet ? "pixel-badge-cyan" : "pixel-badge-warn"
          }`}
        >
          {allMet
            ? t("rm.report.askEvidenceAllMet")
            : t("rm.report.askEvidenceGapsOk")}
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {rows.map((row, i) => (
          <div
            key={row.ask.id}
            className="rounded-md border border-[var(--border)]/70 bg-[var(--surface)]/60 px-3 py-2"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--foreground)]">
                  <span className="text-dim">{i + 1}.</span> {row.ask.title}
                </p>
                <p className="mt-0.5 text-xs text-dim">{row.ask.summary}</p>
              </div>
              <span
                className={`shrink-0 text-xs font-semibold ${statusClass(row.status)}`}
              >
                {t(statusKey(row.status))}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-[1fr_1fr]">
              <div>
                <span className="text-dim">{t("rm.report.askColTarget")}: </span>
                <span className="font-medium">{row.targetLabel}</span>
              </div>
              <div>
                <span className="text-dim">{t("rm.report.askColActual")}: </span>
                <span className="font-medium">{row.actualLabel}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="ui-hint mt-3 text-xs opacity-80">
        {t("rm.report.askEvidenceSoftNote")}
      </p>
    </section>
  );
}

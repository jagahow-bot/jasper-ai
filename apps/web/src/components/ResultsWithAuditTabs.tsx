"use client";

import { useState, type ReactNode } from "react";
import { AuditRawDataPanel } from "@/components/AuditRawDataPanel";
import { useI18n } from "@/lib/i18n";
import type { ClientOverlay } from "@/lib/overlay-schema";
import type { BacktestRequest, BacktestResult } from "@/lib/types";

type TabId = "engine" | "audit";

type Props = {
  result: BacktestResult;
  request: BacktestRequest;
  overlay?: ClientOverlay | null;
  /** Engine detail content (ResultsDashboard / ProResultsWithTabs). */
  children: ReactNode;
};

/**
 * Top-level Engine detail | Audit / Raw data tabs for non-RM result flows.
 * RmReportView embeds AuditRawDataPanel as its own third tab instead.
 */
export function ResultsWithAuditTabs({
  result,
  request,
  overlay = null,
  children,
}: Props) {
  const { t } = useI18n();
  const [tab, setTab] = useState<TabId>("engine");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setTab("engine")}
          className={`pixel-chip ${tab === "engine" ? "pixel-chip-active" : ""}`}
        >
          {t("results.audit.tabEngine")}
        </button>
        <button
          type="button"
          onClick={() => setTab("audit")}
          className={`pixel-chip ${tab === "audit" ? "pixel-chip-active" : ""}`}
        >
          {t("results.audit.tabAudit")}
        </button>
      </div>
      {tab === "audit" ? (
        <AuditRawDataPanel
          result={result}
          request={request}
          overlay={overlay}
        />
      ) : (
        children
      )}
    </div>
  );
}

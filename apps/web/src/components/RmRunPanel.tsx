"use client";

import { useState } from "react";
import { ConstraintsPanel } from "@/components/ConstraintsPanel";
import { formatOverlaySummary } from "@/lib/overlay-schema";
import type { ClientOverlay } from "@/lib/overlay-schema";
import { getCustomizedVsAnchorLabel } from "@/lib/model-portfolios";
import type { ModelPortfolio } from "@/lib/model-portfolios";
import { useI18n } from "@/lib/i18n";
import { combinedUniverseFromRequest, countUniverse } from "@/lib/universe";
import type { BacktestRequest } from "@/lib/types";

type Props = {
  overlay: ClientOverlay;
  anchorPortfolio: ModelPortfolio;
  request: BacktestRequest;
  onChange: (next: BacktestRequest) => void;
  onRun: () => void;
  apiOnline?: boolean | null;
  emailNotificationsEnabled?: boolean | null;
};

export function RmRunPanel({
  overlay,
  anchorPortfolio,
  request,
  onChange,
  onRun,
  apiOnline,
  emailNotificationsEnabled,
}: Props) {
  const { t, lang } = useI18n();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const summary = formatOverlaySummary(overlay, lang);
  const customizedLabel = getCustomizedVsAnchorLabel(anchorPortfolio, lang);
  const universeCount = countUniverse(combinedUniverseFromRequest(request));

  return (
    <div className="space-y-4">
      <div className="pixel-panel">
        <h2 className="ui-panel-title">{t("rm.run.title")}</h2>
        <p className="ui-body mt-2 text-dim">{t("rm.run.subtitle")}</p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="saas-inset">
            <p className="ui-section-title">
              {t("rm.run.clientNeeds")}
            </p>
            <pre className="ui-body mt-2 whitespace-pre-wrap">
              {summary}
            </pre>
          </div>
          <div className="saas-inset">
            <p className="ui-section-title text-[var(--amber)]">
              {t("rm.run.whatWillRun")}
            </p>
            <ul className="ui-body mt-2 list-disc space-y-1 pl-4">
              <li>{customizedLabel}</li>
              <li>
                {t("rm.run.period", {
                  start: request.start_date,
                  end: request.end_date,
                })}
              </li>
              <li>{t("rm.run.dualTrack")}</li>
              <li>{t("rm.universe.fixedCount", { n: universeCount })}</li>
            </ul>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onRun}
            disabled={apiOnline === false}
            className="pixel-btn min-w-[12rem]"
          >
            {t("rm.run.execute")}
          </button>
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="pixel-btn border border-[var(--border)] bg-white text-sm text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
          >
            {showAdvanced ? t("rm.run.hideAdvanced") : t("rm.run.showAdvanced")}
          </button>
        </div>
        {apiOnline === false && (
          <p className="ui-hint mt-2 text-[var(--amber)]">{t("header.apiOfflineHint")}</p>
        )}
      </div>

      {showAdvanced && (
        <ConstraintsPanel
          value={request}
          onChange={onChange}
          onRun={onRun}
          apiOnline={apiOnline}
          emailNotificationsEnabled={emailNotificationsEnabled}
          universeReadOnly
        />
      )}
    </div>
  );
}

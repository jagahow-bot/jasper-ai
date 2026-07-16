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
  const lockedTickers = [
    ...new Set([
      ...(request.universe_tickers ?? []).map((t) => t.toUpperCase()),
      ...(request.universe_supplement_tickers ?? []).map((t) => t.toUpperCase()),
    ]),
  ];
  const isPro = request.optimization_mode === "pro_auto";

  const setProSearch = (on: boolean) => {
    onChange({
      ...request,
      optimization_mode: on ? "pro_auto" : "standard",
      enable_iterative_refinement: on,
    });
  };

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
              <li>
                {lockedTickers.length
                  ? t("rm.universe.lockedCount", { n: universeCount })
                  : t("rm.universe.fixedCount", { n: universeCount })}
              </li>
              {lockedTickers.length > 0 ? (
                <li className="list-none pl-0 text-xs text-dim">
                  {lockedTickers.join(", ")}
                </li>
              ) : null}
              <li>
                {isPro
                  ? t("rm.run.proSearchOn")
                  : t("rm.run.proSearchOff")}
              </li>
            </ul>
          </div>
        </div>

        <div
          className={`mt-4 rounded-lg border p-4 ${
            isPro
              ? "border-amber-200 bg-amber-50"
              : "border-[var(--border)] bg-[var(--surface-2)]"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="ui-section-title text-[var(--amber)]">
                {t("rm.run.proSearchTitle")}
              </h3>
              <p className="mt-1 text-sm text-dim">
                {t("rm.run.proSearchHint")}
              </p>
            </div>
            <label className="flex shrink-0 cursor-pointer items-center gap-2">
              <span className="text-xs text-dim">
                {isPro ? t("common.on") : t("common.off")}
              </span>
              <input
                type="checkbox"
                checked={isPro}
                onChange={(e) => setProSearch(e.target.checked)}
                className="h-4 w-4 accent-[var(--amber)]"
                aria-label={t("rm.run.proSearchTitle")}
              />
            </label>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-4">
          <label className="block space-y-2">
            <span className="ui-label">{t("config.notifyEmail")}</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={request.notify_email ?? ""}
              onChange={(e) =>
                onChange({
                  ...request,
                  notify_email: e.target.value || null,
                })
              }
              placeholder={t("config.notifyEmailPlaceholder")}
              className="pixel-input"
            />
            <p className="ui-hint">{t("config.notifyEmailHint")}</p>
            {request.notify_email?.trim() &&
            emailNotificationsEnabled === false ? (
              <p className="ui-hint text-[var(--amber)]">
                {t("config.notifyEmailSmtpDisabled")}
              </p>
            ) : null}
          </label>
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

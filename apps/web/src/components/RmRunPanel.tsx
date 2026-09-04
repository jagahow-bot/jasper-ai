"use client";

import { useMemo, useState } from "react";
import { ConstraintsPanel } from "@/components/ConstraintsPanel";
import {
  computeOverlayDriftHints,
  type OverlayDriftHints,
} from "@/lib/overlay-drift-sync";
import { formatOverlaySummary } from "@/lib/overlay-schema";
import type { ClientOverlay } from "@/lib/overlay-schema";
import { getCustomizedVsAnchorLabel } from "@/lib/model-portfolios";
import type { ModelPortfolio } from "@/lib/model-portfolios";
import { useI18n } from "@/lib/i18n";
import { combinedUniverseFromRequest, countUniverse } from "@/lib/universe";
import type { BacktestRequest } from "@/lib/types";

type DriftSyncNotice = {
  from: number;
  to: number;
  requiresSupervisor: boolean;
};

type Props = {
  overlay: ClientOverlay;
  anchorPortfolio: ModelPortfolio;
  request: BacktestRequest;
  onChange: (next: BacktestRequest) => void;
  onRun: () => void;
  apiOnline?: boolean | null;
  emailNotificationsEnabled?: boolean | null;
  driftSyncNotice?: DriftSyncNotice | null;
  onDismissDriftSyncNotice?: () => void;
};

function DriftFloorRuler({
  hints,
  t,
}: {
  hints: OverlayDriftHints;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  if (hints.minRequiredDrift <= 0) return null;
  const pct = Math.round(hints.minRequiredDrift * 100);
  const left = `${hints.minRequiredDrift * 100}%`;
  return (
    <div className="mt-2 space-y-1">
      <div className="relative h-1.5 rounded bg-[var(--border)]">
        <div
          className={`absolute inset-y-0 left-0 rounded ${
            hints.feasible ? "bg-emerald-300/50" : "bg-amber-300/60"
          }`}
          style={{ width: left }}
        />
        <div
          className="absolute -top-1 -bottom-1 w-0.5 bg-amber-500"
          style={{ left, transform: "translateX(-50%)" }}
        />
      </div>
      <p className="text-[10px] text-dim">
        {t("rm.run.driftFloorMarker", { pct })}
      </p>
    </div>
  );
}

export function RmRunPanel({
  overlay,
  anchorPortfolio,
  request,
  onChange,
  onRun,
  apiOnline,
  emailNotificationsEnabled,
  driftSyncNotice = null,
  onDismissDriftSyncNotice,
}: Props) {
  const { t, lang } = useI18n();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pendingLowerDrift, setPendingLowerDrift] = useState<number | null>(
    null,
  );
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

  const anchorWeights = useMemo(
    () =>
      Object.fromEntries(
        anchorPortfolio.holdings
          .filter((h) => h.weight > 0)
          .map((h) => [h.ticker.toUpperCase(), h.weight]),
      ),
    [anchorPortfolio],
  );
  const driftHints = useMemo(
    () =>
      computeOverlayDriftHints(overlay, {
        anchorWeights,
        currentDrift: request.customization_drift ?? 0.5,
      }),
    [overlay, anchorWeights, request.customization_drift],
  );

  const setProSearch = (on: boolean) => {
    onChange({
      ...request,
      optimization_mode: on ? "pro_auto" : "standard",
      enable_iterative_refinement: on,
    });
  };

  const onDriftSliderChange = (next: number) => {
    const floor = driftHints.minRequiredDrift;
    const cur = request.customization_drift ?? 0.5;
    if (floor > 0 && next < floor - 1e-9 && cur >= floor - 1e-9) {
      setPendingLowerDrift(next);
      return;
    }
    setPendingLowerDrift(null);
    onChange({ ...request, customization_drift: next });
  };

  const sourceLine =
    driftHints.sources.length > 0
      ? t("overlay.driftSync.sourceLine", {
          sources: driftHints.sources
            .slice(0, 3)
            .map((s) => s.ref)
            .join(lang === "zh" ? "、" : ", "),
        })
      : null;

  return (
    <div className="space-y-4">
      <div className="pixel-panel">
        <h2 className="ui-panel-title">{t("rm.run.title")}</h2>
        <p className="ui-body mt-2 text-dim">{t("rm.run.subtitle")}</p>

        {driftSyncNotice ? (
          <div
            className={`mt-3 flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${
              driftSyncNotice.requiresSupervisor
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}
          >
            <div className="space-y-0.5">
              <p>
                {driftSyncNotice.requiresSupervisor
                  ? t("overlay.driftSync.raisedSupervisor", {
                      to: Math.round(driftSyncNotice.to * 100),
                    })
                  : t("overlay.driftSync.raised", {
                      from: Math.round(driftSyncNotice.from * 100),
                      to: Math.round(driftSyncNotice.to * 100),
                    })}
              </p>
              {sourceLine ? (
                <p className="text-xs opacity-80">{sourceLine}</p>
              ) : null}
            </div>
            {onDismissDriftSyncNotice ? (
              <button
                type="button"
                onClick={onDismissDriftSyncNotice}
                className="shrink-0 text-lg leading-none opacity-60 hover:opacity-100"
                aria-label="Dismiss"
              >
                ×
              </button>
            ) : null}
          </div>
        ) : null}

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
            <span className="ui-label flex flex-wrap items-center gap-2">
              {t("config.customizationDrift", {
                pct: Math.round((request.customization_drift ?? 0.5) * 100),
              })}
              {driftHints.requiresSupervisor ? (
                <span className="pixel-badge pixel-badge-warn">
                  {t("rm.run.driftSupervisorBadge")}
                </span>
              ) : null}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round((request.customization_drift ?? 0.5) * 100)}
              onChange={(e) =>
                onDriftSliderChange(Number(e.target.value) / 100)
              }
              className="w-full"
            />
            <DriftFloorRuler hints={driftHints} t={t} />
            {!driftHints.feasible && driftHints.minRequiredDrift > 0 ? (
              <p className="text-xs text-amber-700">
                {t("rm.run.driftBelowFloorWarning", {
                  current: Math.round((request.customization_drift ?? 0.5) * 100),
                  pct: Math.round(driftHints.minRequiredDrift * 100),
                })}
              </p>
            ) : null}
            {pendingLowerDrift != null ? (
              <div className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <p className="font-medium">
                  {t("rm.run.driftLowerConfirmTitle")}
                </p>
                <p className="mt-1">
                  {t("rm.run.driftLowerConfirmBody", {
                    to: Math.round(pendingLowerDrift * 100),
                    pct: Math.round(driftHints.minRequiredDrift * 100),
                  })}
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    className="pixel-btn px-2 py-1 text-xs"
                    onClick={() => {
                      onChange({
                        ...request,
                        customization_drift: pendingLowerDrift,
                      });
                      setPendingLowerDrift(null);
                    }}
                  >
                    {t("rm.run.driftLowerConfirmOk")}
                  </button>
                  <button
                    type="button"
                    className="pixel-btn border border-[var(--border)] bg-white px-2 py-1 text-xs text-[var(--ui-color-body)]"
                    onClick={() => setPendingLowerDrift(null)}
                  >
                    {t("rm.run.driftLowerConfirmCancel")}
                  </button>
                </div>
              </div>
            ) : null}
            <p className="ui-hint">{t("config.customizationDriftHint")}</p>
          </label>
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
          driftFloorHint={driftHints}
        />
      )}
    </div>
  );
}

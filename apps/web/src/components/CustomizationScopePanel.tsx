"use client";

import { useMemo } from "react";
import {
  countSelectedModelGroups,
  formatUsd,
  getClientHoldingsGroups,
  holdingsGroupLabel,
  holdingsGroupWeight,
  type DemoClient,
} from "@/lib/clients";
import { useI18n } from "@/lib/i18n";

type Props = {
  client: DemoClient;
  selectedGroupIds: string[];
  onSelectedGroupIdsChange: (ids: string[]) => void;
  portfolioName: string;
  onPortfolioNameChange: (name: string) => void;
};

export function CustomizationScopePanel({
  client,
  selectedGroupIds,
  onSelectedGroupIdsChange,
  portfolioName,
  onPortfolioNameChange,
}: Props) {
  const { t, lang } = useI18n();
  const groups = useMemo(() => getClientHoldingsGroups(client), [client]);
  const multiModel = countSelectedModelGroups(groups, selectedGroupIds) > 1;

  const toggle = (id: string) => {
    const selected = selectedGroupIds.includes(id);
    if (selected && selectedGroupIds.length <= 1) return;
    onSelectedGroupIdsChange(
      selected
        ? selectedGroupIds.filter((g) => g !== id)
        : [...selectedGroupIds, id],
    );
  };

  return (
    <div className="pixel-panel space-y-4">
      <div>
        <h2 className="ui-panel-title">{t("customization.optimizeScopeTitle")}</h2>
        <p className="mt-1 ui-hint">{t("customization.optimizeScopeHint")}</p>
      </div>

      {multiModel ? (
        <p className="rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-2 text-sm text-[var(--ui-color-body)]">
          {t("customization.multiModelNotice")}
        </p>
      ) : null}

      <ul className="space-y-2">
        {groups.map((group) => {
          const checked = selectedGroupIds.includes(group.id);
          const disabled = checked && selectedGroupIds.length <= 1;
          const weight = holdingsGroupWeight(group);
          const amountLabel =
            client.aum_usd > 0 && weight >= 0
              ? formatUsd(client.aum_usd * weight, lang)
              : "—";
          const weightLabel = `${(weight * 100).toFixed(1)}%`;
          return (
            <li key={group.id}>
              <label
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm transition ${
                  checked
                    ? "border-[var(--primary)]/40 bg-[var(--primary)]/5"
                    : "border-[var(--border)] bg-white"
                } ${disabled ? "cursor-not-allowed" : ""}`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-[var(--primary)]"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggle(group.id)}
                  />
                  <span className="font-medium">{holdingsGroupLabel(group, lang, t)}</span>
                </span>
                <span
                  className={`shrink-0 text-right text-xs tabular-nums ${
                    checked ? "text-[var(--text-dim)]" : "text-[var(--text-dim)] opacity-60"
                  }`}
                >
                  <span>
                    {t("clients.amount")}: {amountLabel}
                  </span>
                  <span className="ml-2">
                    {t("clients.weight")}: {weightLabel}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>

      <div>
        <label
          htmlFor="portfolio-name"
          className="mb-1 block text-sm font-medium text-[var(--ui-color-body)]"
        >
          {t("customization.portfolioName")}
        </label>
        <input
          id="portfolio-name"
          type="text"
          value={portfolioName}
          onChange={(e) => onPortfolioNameChange(e.target.value)}
          placeholder={t("customization.portfolioNamePlaceholder")}
          className="w-full rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm shadow-sm focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
        />
      </div>
    </div>
  );
}

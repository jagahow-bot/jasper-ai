"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { useI18n, riskProfileLabel } from "@/lib/i18n";
import { etfDisplayName } from "@/lib/etf-display-name";
import {
  getAmThemeLabel,
  getAssetManagerLabel,
  getPortfolioDescription,
  getPortfolioLabel,
} from "@/lib/model-portfolios";
import {
  readManagedPortfolios,
  setModelPortfolioEnabled,
  type ManagedModelPortfolio,
} from "@/lib/model-portfolios-store";
import { readInvestmentPool } from "@/lib/investment-pool";

export default function ModelPortfoliosPage() {
  const { t, lang } = useI18n();
  const [portfolios, setPortfolios] = useState<ManagedModelPortfolio[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setPortfolios(readManagedPortfolios(readInvestmentPool()));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const enabledOk = useMemo(
    () =>
      portfolios.filter((p) => p.enabled && p.conflict_tickers.length === 0)
        .length,
    [portfolios],
  );

  const onToggle = (id: string, enabled: boolean) => {
    setPortfolios(setModelPortfolioEnabled(id, enabled, readInvestmentPool()));
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppNav
        subtitle={t("models.subtitle")}
        extraBadges={
          <span className="pixel-badge pixel-badge-cyan">
            {t("models.countBadge", {
              ready: enabledOk,
              total: portfolios.length,
            })}
          </span>
        }
      />
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <div className="grid gap-3">
          {portfolios.map((p) => {
            const conflict = p.conflict_tickers.length > 0;
            const open = expandedId === p.id;
            const label = getPortfolioLabel(p, lang);
            return (
              <div
                key={p.id}
                className={`pixel-panel ${
                  conflict ? "border-[var(--amber)]" : ""
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="pixel-badge pixel-badge-cyan">
                        {getAssetManagerLabel(p, lang)}
                      </span>
                      <h2 className="text-base font-semibold text-[var(--foreground)]">
                        {label}
                      </h2>
                      <span className="pixel-badge">
                        {riskProfileLabel(t, p.risk_level)}
                      </span>
                      {conflict ? (
                        <span className="pixel-badge pixel-badge-warn">
                          {t("models.conflictBadge")}
                        </span>
                      ) : null}
                      {!p.enabled ? (
                        <span className="pixel-badge">{t("models.disabled")}</span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-[var(--text-dim)]">
                      {getAmThemeLabel(p, lang)} · {p.id} ·{" "}
                      {t("models.benchmark")} {p.benchmark}
                    </p>
                    <p className="mt-2 text-sm text-[var(--ui-color-body)]">
                      {getPortfolioDescription(p, lang)}
                    </p>
                    <p className="mt-2 text-sm text-[var(--primary)]">
                      {p.holdings
                        .map((h) => `${h.ticker} ${(h.weight * 100).toFixed(0)}%`)
                        .join(" · ")}
                    </p>
                    <p className="mt-1 text-[11px] text-[var(--text-dim)]">
                      {t("models.issuerHoldingsHint")}
                    </p>
                    {conflict ? (
                      <p className="mt-2 text-sm text-[var(--amber)]">
                        {t("models.conflictTickers")}:{" "}
                        {p.conflict_tickers.join(", ")}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={p.enabled}
                        onChange={(e) => onToggle(p.id, e.target.checked)}
                      />
                      {t("models.enabled")}
                    </label>
                    <button
                      type="button"
                      className="text-sm text-[var(--primary)] hover:underline"
                      onClick={() =>
                        setExpandedId(open ? null : p.id)
                      }
                    >
                      {open ? t("models.hideHoldings") : t("models.showHoldings")}
                    </button>
                  </div>
                </div>
                {open ? (
                  <table className="mt-4 w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[var(--text-dim)]">
                        <th className="py-1 font-medium">{t("pool.col.ticker")}</th>
                        <th className="py-1 font-medium">{t("pool.col.name")}</th>
                        <th className="py-1 text-right font-medium">
                          {t("clients.weight")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.holdings.map((h) => (
                        <tr key={h.ticker} className="border-b border-[var(--border)]/50">
                          <td className="py-1.5 font-medium">{h.ticker}</td>
                          <td className="py-1.5">{etfDisplayName(h.ticker, lang)}</td>
                          <td className="py-1.5 text-right tabular-nums">
                            {(h.weight * 100).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

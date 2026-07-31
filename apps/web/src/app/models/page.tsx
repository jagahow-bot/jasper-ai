"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { resolveHoldingProductType, tagClassForRisk } from "@/lib/clients";
import { useI18n, productTypeLabel, riskProfileLabel } from "@/lib/i18n";
import { etfDisplayName } from "@/lib/etf-display-name";
import {
  getAssetManagerLabel,
  getPortfolioDescription,
  getPortfolioLabel,
} from "@/lib/model-portfolios";
import {
  readManagedPortfolios,
  type ManagedModelPortfolio,
} from "@/lib/model-portfolios-store";
import { readInvestmentPool } from "@/lib/investment-pool";

type SortKey = "name" | "issuer" | "risk" | "theme";

const RISK_SORT_ORDER: Record<string, number> = {
  conservative: 0,
  moderate_conservative: 1,
  moderate: 2,
  moderate_aggressive: 3,
  aggressive: 4,
};

export default function ModelPortfoliosPage() {
  const { t, lang } = useI18n();
  const [portfolios, setPortfolios] = useState<ManagedModelPortfolio[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterAm, setFilterAm] = useState("all");
  const [filterRisk, setFilterRisk] = useState("all");
  const [filterTheme, setFilterTheme] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");

  const refresh = useCallback(() => {
    setPortfolios(readManagedPortfolios(readInvestmentPool()));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const amOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of portfolios) {
      const id = p.am_id || p.asset_manager;
      if (!map.has(id)) map.set(id, getAssetManagerLabel(p, lang));
    }
    return [...map.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, lang));
  }, [portfolios, lang]);

  const riskOptions = useMemo(() => {
    const levels = [...new Set(portfolios.map((p) => p.risk_level))];
    return levels.sort(
      (a, b) =>
        (RISK_SORT_ORDER[a] ?? 99) - (RISK_SORT_ORDER[b] ?? 99) ||
        a.localeCompare(b),
    );
  }, [portfolios]);

  const themeOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of portfolios) {
      const key = p.theme || p.name || p.id;
      if (!map.has(key)) map.set(key, getPortfolioLabel(p, lang));
    }
    return [...map.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, lang));
  }, [portfolios, lang]);

  const visible = useMemo(() => {
    const filtered = portfolios.filter((p) => {
      if (filterAm !== "all" && (p.am_id || p.asset_manager) !== filterAm) {
        return false;
      }
      if (filterRisk !== "all" && p.risk_level !== filterRisk) return false;
      const themeKey = p.theme || p.name || p.id;
      if (filterTheme !== "all" && themeKey !== filterTheme) return false;
      return true;
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (sortKey === "risk") {
        const ra = RISK_SORT_ORDER[a.risk_level] ?? 99;
        const rb = RISK_SORT_ORDER[b.risk_level] ?? 99;
        if (ra !== rb) return ra - rb;
      } else if (sortKey === "issuer") {
        const cmp = getAssetManagerLabel(a, lang).localeCompare(
          getAssetManagerLabel(b, lang),
          lang,
        );
        if (cmp !== 0) return cmp;
      }
      // name / theme (and risk/issuer tie-break): localized theme label
      return getPortfolioLabel(a, lang).localeCompare(
        getPortfolioLabel(b, lang),
        lang,
      );
    });
    return sorted;
  }, [portfolios, filterAm, filterRisk, filterTheme, sortKey, lang]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppNav subtitle={t("models.subtitle")} />
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <div className="pixel-panel">
          <div className="flex flex-wrap gap-2">
            <select
              value={filterAm}
              onChange={(e) => setFilterAm(e.target.value)}
              className="pixel-input"
              aria-label={t("models.filter.am")}
            >
              <option value="all">{t("models.filter.allAm")}</option>
              {amOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              value={filterRisk}
              onChange={(e) => setFilterRisk(e.target.value)}
              className="pixel-input"
              aria-label={t("models.filter.risk")}
            >
              <option value="all">{t("models.filter.allRisk")}</option>
              {riskOptions.map((r) => (
                <option key={r} value={r}>
                  {riskProfileLabel(t, r)}
                </option>
              ))}
            </select>
            <select
              value={filterTheme}
              onChange={(e) => setFilterTheme(e.target.value)}
              className="pixel-input"
              aria-label={t("models.filter.theme")}
            >
              <option value="all">{t("models.filter.allThemes")}</option>
              {themeOptions.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="pixel-input"
              aria-label={t("models.sort.label")}
            >
              <option value="name">{t("models.sort.name")}</option>
              <option value="issuer">{t("models.sort.issuer")}</option>
              <option value="risk">{t("models.sort.risk")}</option>
              <option value="theme">{t("models.sort.theme")}</option>
            </select>
          </div>
        </div>

        <div className="grid gap-3">
          {visible.map((p) => {
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
                    <h2 className="text-base font-semibold text-[var(--foreground)]">
                      {label}
                    </h2>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="pixel-badge pixel-badge-indigo">
                        {getAssetManagerLabel(p, lang)}
                      </span>
                      <span className="pixel-badge pixel-badge-emerald">
                        {label}
                      </span>
                      <span className={tagClassForRisk(p.risk_level)}>
                        {riskProfileLabel(t, p.risk_level)}
                      </span>
                      {conflict ? (
                        <span className="pixel-badge pixel-badge-warn">
                          {t("models.conflictBadge")}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm text-[var(--ui-color-body)]">
                      {getPortfolioDescription(p, lang)}
                    </p>
                    {conflict ? (
                      <p className="mt-2 text-sm text-[var(--amber)]">
                        {t("models.conflictTickers")}:{" "}
                        {p.conflict_tickers.join(", ")}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="text-sm text-[var(--primary)] hover:underline"
                    onClick={() => setExpandedId(open ? null : p.id)}
                  >
                    {open ? t("models.hideHoldings") : t("models.showHoldings")}
                  </button>
                </div>
                {open ? (
                  <table className="mt-4 w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[var(--text-dim)]">
                        <th className="py-1 font-medium">{t("pool.col.ticker")}</th>
                        <th className="py-1 font-medium">{t("pool.col.name")}</th>
                        <th className="py-1 font-medium">
                          {t("pool.col.productType")}
                        </th>
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
                          <td className="py-1.5">
                            {productTypeLabel(
                              t,
                              resolveHoldingProductType({
                                ticker: h.ticker,
                                asset_class: "equity",
                              }),
                            )}
                          </td>
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
          {visible.length === 0 ? (
            <p className="text-sm text-[var(--text-dim)]">{t("models.empty")}</p>
          ) : null}
        </div>
      </main>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppNav } from "@/components/AppNav";
import {
  assetClassLabel,
  productTypeLabel,
  regionLabel,
  useI18n,
} from "@/lib/i18n";
import { etfDisplayName, etfSearchText } from "@/lib/etf-display-name";
import {
  readInvestmentPool,
  setPoolItemEnabled,
  type PoolItem,
} from "@/lib/investment-pool";

export default function InvestmentPoolPage() {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<PoolItem[]>([]);
  const [q, setQ] = useState("");
  const [assetClass, setAssetClass] = useState("all");
  const [region, setRegion] = useState("all");

  useEffect(() => {
    setItems(readInvestmentPool());
  }, []);

  const assetClasses = useMemo(
    () => [...new Set(items.map((i) => i.asset_class))].sort(),
    [items],
  );
  const regions = useMemo(
    () => [...new Set(items.map((i) => i.region))].sort(),
    [items],
  );

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return items.filter((i) => {
      if (assetClass !== "all" && i.asset_class !== assetClass) return false;
      if (region !== "all" && i.region !== region) return false;
      if (!query) return true;
      return (
        i.ticker.toLowerCase().includes(query) ||
        etfSearchText(i.ticker).toLowerCase().includes(query) ||
        i.name.toLowerCase().includes(query)
      );
    });
  }, [items, q, assetClass, region]);

  const enabledCount = items.filter((i) => i.enabled).length;

  const onToggle = useCallback((ticker: string, enabled: boolean) => {
    setItems(setPoolItemEnabled(ticker, enabled));
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppNav
        subtitle={t("pool.subtitle")}
        extraBadges={
          <span className="pixel-badge pixel-badge-cyan shrink-0">
            {t("pool.countBadge", {
              enabled: enabledCount,
              total: items.length,
            })}
          </span>
        }
      />
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <div className="pixel-panel space-y-3">
          <div className="flex flex-wrap gap-2">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("pool.searchPlaceholder")}
              className="pixel-input min-w-[180px] flex-1"
            />
            <select
              value={assetClass}
              onChange={(e) => setAssetClass(e.target.value)}
              className="pixel-input"
            >
              <option value="all">{t("pool.filter.allClasses")}</option>
              {assetClasses.map((c) => (
                <option key={c} value={c}>
                  {assetClassLabel(t, c)}
                </option>
              ))}
            </select>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="pixel-input"
            >
              <option value="all">{t("pool.filter.allRegions")}</option>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {regionLabel(t, r)}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--text-dim)]">
                  <th className="py-2 pr-2 font-medium">{t("pool.col.enabled")}</th>
                  <th className="py-2 pr-2 font-medium">{t("pool.col.ticker")}</th>
                  <th className="py-2 pr-2 font-medium">{t("pool.col.name")}</th>
                  <th className="py-2 pr-2 font-medium">{t("pool.col.assetClass")}</th>
                  <th className="py-2 pr-2 font-medium">{t("pool.col.region")}</th>
                  <th className="py-2 pr-2 font-medium">{t("pool.col.productType")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => (
                  <tr
                    key={i.ticker}
                    className="border-b border-[var(--border)]/60"
                  >
                    <td className="py-2 pr-2">
                      <input
                        type="checkbox"
                        checked={i.enabled}
                        onChange={(e) => onToggle(i.ticker, e.target.checked)}
                        aria-label={t("pool.toggleEnabled", { ticker: i.ticker })}
                      />
                    </td>
                    <td className="py-2 pr-2 font-medium">{i.ticker}</td>
                    <td className="py-2 pr-2 text-[var(--ui-color-body)]">
                      {etfDisplayName(i.ticker, lang)}
                    </td>
                    <td className="py-2 pr-2">{assetClassLabel(t, i.asset_class)}</td>
                    <td className="py-2 pr-2">{regionLabel(t, i.region)}</td>
                    <td className="py-2 pr-2">
                      {productTypeLabel(t, i.product_type)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 ? (
              <p className="py-6 text-center ui-hint">{t("pool.empty")}</p>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}

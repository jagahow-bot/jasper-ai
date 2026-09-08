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
import {
  SELLABLE_OVERRIDES_STORAGE_KEY,
  baselineSellableForTicker,
  clearAllSellableOverrides,
  isSellableTicker,
  readSellableOverrides,
  setSellableBulk,
  setSellableOverride,
  type SellableOverrides,
} from "@/lib/sellable-overrides";

export default function InvestmentPoolPage() {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<PoolItem[]>([]);
  const [overrides, setOverrides] = useState<SellableOverrides>({});
  const [q, setQ] = useState("");
  const [assetClass, setAssetClass] = useState("all");
  const [region, setRegion] = useState("all");
  const [productType, setProductType] = useState("all");
  const [sellableFilter, setSellableFilter] = useState<
    "all" | "sellable" | "non_sellable"
  >("all");
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  const refreshOverrides = useCallback(() => {
    setOverrides(readSellableOverrides());
  }, []);

  useEffect(() => {
    setItems(readInvestmentPool());
    refreshOverrides();
  }, [refreshOverrides]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SELLABLE_OVERRIDES_STORAGE_KEY || e.key === null) {
        refreshOverrides();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [refreshOverrides]);

  const assetClasses = useMemo(
    () => [...new Set(items.map((i) => i.asset_class))].sort(),
    [items],
  );
  const regions = useMemo(
    () => [...new Set(items.map((i) => i.region))].sort(),
    [items],
  );
  const productTypes = useMemo(
    () => [...new Set(items.map((i) => i.product_type || "etf"))].sort(),
    [items],
  );

  const sellableMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const i of items) {
      map.set(i.ticker.toUpperCase(), isSellableTicker(i.ticker));
    }
    return map;
  }, [items, overrides]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return items.filter((i) => {
      if (assetClass !== "all" && i.asset_class !== assetClass) return false;
      if (region !== "all" && i.region !== region) return false;
      if (productType !== "all" && (i.product_type || "etf") !== productType) {
        return false;
      }
      const sellable = sellableMap.get(i.ticker.toUpperCase()) ?? false;
      if (sellableFilter === "sellable" && !sellable) return false;
      if (sellableFilter === "non_sellable" && sellable) return false;
      if (!query) return true;
      return (
        i.ticker.toLowerCase().includes(query) ||
        etfSearchText(i.ticker).toLowerCase().includes(query) ||
        i.name.toLowerCase().includes(query)
      );
    });
  }, [items, q, assetClass, region, productType, sellableFilter, sellableMap]);

  const enabledCount = items.filter((i) => i.enabled).length;
  const sellableCount = items.filter(
    (i) => sellableMap.get(i.ticker.toUpperCase()) ?? false,
  ).length;
  const filteredBlocked = filtered.filter(
    (i) => !(sellableMap.get(i.ticker.toUpperCase()) ?? false),
  ).length;

  const onToggle = useCallback((ticker: string, enabled: boolean) => {
    setItems(setPoolItemEnabled(ticker, enabled));
  }, []);

  const onToggleSellable = useCallback((ticker: string, sellable: boolean) => {
    setOverrides(setSellableOverride(ticker, sellable));
  }, []);

  const onBulkSellable = useCallback(
    (sellable: boolean) => {
      const tickers = filtered.map((i) => i.ticker);
      setOverrides(setSellableBulk(tickers, sellable));
      setBulkMsg(t("pool.bulk.done", { count: tickers.length }));
    },
    [filtered, t],
  );

  const onResetDefaults = useCallback(() => {
    if (!window.confirm(t("pool.bulk.resetConfirm"))) return;
    clearAllSellableOverrides();
    setOverrides({});
    setBulkMsg(t("pool.bulk.done", { count: items.length }));
  }, [items.length, t]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppNav subtitle={t("pool.subtitle")} />
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <div className="pixel-panel space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-[var(--foreground)]">
              {t("pool.title")}
            </h2>
            <div className="flex flex-wrap gap-2">
              <span className="pixel-badge pixel-badge-cyan shrink-0">
                {t("pool.countBadge", {
                  enabled: enabledCount,
                  total: items.length,
                })}
              </span>
              <span className="pixel-badge pixel-badge-cyan shrink-0">
                {t("pool.sellableBadge", {
                  sellable: sellableCount,
                  total: items.length,
                })}
              </span>
            </div>
          </div>
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
            <select
              value={productType}
              onChange={(e) => setProductType(e.target.value)}
              className="pixel-input"
            >
              <option value="all">{t("pool.filter.allProducts")}</option>
              {productTypes.map((p) => (
                <option key={p} value={p}>
                  {productTypeLabel(t, p)}
                </option>
              ))}
            </select>
            <select
              value={sellableFilter}
              onChange={(e) =>
                setSellableFilter(
                  e.target.value as "all" | "sellable" | "non_sellable",
                )
              }
              className="pixel-input"
            >
              <option value="all">{t("pool.filter.allSellable")}</option>
              <option value="sellable">{t("pool.filter.sellableOnly")}</option>
              <option value="non_sellable">
                {t("pool.filter.nonSellableOnly")}
              </option>
            </select>
          </div>

          {filtered.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="ui-hint">
                {t("pool.bulk.filteredSummary", {
                  count: filtered.length,
                  blocked: filteredBlocked,
                })}
              </span>
              <button
                type="button"
                className="pixel-btn pixel-btn-sm"
                onClick={() => onBulkSellable(true)}
                title={t("pool.bulk.setSellable")}
              >
                {t("pool.bulk.setSellable")}
              </button>
              <button
                type="button"
                className="pixel-btn pixel-btn-sm"
                onClick={() => onBulkSellable(false)}
              >
                {t("pool.bulk.unsetSellable")}
              </button>
              <button
                type="button"
                className="pixel-btn pixel-btn-sm"
                onClick={onResetDefaults}
              >
                {t("pool.bulk.resetDefaults")}
              </button>
              {bulkMsg ? <span className="ui-hint">{bulkMsg}</span> : null}
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-[var(--text-dim)]">
                  <th className="py-2 pr-2 font-medium">{t("pool.col.enabled")}</th>
                  <th className="py-2 pr-2 font-medium">{t("pool.col.sellable")}</th>
                  <th className="py-2 pr-2 font-medium">{t("pool.col.ticker")}</th>
                  <th className="py-2 pr-2 font-medium">{t("pool.col.name")}</th>
                  <th className="py-2 pr-2 font-medium">{t("pool.col.assetClass")}</th>
                  <th className="py-2 pr-2 font-medium">{t("pool.col.region")}</th>
                  <th className="py-2 pr-2 font-medium">{t("pool.col.productType")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((i) => {
                  const key = i.ticker.toUpperCase();
                  const sellable = sellableMap.get(key) ?? false;
                  const overridden = Object.prototype.hasOwnProperty.call(
                    overrides,
                    key,
                  );
                  const baseline = baselineSellableForTicker(i.ticker);
                  return (
                    <tr
                      key={i.ticker}
                      className="border-b border-[var(--border)]/60"
                    >
                      <td className="py-2 pr-2">
                        <input
                          type="checkbox"
                          checked={i.enabled}
                          onChange={(e) => onToggle(i.ticker, e.target.checked)}
                          aria-label={t("pool.toggleEnabled", {
                            ticker: i.ticker,
                          })}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <span className="inline-flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={sellable}
                            onChange={(e) =>
                              onToggleSellable(i.ticker, e.target.checked)
                            }
                            aria-label={t("pool.toggleSellable", {
                              ticker: i.ticker,
                            })}
                          />
                          {overridden ? (
                            <span
                              className="text-[var(--text-dim)]"
                              title={t("pool.sellable.overridden", {
                                value: baseline ? "true" : "false",
                              })}
                            >
                              *
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="py-2 pr-2 font-medium">{i.ticker}</td>
                      <td className="py-2 pr-2 text-[var(--ui-color-body)]">
                        {etfDisplayName(i.ticker, lang)}
                      </td>
                      <td className="py-2 pr-2">
                        {assetClassLabel(t, i.asset_class)}
                      </td>
                      <td className="py-2 pr-2">{regionLabel(t, i.region)}</td>
                      <td className="py-2 pr-2">
                        {productTypeLabel(t, i.product_type)}
                      </td>
                    </tr>
                  );
                })}
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

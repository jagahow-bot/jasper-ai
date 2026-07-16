"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppNav } from "@/components/AppNav";
import {
  assetClassLabel,
  productTypeLabel,
  regionLabel,
  useI18n,
} from "@/lib/i18n";
import { etfDisplayName, etfSearchText } from "@/lib/etf-display-name";
import {
  buildDemoPool,
  buildFullUniversePool,
  importPoolFromCsv,
  poolToCsv,
  readInvestmentPool,
  replaceInvestmentPool,
  setPoolItemEnabled,
  type PoolImportReport,
  type PoolItem,
} from "@/lib/investment-pool";

export default function InvestmentPoolPage() {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<PoolItem[]>([]);
  const [q, setQ] = useState("");
  const [assetClass, setAssetClass] = useState("all");
  const [region, setRegion] = useState("all");
  const [enabledOnly, setEnabledOnly] = useState(false);
  const [report, setReport] = useState<PoolImportReport | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
      if (enabledOnly && !i.enabled) return false;
      if (assetClass !== "all" && i.asset_class !== assetClass) return false;
      if (region !== "all" && i.region !== region) return false;
      if (!query) return true;
      return (
        i.ticker.toLowerCase().includes(query) ||
        etfSearchText(i.ticker).toLowerCase().includes(query) ||
        i.name.toLowerCase().includes(query)
      );
    });
  }, [items, q, assetClass, region, enabledOnly]);

  const enabledCount = items.filter((i) => i.enabled).length;

  const onToggle = useCallback((ticker: string, enabled: boolean) => {
    setItems(setPoolItemEnabled(ticker, enabled));
  }, []);

  const onLoadDemo = () => {
    setItems(replaceInvestmentPool(buildDemoPool()));
    setReport(null);
  };

  const onLoadFull = () => {
    setItems(replaceInvestmentPool(buildFullUniversePool()));
    setReport(null);
  };

  const onImportFile = async (file: File) => {
    const text = await file.text();
    const { items: next, report: r } = importPoolFromCsv(text, items);
    setItems(next);
    setReport(r);
  };

  const onExport = () => {
    const csv = poolToCsv(items);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "investment-pool.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppNav
        subtitle={t("pool.subtitle")}
        extraBadges={
          <span className="pixel-badge pixel-badge-cyan">
            {t("pool.countBadge", {
              enabled: enabledCount,
              total: items.length,
            })}
          </span>
        }
      />
      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        <div>
          <h1 className="ui-panel-title">{t("pool.title")}</h1>
          <p className="mt-2 ui-hint">{t("pool.hint")}</p>
        </div>

        <div className="pixel-panel flex flex-wrap gap-2">
          <button type="button" className="pixel-btn" onClick={onLoadDemo}>
            {t("pool.loadDemo")}
          </button>
          <button
            type="button"
            className="pixel-btn border border-[var(--border)] bg-white text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
            onClick={onLoadFull}
          >
            {t("pool.loadFull")}
          </button>
          <button
            type="button"
            className="pixel-btn border border-[var(--border)] bg-white text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
            onClick={() => fileRef.current?.click()}
          >
            {t("pool.importCsv")}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="pixel-btn border border-[var(--border)] bg-white text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
            onClick={onExport}
          >
            {t("pool.exportCsv")}
          </button>
        </div>

        {report ? (
          <div className="saas-inset text-sm">
            <p>
              {t("pool.importReport", {
                upserted: report.upserted,
                skipped: report.skipped,
              })}
            </p>
            {report.errors.length > 0 ? (
              <ul className="mt-2 list-inside list-disc text-[var(--magenta)]">
                {report.errors.slice(0, 8).map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

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
            <label className="flex items-center gap-2 text-sm text-[var(--ui-color-body)]">
              <input
                type="checkbox"
                checked={enabledOnly}
                onChange={(e) => setEnabledOnly(e.target.checked)}
              />
              {t("pool.filter.enabledOnly")}
            </label>
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

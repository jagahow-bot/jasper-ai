"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { downloadCsvFile } from "@/lib/download-csv";
import { useI18n } from "@/lib/i18n";
import {
  importPoolFromCsv,
  poolToCsv,
  readInvestmentPool,
  type PoolImportReport,
  type PoolItem,
} from "@/lib/investment-pool";
import {
  importModelsFromCsv,
  modelsToCsv,
  readManagedPortfolios,
  type ManagedModelPortfolio,
  type ModelImportReport,
} from "@/lib/model-portfolios-store";
import {
  validateModelsCsv,
  validatePoolCsv,
  type ModelsValidationReport,
  type PoolValidationReport,
} from "@/lib/api";

export default function SettingsPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<PoolItem[]>([]);
  const [portfolios, setPortfolios] = useState<ManagedModelPortfolio[]>([]);
  const [poolReport, setPoolReport] = useState<PoolImportReport | null>(null);
  const [modelsReport, setModelsReport] = useState<ModelImportReport | null>(
    null,
  );
  const poolFileRef = useRef<HTMLInputElement>(null);
  const modelsFileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    const pool = readInvestmentPool();
    setItems(pool);
    setPortfolios(readManagedPortfolios(pool));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const enabledCount = items.filter((i) => i.enabled).length;

  const onImportPool = async (file: File) => {
    const text = await file.text();
    let backendReport: PoolValidationReport | null = null;
    try {
      backendReport = await validatePoolCsv(text);
    } catch (err) {
      setPoolReport({
        upserted: 0,
        skipped: 0,
        errors: [
          err instanceof Error
            ? `Backend validation unavailable: ${err.message}`
            : "Backend validation unavailable",
        ],
      });
      return;
    }
    if (!backendReport.valid || backendReport.errors.length > 0) {
      setPoolReport({
        upserted: backendReport.upserted,
        skipped: backendReport.skipped,
        errors: backendReport.errors,
      });
      return;
    }
    const { items: next, report } = importPoolFromCsv(text, items);
    setItems(next);
    setPoolReport(report);
    setPortfolios(readManagedPortfolios(next));
  };

  const onExportPool = () => {
    downloadCsvFile("investment-pool.csv", poolToCsv(items));
  };

  const onImportModels = async (file: File) => {
    const text = await file.text();
    let backendReport: ModelsValidationReport | null = null;
    try {
      backendReport = await validateModelsCsv(text);
    } catch (err) {
      setModelsReport({
        portfolios: 0,
        skipped: 0,
        conflicts: [],
        errors: [
          err instanceof Error
            ? `Backend validation unavailable: ${err.message}`
            : "Backend validation unavailable",
        ],
      });
      return;
    }
    if (!backendReport.valid || backendReport.errors.length > 0) {
      setModelsReport({
        portfolios: backendReport.imported,
        skipped: backendReport.skipped,
        conflicts: [],
        errors: backendReport.errors,
      });
      return;
    }
    const pool = readInvestmentPool();
    const { portfolios: next, report } = importModelsFromCsv(text, pool);
    setPortfolios(next);
    setModelsReport(report);
  };

  const onExportModels = () => {
    downloadCsvFile("model-portfolios.csv", modelsToCsv(portfolios));
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppNav subtitle={t("settings.subtitle")} />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <p className="text-sm text-[var(--text-dim)]">{t("settings.hint")}</p>

        <section className="pixel-panel space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[var(--foreground)]">
                {t("settings.poolTitle")}
              </h2>
              <p className="mt-1 text-sm text-[var(--text-dim)]">
                {t("settings.poolHint")}
              </p>
            </div>
            <span className="pixel-badge pixel-badge-cyan shrink-0">
              {t("pool.countBadge", {
                enabled: enabledCount,
                total: items.length,
              })}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="pixel-btn"
              onClick={() => poolFileRef.current?.click()}
            >
              {t("pool.importCsv")}
            </button>
            <input
              ref={poolFileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImportPool(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="pixel-btn border border-[var(--border)] bg-white text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
              onClick={onExportPool}
            >
              {t("pool.exportCsv")}
            </button>
          </div>
          {poolReport ? (
            <div className="saas-inset text-sm">
              <p>
                {t("pool.importReport", {
                  upserted: poolReport.upserted,
                  skipped: poolReport.skipped,
                })}
              </p>
              {poolReport.errors.length > 0 ? (
                <ul className="mt-2 list-inside list-disc text-[var(--magenta)]">
                  {poolReport.errors.slice(0, 8).map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="pixel-panel space-y-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--foreground)]">
              {t("settings.modelsTitle")}
            </h2>
            <p className="mt-1 text-sm text-[var(--text-dim)]">
              {t("settings.modelsHint")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="pixel-btn"
              onClick={() => modelsFileRef.current?.click()}
            >
              {t("models.importCsv")}
            </button>
            <input
              ref={modelsFileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onImportModels(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="pixel-btn border border-[var(--border)] bg-white text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
              onClick={onExportModels}
            >
              {t("models.exportCsv")}
            </button>
          </div>
          {modelsReport ? (
            <div className="saas-inset text-sm">
              <p>
                {t("models.importReport", {
                  count: modelsReport.portfolios,
                  skipped: modelsReport.skipped,
                })}
              </p>
              {modelsReport.conflicts.length > 0 ? (
                <ul className="mt-2 list-inside list-disc text-[var(--amber)]">
                  {modelsReport.conflicts.map((c) => (
                    <li key={c}>
                      {t("models.conflict")}: {c}
                    </li>
                  ))}
                </ul>
              ) : null}
              {modelsReport.errors.length > 0 ? (
                <ul className="mt-2 list-inside list-disc text-[var(--magenta)]">
                  {modelsReport.errors.slice(0, 8).map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}

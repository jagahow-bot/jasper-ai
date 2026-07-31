"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CURRENT_HOLDINGS_ANCHOR_ID,
  getAmThemeLabel,
  getAssetManagerLabel,
  getPortfolioDescription,
  getPortfolioLabel,
  type ModelPortfolio,
} from "@/lib/model-portfolios";
import {
  getSelectableAnchorPortfolios,
  readManagedPortfolios,
  type ManagedModelPortfolio,
} from "@/lib/model-portfolios-store";
import { readInvestmentPool } from "@/lib/investment-pool";
import { etfDisplayName } from "@/lib/etf-display-name";
import { useI18n } from "@/lib/i18n";

type Props = {
  selectedId: string;
  onSelect: (portfolio: ModelPortfolio) => void;
  onContinue: () => void;
  /** When set, show “current holdings / no model” as a selectable baseline. */
  currentHoldingsAnchor?: ModelPortfolio | null;
};

export function AnchorPortfolioSelector({
  selectedId,
  onSelect,
  onContinue,
  currentHoldingsAnchor = null,
}: Props) {
  const { t, lang } = useI18n();
  const [managed, setManaged] = useState<ManagedModelPortfolio[]>([]);

  useEffect(() => {
    const pool = readInvestmentPool();
    setManaged(readManagedPortfolios(pool));
  }, []);

  const portfolios = useMemo(() => {
    const selectable = getSelectableAnchorPortfolios();
    const catalog =
      managed.length === 0
        ? selectable
        : managed
            .filter((p) => p.enabled && p.conflict_tickers.length === 0)
            .map((item) => {
              const rest: Record<string, unknown> = { ...item };
              delete rest.conflict_tickers;
              delete rest.enabled;
              return rest as Omit<typeof item, "conflict_tickers" | "enabled">;
            });
    if (currentHoldingsAnchor) {
      return [currentHoldingsAnchor, ...catalog];
    }
    return catalog;
  }, [managed, currentHoldingsAnchor]);

  const conflictCount = managed.filter((p) => p.conflict_tickers.length > 0).length;
  const selected =
    portfolios.find((p) => p.id === selectedId) ??
    currentHoldingsAnchor ??
    portfolios[0];

  return (
    <div className="pixel-panel space-y-4">
      <div>
        <h2 className="ui-panel-title">{t("anchor.title")}</h2>
        <p className="mt-2 ui-hint">{t("anchor.subtitle")}</p>
        {currentHoldingsAnchor ? (
          <p className="mt-1 ui-hint">{t("anchor.currentHoldingsHint")}</p>
        ) : null}
        {conflictCount > 0 ? (
          <p className="mt-1 text-sm text-[var(--amber)]">
            {t("anchor.poolConflicts", { count: conflictCount })}
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {portfolios.map((p) => {
          const active = p.id === selectedId;
          const am = getAssetManagerLabel(p, lang);
          const theme = getPortfolioLabel(p, lang);
          const holdings = p.holdings
            .map(
              (h) =>
                `${h.ticker} ${(h.weight * 100).toFixed(0)}% (${etfDisplayName(h.ticker, lang)})`,
            )
            .join(" · ");
          const isCurrent = p.id === CURRENT_HOLDINGS_ANCHOR_ID;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p)}
              className={`flex flex-col rounded-xl border p-4 text-left transition ${
                active
                  ? "border-[var(--primary)] bg-[var(--primary-muted)] shadow-sm"
                  : "border-[var(--border)] bg-white hover:border-[var(--primary)]/40 hover:shadow-sm"
              }`}
            >
              <span className="inline-flex w-fit rounded-md bg-[var(--surface-2)] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-dim)]">
                {am}
              </span>
              <span className="mt-2 text-sm font-semibold text-[var(--foreground)]">
                {theme}
              </span>
              {isCurrent ? (
                <span className="mt-1 inline-flex w-fit rounded-md bg-[var(--primary)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--primary)]">
                  {t("anchor.noModelBadge")}
                </span>
              ) : null}
              <p className="mt-2 flex-1 ui-hint leading-snug">
                {getPortfolioDescription(p, lang)}
              </p>
              <div className="mt-3 border-t border-[var(--border)]/60 pt-2">
                <p className="text-sm text-[var(--primary)]">{holdings}</p>
              </div>
            </button>
          );
        })}
      </div>

      {portfolios.length === 0 ? (
        <p className="text-sm text-[var(--magenta)]">{t("anchor.empty")}</p>
      ) : null}

      {selected && (
        <div className="saas-inset text-sm">
          <p className="ui-hint">{t("anchor.selected")}</p>
          <p className="mt-1 font-medium text-[var(--foreground)]">
            {getAmThemeLabel(selected, lang)}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={onContinue}
        disabled={!selected}
        className="pixel-btn w-full disabled:opacity-40"
      >
        {t("anchor.continue")}
      </button>
    </div>
  );
}

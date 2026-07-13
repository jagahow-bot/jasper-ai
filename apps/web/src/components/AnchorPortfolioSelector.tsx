"use client";

import { useMemo } from "react";
import {
  getAnchorPortfolios,
  getPortfolioDescription,
  getPortfolioLabel,
  MAINSTREAM_DEMO_TICKERS,
  type ModelPortfolio,
} from "@/lib/model-portfolios";
import { useI18n } from "@/lib/i18n";

type Props = {
  selectedId: string;
  onSelect: (portfolio: ModelPortfolio) => void;
  onContinue: () => void;
};

export function AnchorPortfolioSelector({ selectedId, onSelect, onContinue }: Props) {
  const { t, lang } = useI18n();
  const portfolios = useMemo(() => getAnchorPortfolios(), []);
  const selected = portfolios.find((p) => p.id === selectedId) ?? portfolios[0];

  return (
    <div className="pixel-panel space-y-4">
      <div>
        <h2 className="ui-panel-title">{t("anchor.title")}</h2>
        <p className="mt-2 ui-hint">{t("anchor.subtitle")}</p>
        <p className="mt-1 ui-hint">
          {t("anchor.universeNote", { count: MAINSTREAM_DEMO_TICKERS.length })}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {portfolios.map((p) => {
          const active = p.id === selectedId;
          const label = getPortfolioLabel(p, lang);
          const holdings = p.holdings
            .map((h) => `${h.ticker} ${(h.weight * 100).toFixed(0)}%`)
            .join(" · ");
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p)}
              className={`rounded-xl border p-4 text-left transition ${
                active
                  ? "border-[var(--primary)] bg-[var(--primary-muted)] shadow-sm"
                  : "border-[var(--border)] bg-white hover:border-[var(--primary)]/40 hover:shadow-sm"
              }`}
            >
              <span className="text-sm font-semibold text-[var(--foreground)]">{label}</span>
              <p className="mt-2 ui-hint leading-snug">
                {getPortfolioDescription(p, lang)}
              </p>
              <p className="mt-2 text-sm text-[var(--primary)]">{holdings}</p>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="saas-inset text-sm">
          <p className="ui-hint">{t("anchor.selected")}</p>
          <p className="mt-1 font-medium text-[var(--foreground)]">
            {getPortfolioLabel(selected, lang)}
          </p>
        </div>
      )}

      <button type="button" onClick={onContinue} className="pixel-btn w-full">
        {t("anchor.continue")}
      </button>
    </div>
  );
}

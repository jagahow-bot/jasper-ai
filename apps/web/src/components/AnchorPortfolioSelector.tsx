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
        <h2 className="font-pixel text-xs text-neon">{t("anchor.title")}</h2>
        <p className="mt-2 text-sm text-dim">{t("anchor.subtitle")}</p>
        <p className="mt-1 text-xs text-dim">
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
              className={`border-2 p-4 text-left transition ${
                active
                  ? "border-[var(--neon)] bg-[rgba(57,255,20,0.1)] shadow-pixel"
                  : "border-[var(--border)] bg-[#080810] hover:border-[var(--cyan)]"
              }`}
            >
              <span className="font-pixel text-[10px] text-neon">{label}</span>
              <p className="mt-2 text-xs leading-snug text-dim">
                {getPortfolioDescription(p, lang)}
              </p>
              <p className="mt-2 font-terminal text-sm text-[var(--cyan)]">{holdings}</p>
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="border border-[var(--border)] bg-[rgba(0,0,0,0.2)] p-3 text-sm">
          <p className="text-dim">{t("anchor.selected")}</p>
          <p className="mt-1 font-terminal text-[var(--foreground)]">
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

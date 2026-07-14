"use client";

import { useMemo } from "react";
import { buildInvestmentProposalSections } from "@/lib/investment-proposal";
import type { ClientOverlay } from "@/lib/overlay-schema";
import type { ModelPortfolio } from "@/lib/model-portfolios";
import { useI18n } from "@/lib/i18n";
import type { PersonalizationCompare } from "@/lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
  compare: PersonalizationCompare;
  overlay: ClientOverlay | null;
  anchorPortfolio: ModelPortfolio;
};

export function InvestmentProposalPreview({
  open,
  onClose,
  compare,
  overlay,
  anchorPortfolio,
}: Props) {
  const { t, lang } = useI18n();
  const sections = useMemo(
    () =>
      buildInvestmentProposalSections({
        compare,
        overlay,
        anchorPortfolio,
        lang,
        t,
      }),
    [compare, overlay, anchorPortfolio, lang, t],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 print:static print:bg-transparent print:p-0"
      role="dialog"
      aria-modal="true"
      aria-labelledby="proposal-title"
    >
      <div className="my-6 w-full max-w-3xl rounded-xl border border-[var(--border)] bg-white shadow-lg print:my-0 print:max-w-none print:border-0 print:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4 print:hidden">
          <div>
            <h2 id="proposal-title" className="ui-panel-title">
              {t("proposal.title")}
            </h2>
            <p className="ui-hint mt-1">{t("proposal.subtitle")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="pixel-btn"
              onClick={() => window.print()}
            >
              {t("proposal.print")}
            </button>
            <button
              type="button"
              className="pixel-btn border border-[var(--border)] bg-white text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
              onClick={onClose}
            >
              {t("proposal.close")}
            </button>
          </div>
        </div>

        <article className="space-y-6 px-5 py-6 print:px-0 print:py-0">
          <header className="hidden print:block print:mb-6">
            <h1 className="text-xl font-semibold">{t("proposal.title")}</h1>
            <p className="mt-1 text-sm text-slate-600">{t("proposal.subtitle")}</p>
          </header>
          <p className="ui-hint rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 print:border print:border-slate-300">
            {t("proposal.draftBanner")}
          </p>
          {sections.map((section) => (
            <section key={section.id} className="break-inside-avoid">
              <h3 className="ui-section-title text-[var(--primary)]">
                {section.id}. {t(section.titleKey)}
              </h3>
              <ul className="ui-body mt-2 list-disc space-y-1.5 pl-5">
                {section.body.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </section>
          ))}
        </article>
      </div>
    </div>
  );
}

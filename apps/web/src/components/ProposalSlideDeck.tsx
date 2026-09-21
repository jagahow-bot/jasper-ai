"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

import { SlideRenderer } from "@/components/proposal-slides/SlideRenderer";
import type { DemoClient } from "@/lib/clients";
import type { ClientOverlay } from "@/lib/overlay-schema";
import type { ModelPortfolio } from "@/lib/model-portfolios";
import { useI18n } from "@/lib/i18n";
import {
  proposalPrintBlockedMessage,
  proposalRequiresSupervisorSignoff,
} from "@/lib/proposal-capability-badge";
import { buildProposalSlideDeck } from "@/lib/proposal-slides";
import type { PersonalizationCompare } from "@/lib/types";
import { useAiTalkingSummary } from "@/lib/use-ai-talking-summary";
import {
  buildHoldingsDiff,
  buildMetricCompareRows,
} from "@/lib/rm-report-utils";
import { resolveRunObjective } from "@/lib/resolve-run-objective";

type Props = {
  open: boolean;
  onClose: () => void;
  compare: PersonalizationCompare;
  overlay: ClientOverlay | null;
  anchorPortfolio: ModelPortfolio;
  client?: DemoClient | null;
  customizedModelCode?: string | null;
};

export function ProposalSlideDeck({
  open,
  onClose,
  compare,
  overlay,
  anchorPortfolio,
  client = null,
  customizedModelCode = null,
}: Props) {
  const { t, lang } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  const pick = useMemo(
    () => (customizedModelCode ? { customizedModelCode } : undefined),
    [customizedModelCode],
  );
  const metrics = useMemo(
    () =>
      buildMetricCompareRows(
        compare.baseResult,
        compare.adjustedResult,
        {
          cagr: t("compare.metric.cagr"),
          sharpe: t("compare.metric.sharpe"),
          mdd: t("compare.metric.mdd"),
          vol: t("compare.metric.vol"),
          calmar: t("common.calmar"),
        },
        pick,
      ),
    [compare.baseResult, compare.adjustedResult, pick, t],
  );
  const holdingsDiff = useMemo(
    () =>
      buildHoldingsDiff(
        compare.baseResult,
        compare.adjustedResult,
        anchorPortfolio.holdings,
        pick,
      ),
    [compare.baseResult, compare.adjustedResult, anchorPortfolio.holdings, pick],
  );
  const talkingSummary = useAiTalkingSummary({
    metrics,
    holdingsDiff,
    overlay,
    adjustedResult: compare.adjustedResult,
    anchorLabel: compare.anchorLabel,
    objectiveKey: resolveRunObjective(
      compare.adjustedRequest,
      compare.adjustedResult.narrative_facts,
    ),
    lang,
    t,
    customizedModelCode,
    benchmark: anchorPortfolio.benchmark,
  });

  const slides = useMemo(
    () =>
      buildProposalSlideDeck({
        compare,
        overlay,
        anchorPortfolio,
        client,
        lang,
        t,
        customizedModelCode,
        talkingPoints: talkingSummary.summary,
      }),
    [
      compare,
      overlay,
      anchorPortfolio,
      client,
      lang,
      t,
      customizedModelCode,
      talkingSummary.summary,
    ],
  );

  const total = slides.length;
  const safeIndex = Math.min(index, Math.max(0, total - 1));
  const current = slides[safeIndex];

  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    containerRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const titleEl = containerRef.current?.querySelector(
      ".slide-title",
    ) as HTMLElement | null;
    titleEl?.focus?.();
  }, [open, safeIndex]);

  const go = useCallback(
    (next: number) => {
      setIndex(Math.max(0, Math.min(total - 1, next)));
    },
    [total],
  );

  const printBlocked = proposalRequiresSupervisorSignoff(
    compare.adjustedResult.capabilities_used,
  );
  const printBlockedMsg = proposalPrintBlockedMessage(lang);

  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        go(safeIndex + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(safeIndex - 1);
      } else if (e.key === "Home") {
        e.preventDefault();
        go(0);
      } else if (e.key === "End") {
        e.preventDefault();
        go(total - 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [go, onClose, safeIndex, total],
  );

  if (!open || !current) return null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 print:static print:bg-transparent print:p-0"
      role="dialog"
      aria-modal="true"
      aria-labelledby="proposal-title"
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <div className="proposal-print flex max-h-[96vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-[#fbfdff] shadow-xl print:max-h-none print:max-w-none print:rounded-none print:border-0 print:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3 print:hidden">
          <div>
            <h2
              id="proposal-title"
              className="text-base font-semibold text-slate-900"
            >
              {t("proposal.title")}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">
              {t("slides.subtitle")}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {printBlocked ? (
              <span className="max-w-xs text-xs text-amber-700">
                {printBlockedMsg}
              </span>
            ) : null}
            <button
              type="button"
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--primary-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={printBlocked}
              onClick={() => window.print()}
            >
              {t("proposal.print")}
            </button>
            <button
              type="button"
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              onClick={onClose}
            >
              {t("proposal.close")}
            </button>
          </div>
        </div>

        {/* Screen: one slide at a time (16:9). Print: all slides stacked. */}
        <div className="hidden print:block">
          {slides.map((slide, i) => (
            <div key={slide.id} className="proposal-slide-print-wrap">
              <SlideRenderer slide={slide} index={i} total={total} />
            </div>
          ))}
        </div>

        <div className="flex min-h-0 flex-1 flex-col print:hidden">
          <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-3">
            <div className="aspect-video w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <SlideRenderer
                slide={current}
                index={safeIndex}
                total={total}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={safeIndex <= 0}
              onClick={() => go(safeIndex - 1)}
            >
              {t("slides.nav.prev")}
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap justify-center gap-1.5">
                {slides.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-label={t("slides.nav.goto", { n: i + 1 })}
                    aria-current={i === safeIndex ? "true" : undefined}
                    className={`h-2.5 w-2.5 rounded-full transition ${
                      i === safeIndex
                        ? "bg-blue-700"
                        : "bg-slate-300 hover:bg-slate-400"
                    }`}
                    onClick={() => go(i)}
                  />
                ))}
              </div>
              <span className="tabular-nums text-xs text-slate-500">
                {t("slides.nav.counter", {
                  current: safeIndex + 1,
                  total,
                })}
              </span>
            </div>
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              disabled={safeIndex >= total - 1}
              onClick={() => go(safeIndex + 1)}
            >
              {t("slides.nav.next")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

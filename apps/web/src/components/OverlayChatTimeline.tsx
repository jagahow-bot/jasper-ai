"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@/components/ChatLog";
import { OverlayClarificationCards } from "@/components/OverlayClarificationCards";
import type {
  ClarificationDraft,
  ClarificationSnapshot,
} from "@/lib/overlay-clarifications";
import type {
  ClientOverlay,
  OverlayAsk,
  OverlayClarification,
  OverlayConfirmedBulkBatch,
  OverlayProposedTicker,
} from "@/lib/overlay-schema";
import { formatOverlaySummary } from "@/lib/overlay-schema";
import type { OverlayDriftHints } from "@/lib/overlay-drift-sync";
import { useI18n, type Lang } from "@/lib/i18n";
import { isSellableTicker } from "@/lib/sellable-overrides";
import {
  groupProposedByBulk,
  type ProposedBulkGroup,
} from "@/lib/overlay-filter-proposals";
import { BULK_UI_PAGE_SIZE } from "@/lib/overlay-bulk-include";

export type SummarySnapshot = {
  id: string;
  text: string;
};

type Props = {
  messages: ChatMessage[];
  overlay: ClientOverlay | null;
  overlayLang: Lang;
  summaryHistory: SummarySnapshot[];
  clarificationHistory: ClarificationSnapshot[];
  clarifications: OverlayClarification[];
  clarifyDrafts: ClarificationDraft[];
  asks: OverlayAsk[];
  proposedTickers: OverlayProposedTicker[];
  /** Thematic needs exist but proposals are empty — show ack / hint panel. */
  tickerReviewRequired?: boolean;
  confirmedBulkBatches?: OverlayConfirmedBulkBatch[];
  loading?: boolean;
  confirmed?: boolean;
  confirming?: boolean;
  disabled?: boolean;
  driftHint?: OverlayDriftHints | null;
  onAskChange: (asks: OverlayAsk[]) => void;
  onClarifyDraftChange: (index: number, draft: ClarificationDraft) => void;
  onConfirmProposed: (tickers: string[]) => void;
  onSkipProposedNoAdds?: () => void;
  onRevokeBulk?: (bulkId: string) => void;
};

function MessageBubble({ message }: { message: ChatMessage }) {
  const { t } = useI18n();
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const label = isUser
    ? t("chat.speakerYou")
    : isSystem
      ? t("chat.speakerSystem")
      : t("chat.speakerJasper");

  return (
    <div
      className={`flex flex-col gap-0.5 ${isUser ? "items-end" : "items-start"}`}
    >
      <span
        className={`px-1 text-[10px] font-semibold uppercase tracking-wide text-dim ${
          isUser ? "text-right" : "text-left"
        }`}
      >
        {label}
      </span>
      <div
        className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-snug ${
          isUser
            ? "rounded-br-md bg-[var(--primary)]/15 text-[var(--foreground)]"
            : isSystem
              ? "rounded-bl-md border border-red-200 bg-red-50 text-red-700"
              : "rounded-bl-md border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] shadow-sm"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}

function AskCardsInline({
  asks,
  disabled,
  onChange,
}: {
  asks: OverlayAsk[];
  disabled?: boolean;
  onChange: (asks: OverlayAsk[]) => void;
}) {
  const { t } = useI18n();
  if (!asks.length) return null;

  return (
    <div className="space-y-2 rounded-lg border border-[var(--border)]/80 bg-[var(--surface)]/70 p-3">
      <span className="text-xs font-semibold text-[var(--foreground)]">
        {t("overlay.asks.title")}
      </span>
      <div className="grid gap-2 sm:grid-cols-2">
        {asks.map((ask, i) => (
          <div
            key={ask.id}
            className="flex min-w-0 flex-col rounded-md border border-[var(--border)]/80 bg-white px-3 py-2"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="shrink-0 text-xs font-semibold text-dim">
                {i + 1}.
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {ask.title}
              </span>
            </div>
            <textarea
              value={ask.summary}
              disabled={disabled}
              rows={2}
              onChange={(e) =>
                onChange(
                  asks.map((a) =>
                    a.id === ask.id
                      ? { ...a, summary: e.target.value.slice(0, 400) }
                      : a,
                  ),
                )
              }
              className="pixel-input mt-1.5 max-h-20 w-full resize-y text-xs leading-snug"
              aria-label={t("overlay.asks.summaryLabel")}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function ProposedTickersInline({
  candidates,
  bulkInclude,
  disabled,
  reviewRequired,
  showDiHint,
  onConfirm,
  onSkipNoAdds,
}: {
  candidates: OverlayProposedTicker[];
  bulkInclude?: { id: string; label: string }[];
  disabled?: boolean;
  reviewRequired?: boolean;
  showDiHint?: boolean;
  onConfirm: (tickers: string[]) => void;
  onSkipNoAdds?: () => void;
}) {
  const { t } = useI18n();
  const hasBulk = candidates.some((c) => c.bulk_id) || (bulkInclude?.length ?? 0) > 0;
  const groups = useMemo(
    () => groupProposedByBulk(candidates, bulkInclude),
    [candidates, bulkInclude],
  );
  const candidateKey = candidates.map((c) => c.ticker).join("\0");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(candidates.map((c) => c.ticker)),
  );
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [pageByGroup, setPageByGroup] = useState<Record<string, number>>({});

  useEffect(() => {
    setSelected((prev) => {
      const nextTickers = candidateKey ? candidateKey.split("\0") : [];
      if (
        prev.size === nextTickers.length &&
        nextTickers.every((ticker) => prev.has(ticker))
      ) {
        return prev;
      }
      return new Set(nextTickers);
    });
    // Default: collapse bulk groups with >8 items
    const nextCollapsed: Record<string, boolean> = {};
    for (const g of groups) {
      if (g.bulkId && g.items.length > 8) nextCollapsed[g.bulkId] = true;
    }
    setCollapsed(nextCollapsed);
    setPageByGroup({});
  }, [candidateKey]); // eslint-disable-line react-hooks/exhaustive-deps -- reset on candidate set change

  if (!candidates.length && !reviewRequired && !groups.some((g) => g.emptyHint)) {
    return null;
  }

  const allSelected = selected.size === candidates.length && candidates.length > 0;

  const toggleTicker = (ticker: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  };

  const renderTickerRow = (c: OverlayProposedTicker) => {
    const nonSellable = !isSellableTicker(c.ticker);
    return (
      <label key={c.ticker} className="flex cursor-pointer items-start gap-2">
        <input
          type="checkbox"
          checked={selected.has(c.ticker)}
          onChange={() => toggleTicker(c.ticker)}
          className="mt-0.5"
          disabled={disabled}
        />
        <div className="text-sm leading-snug">
          <span className="font-semibold">{c.ticker}</span>
          {nonSellable ? (
            <span className="ml-1 text-amber-600" title="non-sellable">
              ⚠
            </span>
          ) : null}
          {c.name && <span className="text-dim"> — {c.name}</span>}
          {c.rationale && <p className="text-xs text-dim">{c.rationale}</p>}
        </div>
      </label>
    );
  };

  const renderGroup = (g: ProposedBulkGroup) => {
    const key = g.bulkId ?? "__curated__";
    const isBulk = Boolean(g.bulkId);
    const label = isBulk
      ? g.label
      : t("overlay.proposedTickers.bulkCuratedLabel");
    const isCollapsed = isBulk && collapsed[key];
    const page = pageByGroup[key] ?? 0;
    const totalPages = Math.max(1, Math.ceil(g.items.length / BULK_UI_PAGE_SIZE));
    const pageItems =
      g.items.length > BULK_UI_PAGE_SIZE
        ? g.items.slice(page * BULK_UI_PAGE_SIZE, (page + 1) * BULK_UI_PAGE_SIZE)
        : g.items;
    const groupAllSelected =
      g.items.length > 0 && g.items.every((c) => selected.has(c.ticker));

    if (g.emptyHint && !g.items.length) {
      return (
        <div key={key} className="rounded border border-dashed border-[var(--border)] p-2 text-xs text-dim">
          {t("overlay.proposedTickers.bulkEmpty", { label: g.label })}
        </div>
      );
    }

    return (
      <div key={key} className="space-y-1.5 rounded border border-[var(--border)] p-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="text-left text-xs font-semibold text-[var(--foreground)]"
            onClick={() =>
              isBulk
                ? setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
                : undefined
            }
            disabled={!isBulk}
          >
            {isBulk ? (isCollapsed ? "▶ " : "▼ ") : null}
            {label}
            {isBulk ? `（${g.items.length}）` : null}
          </button>
          {g.items.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (groupAllSelected) {
                    for (const c of g.items) next.delete(c.ticker);
                  } else {
                    for (const c of g.items) next.add(c.ticker);
                  }
                  return next;
                });
              }}
              className="text-xs text-[var(--primary)] hover:underline"
              disabled={disabled}
            >
              {groupAllSelected
                ? t("overlay.proposedTickers.bulkGroupNone")
                : t("overlay.proposedTickers.bulkGroupAll")}
            </button>
          ) : null}
        </div>
        {!isCollapsed && g.items.length > 0 ? (
          <>
            <div className="space-y-2">{pageItems.map(renderTickerRow)}</div>
            {totalPages > 1 ? (
              <div className="flex items-center justify-between gap-2 text-xs text-dim">
                <button
                  type="button"
                  className="text-[var(--primary)] hover:underline disabled:opacity-40"
                  disabled={page <= 0 || disabled}
                  onClick={() =>
                    setPageByGroup((prev) => ({ ...prev, [key]: page - 1 }))
                  }
                >
                  {t("overlay.proposedTickers.bulkPrevPage")}
                </button>
                <span>
                  {t("overlay.proposedTickers.bulkPage", {
                    page: page + 1,
                    total: totalPages,
                  })}
                </span>
                <button
                  type="button"
                  className="text-[var(--primary)] hover:underline disabled:opacity-40"
                  disabled={page >= totalPages - 1 || disabled}
                  onClick={() =>
                    setPageByGroup((prev) => ({ ...prev, [key]: page + 1 }))
                  }
                >
                  {t("overlay.proposedTickers.bulkNextPage")}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--foreground)]">
          {t("overlay.proposedTickers.title")}
        </span>
        {candidates.length > 0 ? (
          <button
            type="button"
            onClick={() =>
              setSelected(
                allSelected ? new Set() : new Set(candidates.map((c) => c.ticker)),
              )
            }
            className="text-xs text-[var(--primary)] hover:underline"
          >
            {allSelected
              ? t("overlay.proposedTickers.none")
              : t("overlay.proposedTickers.allWithCount", {
                  count: candidates.length,
                })}
          </button>
        ) : null}
      </div>
      {!candidates.length && reviewRequired ? (
        <p className="text-xs text-dim">
          {showDiHint
            ? t("pool.sellable.diHint")
            : t("overlay.proposedTickers.emptyNeedsHint")}
        </p>
      ) : null}
      {hasBulk ? (
        <div className="space-y-2">{groups.map(renderGroup)}</div>
      ) : candidates.length > 0 ? (
        <div className="space-y-2">{candidates.map(renderTickerRow)}</div>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        {candidates.length > 0 ? (
          <button
            type="button"
            onClick={() => onConfirm([...selected])}
            disabled={disabled || selected.size === 0}
            className="pixel-btn flex-1 disabled:opacity-40"
          >
            {t("overlay.proposedTickers.addSelected", { count: selected.size })}
          </button>
        ) : null}
        {onSkipNoAdds ? (
          <button
            type="button"
            onClick={onSkipNoAdds}
            disabled={disabled}
            className="pixel-btn flex-1 border border-[var(--border)] bg-white text-[var(--foreground)] hover:bg-[var(--surface)] disabled:opacity-40"
          >
            {t("overlay.proposedTickers.skipNoAdds")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ThinkingSteps() {
  const { t } = useI18n();
  const steps = [
    t("overlay.thinking.step1"),
    t("overlay.thinking.step2"),
    t("overlay.thinking.step3"),
    t("overlay.thinking.step4"),
  ];
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % steps.length);
    }, 2500);
    return () => clearInterval(id);
  }, [steps.length]);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--primary-muted)] bg-[var(--primary-muted)]/30 p-3 text-sm text-dim">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--primary)] border-t-transparent" />
      <div className="flex min-h-[2.5rem] flex-col">
        <span>{t("overlay.thinking.label")}</span>
        <span className="min-h-[1.25rem] text-xs text-[var(--primary)]">
          {steps[index]}
        </span>
      </div>
    </div>
  );
}

export function OverlayChatTimeline({
  messages,
  overlay,
  overlayLang,
  summaryHistory,
  clarificationHistory,
  clarifications,
  clarifyDrafts,
  asks,
  proposedTickers,
  tickerReviewRequired = false,
  confirmedBulkBatches,
  loading,
  confirmed,
  confirming,
  disabled,
  driftHint = null,
  onAskChange,
  onClarifyDraftChange,
  onConfirmProposed,
  onSkipProposedNoAdds,
  onRevokeBulk,
}: Props) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const scrollKey = useMemo(
    () =>
      [
        messages.map((m) => `${m.id}:${m.content}`).join("|"),
        overlay?.rationale ?? "",
        clarifications.length,
        clarificationHistory.length,
        summaryHistory.length,
        loading ? "1" : "0",
      ].join("\n"),
    [
      messages,
      overlay?.rationale,
      clarifications.length,
      clarificationHistory.length,
      summaryHistory.length,
      loading,
    ],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [scrollKey]);

  const cardsDisabled = disabled || confirmed || confirming || loading;
  const batches = confirmedBulkBatches ?? overlay?.confirmed_bulk_batches ?? [];

  return (
    <div
      ref={containerRef}
      onScroll={() => {
        const el = containerRef.current;
        if (!el) return;
        pinnedRef.current =
          el.scrollHeight - el.scrollTop - el.clientHeight <= 24;
      }}
      className="flex max-h-[min(400px,50vh)] min-h-[280px] flex-col gap-3 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3"
    >
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}

      {summaryHistory.map((snap) => (
        <details
          key={snap.id}
          className="rounded-lg border border-[var(--border)]/70 bg-[var(--surface)]/60 px-3 py-2"
        >
          <summary className="cursor-pointer text-xs font-medium text-dim">
            {t("overlay.chat.summaryCardCollapsed")}
          </summary>
          <pre className="mt-2 whitespace-pre-wrap text-xs leading-snug text-[var(--ui-color-body)]">
            {snap.text}
          </pre>
        </details>
      ))}

      {overlay ? (
        <>
          <div className="rounded-lg border border-[var(--primary-muted)] bg-[var(--primary-muted)]/30 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-dim">
              {t("overlay.chat.summaryCard")}
            </p>
            <pre className="mt-1 whitespace-pre-wrap text-xs leading-snug text-[var(--ui-color-body)]">
              {formatOverlaySummary(overlay, overlayLang, {
                hideProposedTickers: clarifications.length > 0,
              })}
            </pre>
            {driftHint && driftHint.minRequiredDrift > 0 ? (
              <div
                className={`mt-2 border-t border-[var(--border)]/60 pt-2 text-xs ${
                  driftHint.feasible ? "text-emerald-700" : "text-amber-800"
                }`}
              >
                <p className="font-medium">{t("overlay.driftHint.title")}</p>
                <p className="mt-0.5">
                  {driftHint.feasible
                    ? t("overlay.driftHint.ok", {
                        pct: Math.round(driftHint.minRequiredDrift * 100),
                        current: Math.round(driftHint.currentDrift * 100),
                      })
                    : t("overlay.driftHint.need", {
                        pct: Math.round(driftHint.minRequiredDrift * 100),
                        current: Math.round(driftHint.currentDrift * 100),
                        suggested: Math.round(driftHint.suggestedDrift * 100),
                      })}
                </p>
                {driftHint.requiresSupervisor ? (
                  <p className="mt-1 text-amber-800">
                    {t("overlay.driftHint.supervisor", {
                      pct: Math.round(driftHint.suggestedDrift * 100),
                    })}
                  </p>
                ) : null}
              </div>
            ) : null}
            {batches.length > 0 && onRevokeBulk ? (
              <div className="mt-2 space-y-1 border-t border-[var(--border)]/60 pt-2">
                {batches.map((b) => (
                  <div
                    key={b.bulk_id}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span className="text-dim">
                      {b.label}（{b.tickers.length}）
                    </span>
                    <button
                      type="button"
                      className="text-amber-800 hover:underline disabled:opacity-40"
                      disabled={cardsDisabled}
                      onClick={() => onRevokeBulk(b.bulk_id)}
                    >
                      {t("overlay.proposedTickers.revokeBulk")}
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <AskCardsInline
            asks={asks}
            disabled={cardsDisabled}
            onChange={onAskChange}
          />

          {clarifications.length > 0 || clarificationHistory.length > 0 ? (
            <OverlayClarificationCards
              clarifications={clarifications}
              drafts={clarifyDrafts}
              history={clarificationHistory}
              disabled={cardsDisabled}
              onDraftChange={onClarifyDraftChange}
            />
          ) : null}

          {!confirmed && clarifications.length === 0 ? (
            <ProposedTickersInline
              candidates={proposedTickers}
              bulkInclude={overlay.universe.bulk_include}
              disabled={cardsDisabled}
              reviewRequired={tickerReviewRequired}
              showDiHint={overlay?.universe.construction === "direct_index"}
              onConfirm={onConfirmProposed}
              onSkipNoAdds={
                tickerReviewRequired ? onSkipProposedNoAdds : undefined
              }
            />
          ) : null}
        </>
      ) : null}

      {loading ? <ThinkingSteps /> : null}
    </div>
  );
}

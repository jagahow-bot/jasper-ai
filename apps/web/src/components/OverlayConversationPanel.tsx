"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatLog, type ChatMessage } from "@/components/ChatLog";
import { useI18n } from "@/lib/i18n";
import {
  parseOverlayInterpretResponseJson,
  resolveOverlayInterpretClientFailure,
} from "@/lib/overlay-interpret-errors";
import { pushLlmAuditLog, type LlmAuditEntry } from "@/lib/llm-audit";
import { uniqueTickers } from "@/lib/locked-universe";
import {
  formatClarificationUserReply,
  formatOverlayAssistantReply,
  formatOverlaySummary,
  signOffOverlay,
  type ClientOverlay,
  type OverlayAsk,
  type OverlayConversationMessage,
  type OverlayProposedTicker,
} from "@/lib/overlay-schema";
import { clearProposedTickers } from "@/lib/overlay-filter-proposals";
import {
  shouldPushUpToParent,
  shouldSyncDownFromParent,
} from "@/lib/overlay-session-sync";

type ContextPosition = {
  ticker: string;
  label?: string;
  weightLabel?: string;
};

type ContextGroup = {
  id: string;
  name: string;
  holdings: ContextPosition[];
};

/** `true` advances; `false` stays; `ClientOverlay` stays and applies merged proposals. */
type OverlayConfirmResult = void | boolean | ClientOverlay;

/** Composer grows with content; beyond this it scrolls internally (~8–10 rows). */
const COMPOSER_MAX_PX = 240;

type Props = {
  rmId?: string;
  clientRef?: string;
  baseScenarioId?: string;
  onConfirm?: (
    overlay: ClientOverlay,
  ) => OverlayConfirmResult | Promise<OverlayConfirmResult>;
  selectedGroups?: ContextGroup[];
  anchorPositions?: ContextPosition[];
  anchorLabel?: string;
  initialMessages?: OverlayConversationMessage[];
  onMessagesChange?: (messages: OverlayConversationMessage[]) => void;
  initialOverlay?: ClientOverlay | null;
  onOverlayChange?: (overlay: ClientOverlay | null) => void;
};

function detectOverlayInputLang(text: string): "en" | "zh" | "ko" {
  const s = text.trim();
  if (!s) return "en";

  // Deterministic heuristic:
  // - Korean uses Hangul syllables.
  // - Chinese uses common Han character ranges (covers both simplified/traditional).
  // - Default to English.
  if (/[\uAC00-\uD7AF]/.test(s)) return "ko";
  if (/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(s)) return "zh";
  return "en";
}

function toChatMessages(messages: OverlayConversationMessage[]): ChatMessage[] {
  return messages.map((m, i) => ({
    id: `msg-${i}`,
    role: m.role,
    content: m.content,
  }));
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
    <div className="flex items-center gap-3 text-sm text-dim">
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

type ProposedTickersPanelProps = {
  candidates: OverlayProposedTicker[];
  onConfirm: (tickers: string[]) => void;
};

const EMPTY_PROPOSED: OverlayProposedTicker[] = [];
const EMPTY_MESSAGES: OverlayConversationMessage[] = [];
const EMPTY_GROUPS: ContextGroup[] = [];
const EMPTY_POSITIONS: ContextPosition[] = [];

function ProposedTickersPanel({ candidates, onConfirm }: ProposedTickersPanelProps) {
  const { t } = useI18n();
  const list = candidates.length ? candidates : EMPTY_PROPOSED;
  const candidateKey = list.map((c) => c.ticker).join("\0");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(list.map((c) => c.ticker)),
  );

  useEffect(() => {
    setSelected((prev) => {
      const nextTickers = candidateKey ? candidateKey.split("\0") : [];
      if (
        prev.size === nextTickers.length &&
        nextTickers.every((t) => prev.has(t))
      ) {
        return prev;
      }
      return new Set(nextTickers);
    });
  }, [candidateKey]);

  if (!list.length) return null;

  const allSelected = selected.size === list.length && list.length > 0;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(list.map((c) => c.ticker)));
  };

  const toggleOne = (ticker: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      return next;
    });
  };

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--foreground)]">
          {t("overlay.proposedTickers.title")}
        </span>
        <button
          type="button"
          onClick={toggleAll}
          className="text-xs text-[var(--primary)] hover:underline"
        >
          {allSelected ? t("overlay.proposedTickers.none") : t("overlay.proposedTickers.all")}
        </button>
      </div>
      <div className="space-y-2">
        {list.map((c) => (
          <label key={c.ticker} className="flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              checked={selected.has(c.ticker)}
              onChange={() => toggleOne(c.ticker)}
              className="mt-0.5"
            />
            <div className="text-sm leading-snug">
              <span className="font-semibold">{c.ticker}</span>
              {c.name && <span className="text-dim"> — {c.name}</span>}
              {c.category && <span className="text-xs text-dim"> ({c.category})</span>}
              {c.rationale && <p className="text-xs text-dim">{c.rationale}</p>}
            </div>
          </label>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onConfirm([...selected])}
        disabled={selected.size === 0}
        className="pixel-btn w-full disabled:opacity-40"
      >
        {t("overlay.proposedTickers.addSelected", { count: selected.size })}
      </button>
    </div>
  );
}

type AskCardsPanelProps = {
  asks: OverlayAsk[];
  disabled?: boolean;
  onChange: (asks: OverlayAsk[]) => void;
};

function AskCardsPanel({ asks, disabled, onChange }: AskCardsPanelProps) {
  const { t } = useI18n();
  if (!asks.length) return null;

  const updateSummary = (id: string, summary: string) => {
    onChange(
      asks.map((a) =>
        a.id === id ? { ...a, summary: summary.slice(0, 400) } : a,
      ),
    );
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <span className="text-xs font-semibold text-[var(--foreground)]">
          {t("overlay.asks.title")}
        </span>
        <span className="text-[10px] text-dim">{t("overlay.asks.softHint")}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {asks.map((ask, i) => (
          <div
            key={ask.id}
            className="flex min-w-0 flex-col rounded-md border border-[var(--border)]/80 bg-[var(--surface)]/70 px-3 py-2"
          >
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="shrink-0 text-xs font-semibold text-dim">
                {i + 1}.
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {ask.title}
              </span>
              <span className="shrink-0 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-dim">
                {ask.kind.replace(/_/g, " ")}
              </span>
            </div>
            <textarea
              value={ask.summary}
              disabled={disabled}
              rows={2}
              onChange={(e) => updateSummary(ask.id, e.target.value)}
              className="pixel-input mt-1.5 max-h-20 w-full resize-y text-xs leading-snug"
              aria-label={t("overlay.asks.summaryLabel")}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

type ClarificationQuestionsPanelProps = {
  questions: string[];
  drafts: string[];
  expandedIndex: number | null;
  disabled?: boolean;
  sendDisabled?: boolean;
  loading?: boolean;
  answeredCount: number;
  onToggle: (index: number) => void;
  onDraftChange: (index: number, value: string) => void;
  onSend: () => void;
};

function ClarificationQuestionsPanel({
  questions,
  drafts,
  expandedIndex,
  disabled,
  sendDisabled,
  loading,
  answeredCount,
  onToggle,
  onDraftChange,
  onSend,
}: ClarificationQuestionsPanelProps) {
  const { t } = useI18n();
  if (!questions.length) return null;

  const sendLabel = loading
    ? t("overlay.clarify.sending")
    : answeredCount > 0
      ? t(
          answeredCount === 1
            ? "overlay.clarify.sendCount"
            : "overlay.clarify.sendCountPlural",
          { count: answeredCount },
        )
      : t("overlay.clarify.send");

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <span className="text-xs font-semibold text-[var(--foreground)]">
          {t("overlay.clarify.title")}
        </span>
        <span className="text-[10px] text-dim">{t("overlay.clarify.clickHint")}</span>
      </div>
      <div className="space-y-1.5">
        {questions.map((question, index) => {
          const open = expandedIndex === index;
          const draft = drafts[index] ?? "";
          const hasAnswer = draft.trim().length > 0;
          return (
            <div
              key={`${index}:${question}`}
              className="rounded-md border border-[var(--border)]/80 bg-[var(--surface)]/70"
            >
              <button
                type="button"
                disabled={disabled}
                aria-expanded={open}
                onClick={() => onToggle(index)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left disabled:opacity-50"
              >
                <span className="shrink-0 text-xs font-semibold text-dim">
                  {index + 1}.
                </span>
                <span className="min-w-0 flex-1 text-sm leading-snug">
                  {question}
                </span>
                {hasAnswer && !open ? (
                  <span className="shrink-0 text-[10px] text-[var(--primary)]">
                    {t("overlay.clarify.answered")}
                  </span>
                ) : (
                  <span className="shrink-0 text-[10px] text-dim">
                    {open ? "▾" : "▸"}
                  </span>
                )}
              </button>
              {open ? (
                <div className="border-t border-[var(--border)]/60 px-3 pb-2 pt-1.5">
                  <textarea
                    value={draft}
                    disabled={disabled}
                    rows={3}
                    onChange={(e) => onDraftChange(index, e.target.value)}
                    placeholder={t("overlay.clarify.answerPlaceholder")}
                    className="pixel-input max-h-32 w-full resize-y text-xs leading-snug"
                    aria-label={t("overlay.clarify.answerPlaceholder")}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-dim">{t("overlay.clarify.sendHint")}</p>
      <button
        type="button"
        onClick={onSend}
        disabled={disabled || sendDisabled}
        className="pixel-btn w-full disabled:opacity-40"
      >
        {sendLabel}
      </button>
    </div>
  );
}

export function OverlayConversationPanel({
  rmId = "rm-demo",
  clientRef,
  baseScenarioId,
  onConfirm,
  selectedGroups = EMPTY_GROUPS,
  anchorPositions = EMPTY_POSITIONS,
  anchorLabel,
  initialMessages = EMPTY_MESSAGES,
  onMessagesChange,
  initialOverlay = null,
  onOverlayChange,
}: Props) {
  const { lang, t } = useI18n();

  const [input, setInput] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [messages, setMessages] = useState<OverlayConversationMessage[]>(initialMessages);
  const [overlay, setOverlay] = useState<ClientOverlay | null>(initialOverlay);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<{
    message: string;
    code?: string;
    detail?: string;
  } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [overlayLang, setOverlayLang] = useState<typeof lang>(lang);
  const [clarifyDrafts, setClarifyDrafts] = useState<string[]>([]);
  const [expandedClarifyIndex, setExpandedClarifyIndex] = useState<number | null>(
    null,
  );

  // Echo-guard refs: last value pushed up (or accepted from parent). Prevents the
  // sync-down ↔ push-up oscillation that hits "Maximum update depth exceeded".
  const lastPushedMessagesRef = useRef(initialMessages);
  const lastPushedOverlayRef = useRef(initialOverlay);
  const onMessagesChangeRef = useRef(onMessagesChange);
  const onOverlayChangeRef = useRef(onOverlayChange);
  onMessagesChangeRef.current = onMessagesChange;
  onOverlayChangeRef.current = onOverlayChange;
  // Invalidate in-flight interpret when confirm starts / completes so a late
  // LLM response cannot re-inject proposed_tickers after sign-off.
  const interpretGenerationRef = useRef(0);
  const confirmLockedRef = useRef(false);
  const sendInFlightRef = useRef(false);

  // Sync local messages when the parent resets/restores (e.g. new client).
  useEffect(() => {
    if (!shouldSyncDownFromParent(initialMessages, lastPushedMessagesRef.current)) {
      return;
    }
    lastPushedMessagesRef.current = initialMessages;
    setMessages(initialMessages);
  }, [initialMessages]);

  // Sync local overlay when the parent restores/updates the session.
  useEffect(() => {
    if (!shouldSyncDownFromParent(initialOverlay, lastPushedOverlayRef.current)) {
      return;
    }
    lastPushedOverlayRef.current = initialOverlay;
    setOverlay(initialOverlay);
  }, [initialOverlay]);

  // Propagate conversation history and overlay state back to the parent so both
  // survive phase changes.
  useEffect(() => {
    if (!shouldPushUpToParent(messages, lastPushedMessagesRef.current)) return;
    lastPushedMessagesRef.current = messages;
    onMessagesChangeRef.current?.(messages);
  }, [messages]);

  useEffect(() => {
    if (!shouldPushUpToParent(overlay, lastPushedOverlayRef.current)) return;
    lastPushedOverlayRef.current = overlay;
    onOverlayChangeRef.current?.(overlay);
  }, [overlay]);

  // If no overlay has been generated yet, keep the overlay language aligned with
  // the current UI locale. Once we generate an overlay, we keep the detected
  // language stable for that response.
  useEffect(() => {
    if (!overlay) setOverlayLang(lang);
  }, [lang, overlay]);

  const clarificationQuestions = overlay?.clarification_questions ?? [];
  const clarificationQuestionsHash = clarificationQuestions.join("\0");
  const clarificationQuestionCount = clarificationQuestions.length;

  // Reset inline answer drafts when the AI question set changes.
  useEffect(() => {
    setClarifyDrafts(Array.from({ length: clarificationQuestionCount }, () => ""));
    setExpandedClarifyIndex(null);
  }, [clarificationQuestionsHash, clarificationQuestionCount]);

  const chatMessages = useMemo(() => toChatMessages(messages), [messages]);

  const hasPendingClarifications = clarificationQuestionCount > 0;
  const answeredCount = clarifyDrafts.filter((d) => d.trim().length > 0).length;
  const hasClarifyAnswers = answeredCount > 0;
  const canSend =
    !loading &&
    !confirmLockedRef.current &&
    (input.trim().length > 0 || hasClarifyAnswers);

  const interpret = useCallback(
    async (
      nextMessages: OverlayConversationMessage[],
      clarificationAnswers?: { question: string; answer: string }[],
    ) => {
      if (confirmLockedRef.current) return;
      const generation = ++interpretGenerationRef.current;
      setLoading(true);
      setError(null);
      try {
        const latestUserText =
          [...nextMessages].reverse().find((m) => m.role === "user")?.content ?? "";
        const detectedLang = detectOverlayInputLang(latestUserText);
        const reportLanguage = detectedLang === "zh" ? "zh-TW" : detectedLang;

        const res = await fetch("/api/overlay/interpret", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: nextMessages,
            prior_overlay: overlay,
            session_id: overlay?.audit.session_id,
            rm_id: rmId,
            client_ref: clientRef,
            base_scenario_id: baseScenarioId,
            report_language: reportLanguage,
            selected_groups: selectedGroups,
            anchor_positions: anchorPositions,
            anchor_label: anchorLabel,
            ...(clarificationAnswers?.length
              ? { clarification_answers: clarificationAnswers }
              : {}),
          }),
        });
        // Drop stale responses that finished after a newer send or after confirm.
        if (
          generation !== interpretGenerationRef.current ||
          confirmLockedRef.current
        ) {
          return;
        }
        // Prefer text→JSON so empty/non-JSON bodies become structured failures
        // instead of throwing into the generic catch.
        const rawText = await res.text();
        if (
          generation !== interpretGenerationRef.current ||
          confirmLockedRef.current
        ) {
          return;
        }
        const data = parseOverlayInterpretResponseJson(rawText);
        const interpretedOverlay =
          data && typeof data === "object" && "overlay" in data
            ? (data as { overlay?: ClientOverlay }).overlay
            : undefined;
        const llmLog =
          data && typeof data === "object" && "llm_log" in data
            ? (data as { llm_log?: LlmAuditEntry }).llm_log
            : undefined;
        pushLlmAuditLog(llmLog);

        if (!res.ok || !interpretedOverlay) {
          const failure = resolveOverlayInterpretClientFailure(data, res.status);
          // Use warn + a single string: Next.js patches console.error and turns
          // object args into a red overlay that falsely shows as "{}".
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              `[overlay/interpret] HTTP ${res.status}: ${JSON.stringify(data)}`,
            );
          }
          const err = {
            message: failure.preferI18n
              ? t(failure.messageKey)
              : failure.messageFallback,
            code: failure.code,
            detail: failure.detail,
          };
          setError(err);
          setMessages((prev) => [...prev, { role: "assistant", content: err.message }]);
          return;
        }

        const source =
          data && typeof data === "object" && "source" in data
            ? (data as { source?: "gemini" | "rules" }).source
            : undefined;
        if (process.env.NODE_ENV !== "production") {
          console.info("[overlay/ui]", {
            source: source === "rules" ? "fallback" : (source ?? "unknown"),
            question_count: interpretedOverlay.clarification_questions?.length ?? 0,
            liquidity_amount_usd: interpretedOverlay.client_profile.liquidity_need?.amount_usd,
          });
        }

        setOverlay(interpretedOverlay);
        setOverlayLang(detectedLang);

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: formatOverlayAssistantReply(interpretedOverlay, detectedLang),
          },
        ]);
      } catch {
        if (
          generation !== interpretGenerationRef.current ||
          confirmLockedRef.current
        ) {
          return;
        }
        const err = { message: t("overlay.interpret.error.generic") };
        setError(err);
        setMessages((prev) => [...prev, { role: "assistant", content: err.message }]);
      } finally {
        if (generation === interpretGenerationRef.current) {
          setLoading(false);
        }
      }
    },
    [overlay, rmId, clientRef, baseScenarioId, selectedGroups, anchorPositions, anchorLabel, t],
  );

  const send = async () => {
    if (!canSend || sendInFlightRef.current) return;
    sendInFlightRef.current = true;

    const notes = input.trim();
    const pairs = clarificationQuestions
      .map((question, i) => ({
        question,
        answer: (clarifyDrafts[i] ?? "").trim(),
      }))
      .filter((p) => p.answer.length > 0);

    const content = hasPendingClarifications
      ? formatClarificationUserReply({
          answers: pairs,
          notes,
          lang: overlayLang,
        })
      : notes;

    if (!content) {
      sendInFlightRef.current = false;
      return;
    }

    const userMsg: OverlayConversationMessage = { role: "user", content };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setClarifyDrafts(clarificationQuestions.map(() => ""));
    setExpandedClarifyIndex(null);
    setConfirmed(false);
    try {
      await interpret(nextMessages, pairs.length ? pairs : undefined);
    } finally {
      sendInFlightRef.current = false;
    }
  };

  const handleConfirm = async () => {
    if (!overlay || loading || confirming || confirmLockedRef.current) return;
    const signed = signOffOverlay(overlay, rmId);
    // Invalidate in-flight interpret before awaiting parent resolve so a late
    // response cannot reopen proposed_tickers after sign-off.
    interpretGenerationRef.current += 1;
    confirmLockedRef.current = true;
    setLoading(false);
    // Do not setOverlay(signed) before onConfirm returns — parent may inject
    // filter proposed_tickers and return false. Pushing signed first races the
    // parent update and remounts ProposedTickersPanel in a loop.
    if (onConfirm) {
      setConfirming(true);
      setError(null);
      try {
        const result = await Promise.resolve(onConfirm(signed));
        if (
          result &&
          typeof result === "object" &&
          "universe" in result &&
          "audit" in result
        ) {
          // Parent asked to stay on overlay with merged proposals (legacy path).
          confirmLockedRef.current = false;
          setOverlay(result);
          setConfirmed(false);
          return;
        }
        if (result === false) {
          confirmLockedRef.current = false;
          setConfirmed(false);
          return;
        }
      } catch (err) {
        confirmLockedRef.current = false;
        const message =
          err instanceof Error && err.message.trim()
            ? err.message
            : t("overlay.interpret.error.generic");
        setError({ message });
        setConfirmed(false);
        return;
      } finally {
        setConfirming(false);
      }
    }
    // Drop any pending proposed_tickers so a late parent↔child sync cannot
    // revive the suggestions panel after sign-off.
    const finalized = clearProposedTickers(signed);
    lastPushedOverlayRef.current = finalized;
    setOverlay(finalized);
    setConfirmed(true);
  };

  const confirmProposedTickers = (tickers: string[]) => {
    if (!overlay || tickers.length === 0) return;
    const normalized = uniqueTickers(tickers);
    const updatedSupplements = uniqueTickers([
      ...(overlay.universe.supplement_tickers ?? []),
      ...normalized,
    ]);
    const selectedSet = new Set(normalized.map((t) => t.toUpperCase()));
    const remainingProposed = overlay.universe.proposed_tickers?.filter(
      (p) => !selectedSet.has(p.ticker.toUpperCase()),
    );
    const updatedOverlay: ClientOverlay = {
      ...overlay,
      universe: {
        ...overlay.universe,
        supplement_tickers: updatedSupplements,
        proposed_tickers: remainingProposed?.length ? remainingProposed : undefined,
      },
    };
    setOverlay(updatedOverlay);
    setConfirmed(false);

    const list = normalized.join(overlayLang === "zh" ? "、" : ", ");
    const userMsg = t("overlay.chat.confirmAdd", { list });
    const assistantMsg = t("overlay.proposedTickers.confirmMessage", { tickers: list });
    setMessages((prev) => [
      ...prev,
      { role: "user", content: userMsg },
      { role: "assistant", content: assistantMsg },
    ]);
  };

  const phaseLabel =
    overlay?.audit.phase ?? t("overlay.chat.phaseDiscovery");

  const [chatOpen, setChatOpen] = useState(() => chatMessages.length > 0);

  // Grow composer with content up to a fixed cap, then scroll internally.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_PX)}px`;
  }, [input]);

  const chatTitle = t("overlay.chat.title");

  const chatInputBlock = (
    <>
      <div className="flex shrink-0 items-end gap-2">
        <textarea
          ref={composerRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
          rows={2}
          placeholder={
            hasPendingClarifications
              ? t("overlay.clarify.composerPending")
              : t("overlay.chat.placeholder")
          }
          className="pixel-input min-h-[44px] max-h-[240px] flex-1 resize-none overflow-y-auto"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!canSend}
          className="pixel-btn shrink-0 self-end disabled:opacity-40"
        >
          {loading ? t("overlay.chat.sending") : t("overlay.chat.send")}
        </button>
      </div>

      {error && (
        <div className="text-sm text-[var(--magenta)]">
          <p>{error.message}</p>
          {(error.code || error.detail) && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-dim hover:text-[var(--foreground)]">
                {t("overlay.chat.errorDetails")}
              </summary>
              <div className="mt-1 space-y-1 rounded-md border border-[var(--magenta)]/30 bg-[var(--magenta)]/5 p-2 font-mono text-xs">
                {error.code && <p>Code: {error.code}</p>}
                {error.detail && <p>{error.detail}</p>}
              </div>
            </details>
          )}
        </div>
      )}
    </>
  );

  return (
    <>
      {overlay && (
        <div className="pixel-panel min-w-0 space-y-3 border-[var(--primary-muted)] bg-[var(--primary-muted)]/40">
          <div className="flex items-center justify-between gap-2">
            <span className="ui-section-title">{t("overlay.chat.aiSummaryTitle")}</span>
            <span className="text-xs text-dim">
              {t("overlay.chat.phaseLabel")}: {phaseLabel}
            </span>
          </div>
          <pre className="ui-body whitespace-pre-wrap leading-snug">
            {formatOverlaySummary(overlay, overlayLang)}
          </pre>
          <AskCardsPanel
            asks={overlay.asks ?? []}
            disabled={confirmed || confirming}
            onChange={(asks) => {
              setOverlay({ ...overlay, asks });
              setConfirmed(false);
            }}
          />
          <ClarificationQuestionsPanel
            questions={clarificationQuestions}
            drafts={clarifyDrafts}
            expandedIndex={expandedClarifyIndex}
            disabled={confirmed || confirming || loading}
            sendDisabled={!canSend}
            loading={loading}
            answeredCount={answeredCount}
            onToggle={(index) =>
              setExpandedClarifyIndex((prev) => (prev === index ? null : index))
            }
            onDraftChange={(index, value) => {
              setClarifyDrafts((prev) => {
                const next = [...prev];
                while (next.length < clarificationQuestions.length) next.push("");
                next[index] = value;
                return next;
              });
              setConfirmed(false);
            }}
            onSend={() => void send()}
          />
          <p className="text-xs text-dim">{overlay.rationale}</p>
          <ProposedTickersPanel
            candidates={
              confirmed
                ? EMPTY_PROPOSED
                : (overlay.universe.proposed_tickers ?? EMPTY_PROPOSED)
            }
            onConfirm={confirmProposedTickers}
          />
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={confirmed || loading || confirming}
            className="pixel-btn w-full disabled:opacity-40"
          >
            {confirmed
              ? t("overlay.chat.confirmed")
              : confirming
                ? t("overlay.chat.confirming")
                : t("overlay.chat.confirm")}
          </button>
        </div>
      )}

      {chatOpen ? (
        <div
          className="flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
          data-overlay-chat
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="ui-panel-title text-sm">{chatTitle}</h3>
              <p className="mt-0.5 text-xs text-dim">{t("overlay.chat.subtitle")}</p>
            </div>
            <button
              type="button"
              onClick={() => setChatOpen(false)}
              aria-label={t("overlay.chat.collapseAria")}
              className="shrink-0 rounded-md px-2 py-0.5 text-xs text-dim hover:bg-[var(--surface-2)]"
            >
              {t("overlay.chat.collapse")}
            </button>
          </div>

          <div className="h-[200px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2">
            <ChatLog variant="conversation" messages={chatMessages} />
          </div>

          {loading && (
            <div className="rounded-lg border border-[var(--primary-muted)] bg-[var(--primary-muted)]/30 p-3">
              <ThinkingSteps />
            </div>
          )}

          {chatInputBlock}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="w-full rounded-lg border border-[var(--primary)]/40 bg-[var(--primary)]/5 px-4 py-2.5 text-sm font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/10"
          data-overlay-chat-open
        >
          {t("overlay.chat.openCta")}
        </button>
      )}
    </>
  );
}

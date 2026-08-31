"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@/components/ChatLog";
import {
  OverlayChatTimeline,
  type SummarySnapshot,
} from "@/components/OverlayChatTimeline";
import { useI18n } from "@/lib/i18n";
import {
  parseOverlayInterpretResponseJson,
  resolveOverlayInterpretClientFailure,
} from "@/lib/overlay-interpret-errors";
import { pushLlmAuditLog, type LlmAuditEntry } from "@/lib/llm-audit";
import { uniqueTickers } from "@/lib/locked-universe";
import {
  buildClarificationAnswer,
  clarificationsHash,
  emptyClarificationDraft,
  resolveClarifications,
  type ClarificationDraft,
  type ClarificationSnapshot,
} from "@/lib/overlay-clarifications";
import {
  formatClarificationUserReply,
  formatOverlayAssistantReply,
  formatOverlaySummary,
  signOffOverlay,
  type ClientOverlay,
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

const EMPTY_PROPOSED: OverlayProposedTicker[] = [];
const EMPTY_MESSAGES: OverlayConversationMessage[] = [];
const EMPTY_GROUPS: ContextGroup[] = [];
const EMPTY_POSITIONS: ContextPosition[] = [];

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
  const [clarifyDrafts, setClarifyDrafts] = useState<ClarificationDraft[]>([]);
  const [clarificationHistory, setClarificationHistory] = useState<
    ClarificationSnapshot[]
  >([]);
  const [summaryHistory, setSummaryHistory] = useState<SummarySnapshot[]>([]);

  const lastPushedMessagesRef = useRef(initialMessages);
  const lastPushedOverlayRef = useRef(initialOverlay);
  const onMessagesChangeRef = useRef(onMessagesChange);
  const onOverlayChangeRef = useRef(onOverlayChange);
  onMessagesChangeRef.current = onMessagesChange;
  onOverlayChangeRef.current = onOverlayChange;
  const interpretGenerationRef = useRef(0);
  const confirmLockedRef = useRef(false);
  const sendInFlightRef = useRef(false);

  useEffect(() => {
    if (!shouldSyncDownFromParent(initialMessages, lastPushedMessagesRef.current)) {
      return;
    }
    lastPushedMessagesRef.current = initialMessages;
    setMessages(initialMessages);
    if (initialMessages.length === 0) {
      setClarificationHistory([]);
      setSummaryHistory([]);
    }
  }, [initialMessages]);

  useEffect(() => {
    if (!shouldSyncDownFromParent(initialOverlay, lastPushedOverlayRef.current)) {
      return;
    }
    lastPushedOverlayRef.current = initialOverlay;
    setOverlay(initialOverlay);
    if (!initialOverlay) {
      setClarificationHistory([]);
      setSummaryHistory([]);
    }
  }, [initialOverlay]);

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

  useEffect(() => {
    if (!overlay) setOverlayLang(lang);
  }, [lang, overlay]);

  const clarifications = useMemo(
    () => resolveClarifications(overlay, overlayLang),
    [overlay, overlayLang],
  );
  const clarificationsKey = clarificationsHash(clarifications);

  useEffect(() => {
    setClarifyDrafts(
      Array.from({ length: clarifications.length }, () =>
        emptyClarificationDraft(),
      ),
    );
  }, [clarificationsKey, clarifications.length]);

  const chatMessages = useMemo(() => toChatMessages(messages), [messages]);

  const hasPendingClarifications = clarifications.length > 0;
  const answeredCount = clarifications.filter((c, i) =>
    buildClarificationAnswer(
      c,
      clarifyDrafts[i] ?? emptyClarificationDraft(),
      overlayLang,
    ).trim(),
  ).length;
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
        if (
          generation !== interpretGenerationRef.current ||
          confirmLockedRef.current
        ) {
          return;
        }
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

        if (process.env.NODE_ENV !== "production") {
          const source =
            data && typeof data === "object" && "source" in data
              ? (data as { source?: "gemini" | "rules" }).source
              : undefined;
          console.info("[overlay/ui]", {
            source: source === "rules" ? "fallback" : (source ?? "unknown"),
            question_count:
              interpretedOverlay.clarifications?.length ??
              interpretedOverlay.clarification_questions?.length ??
              0,
          });
        }

        setOverlay(interpretedOverlay);
        setOverlayLang(detectedLang);

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: formatOverlayAssistantReply(interpretedOverlay),
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
    const pairs = clarifications
      .map((c, i) => ({
        question: c.question,
        answer: buildClarificationAnswer(
          c,
          clarifyDrafts[i] ?? emptyClarificationDraft(),
          overlayLang,
        ).trim(),
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

    if (overlay) {
      setSummaryHistory((prev) => [
        ...prev,
        {
          id: `sum-${Date.now()}`,
          text: formatOverlaySummary(overlay, overlayLang),
        },
      ]);
    }
    if (pairs.length) {
      setClarificationHistory((prev) => [
        ...prev,
        { id: `snap-${Date.now()}`, items: pairs },
      ]);
    }

    const userMsg: OverlayConversationMessage = { role: "user", content };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setClarifyDrafts(clarifications.map(() => emptyClarificationDraft()));
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
    interpretGenerationRef.current += 1;
    confirmLockedRef.current = true;
    setLoading(false);
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
    const selectedSet = new Set(normalized.map((ticker) => ticker.toUpperCase()));
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
    const assistantMsg = t("overlay.proposedTickers.confirmMessage", {
      tickers: list,
    });
    setMessages((prev) => [
      ...prev,
      { role: "user", content: userMsg },
      { role: "assistant", content: assistantMsg },
    ]);
  };

  const phaseLabel = overlay?.audit.phase ?? t("overlay.chat.phaseDiscovery");

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_PX)}px`;
  }, [input]);

  const proposedTickers =
    confirmed || !overlay
      ? EMPTY_PROPOSED
      : (overlay.universe.proposed_tickers ?? EMPTY_PROPOSED);

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
      data-overlay-chat
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="ui-panel-title text-sm">{t("overlay.chat.title")}</h3>
          <p className="mt-0.5 text-xs text-dim">{t("overlay.chat.subtitle")}</p>
        </div>
        {overlay ? (
          <span className="shrink-0 text-xs text-dim">
            {t("overlay.chat.phaseLabel")}: {phaseLabel}
          </span>
        ) : null}
      </div>

      <OverlayChatTimeline
        messages={chatMessages}
        overlay={overlay}
        overlayLang={overlayLang}
        summaryHistory={summaryHistory}
        clarificationHistory={clarificationHistory}
        clarifications={clarifications}
        clarifyDrafts={clarifyDrafts}
        asks={overlay?.asks ?? []}
        proposedTickers={proposedTickers}
        loading={loading}
        confirmed={confirmed}
        confirming={confirming}
        onAskChange={(asks) => {
          if (!overlay) return;
          setOverlay({ ...overlay, asks });
          setConfirmed(false);
        }}
        onClarifyDraftChange={(index, draft) => {
          setClarifyDrafts((prev) => {
            const next = [...prev];
            while (next.length < clarifications.length) {
              next.push(emptyClarificationDraft());
            }
            next[index] = draft;
            return next;
          });
          setConfirmed(false);
        }}
        onConfirmProposed={confirmProposedTickers}
      />

      <div className="flex shrink-0 flex-wrap items-end gap-2">
        <textarea
          ref={composerRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading || confirming}
          rows={2}
          placeholder={
            hasPendingClarifications
              ? t("overlay.clarify.composerPending")
              : t("overlay.chat.placeholder")
          }
          className="pixel-input min-h-[44px] max-h-[240px] min-w-[12rem] flex-1 resize-none overflow-y-auto"
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
        {overlay ? (
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={confirmed || loading || confirming}
            className="pixel-btn shrink-0 self-end border border-[var(--primary)] bg-white text-[var(--primary)] hover:bg-[var(--primary-muted)] disabled:opacity-40"
          >
            {confirmed
              ? t("overlay.chat.confirmed")
              : confirming
                ? t("overlay.chat.confirming")
                : t("overlay.chat.confirm")}
          </button>
        ) : null}
      </div>

      {error ? (
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
      ) : null}
    </div>
  );
}

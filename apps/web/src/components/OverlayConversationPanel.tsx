"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@/components/ChatLog";
import {
  OverlayChatTimeline,
  type SummarySnapshot,
} from "@/components/OverlayChatTimeline";
import { OverlayConflictDialog } from "@/components/OverlayConflictDialog";
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
import {
  clearProposedTickers,
  ensureProposedTickersForReview,
  instrumentNeedsKey,
  isTickerReviewBlocking,
  proposedTickersAfterClarificationDedup,
} from "@/lib/overlay-filter-proposals";
import { computeOverlayDriftHints } from "@/lib/overlay-drift-sync";
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
const QUANT_API =
  process.env.NEXT_PUBLIC_QUANT_API_BASE || "http://127.0.0.1:8001";

type Props = {
  rmId?: string;
  clientRef?: string;
  baseScenarioId?: string;
  /** Current run customization_drift for mechanical conflict pre-check. */
  customizationDrift?: number;
  onConfirm?: (
    overlay: ClientOverlay,
  ) => OverlayConfirmResult | Promise<OverlayConfirmResult>;
  /** When RM chooses raise-drift, parent can sync BacktestRequest.customization_drift. */
  onRaiseDrift?: (drift: number) => void;
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
  customizationDrift,
  onConfirm,
  onRaiseDrift,
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
  /** instrumentNeedsKey acknowledged via「無新增標的」. */
  const [noAddsAckKey, setNoAddsAckKey] = useState<string | null>(null);
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
      setNoAddsAckKey(null);
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
      setNoAddsAckKey(null);
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
  const pendingConflicts = overlay?.conflicts ?? [];
  const hasPendingConflicts = pendingConflicts.length > 0;
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
    !hasPendingConflicts &&
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
            customization_drift: customizationDrift,
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

        setOverlay(
          ensureProposedTickersForReview(interpretedOverlay, detectedLang),
        );
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
    [overlay, rmId, clientRef, baseScenarioId, selectedGroups, anchorPositions, anchorLabel, customizationDrift, t],
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
    if (
      !overlay ||
      loading ||
      confirming ||
      confirmLockedRef.current ||
      hasPendingConflicts
    ) {
      return;
    }
    const visibleForGate = proposedTickersAfterClarificationDedup(
      overlay.universe.proposed_tickers,
      clarifications,
    );
    if (
      isTickerReviewBlocking(overlay, {
        visibleProposed: visibleForGate,
        noAddsAckKey,
        hasPendingClarifications,
      })
    ) {
      setError({ message: t("overlay.proposedTickers.reviewRequired") });
      return;
    }
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

  const clearConflicts = useCallback((next: ClientOverlay): ClientOverlay => {
    return {
      ...next,
      conflicts: undefined,
      audit: {
        ...next.audit,
        phase: next.audit.phase === "clarify" ? "confirm" : next.audit.phase,
      },
    };
  }, []);

  const handleConflictChoice = useCallback(
    async (optionId: string) => {
      if (!overlay || !pendingConflicts.length) return;
      const conflict = pendingConflicts[0]!;
      const gap = conflict.gap_stub;

      if (optionId === "raise-drift") {
        const drift = Math.max(
          0,
          Math.min(1, conflict.suggested_drift ?? customizationDrift ?? 0.5),
        );
        onRaiseDrift?.(drift);
        const raised: ClientOverlay = clearConflicts({
          ...overlay,
          param_adjustments: {
            ...overlay.param_adjustments,
            customization_drift_actual: {
              mode: "fixed",
              fixed: drift,
            },
          },
        });
        setOverlay(raised);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              overlayLang === "zh"
                ? `已將客製化偏離上限調整為 ${Math.round(drift * 100)}%。請再確認 Overlay。`
                : `Customization drift raised to ${Math.round(drift * 100)}%. Confirm the overlay when ready.`,
          },
        ]);
        return;
      }

      if (optionId === "submit-gap" && gap) {
        try {
          await fetch(`${QUANT_API}/gaps`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              stage: gap.stage,
              kind: gap.kind,
              missing_capability: gap.missing_capability,
              summary: gap.summary,
              requested: gap.requested ?? {},
              nearest_supported: gap.nearest_supported ?? null,
              rm_id: rmId,
              client_ref: clientRef ?? null,
              overlay_session_id: overlay.audit.session_id,
              lang: overlayLang,
            }),
          });
        } catch {
          // Non-blocking: still clear the card so RM is not stuck.
        }
        const after = clearConflicts(overlay);
        const withGap: ClientOverlay = {
          ...after,
          capability_gaps: [
            ...(after.capability_gaps ?? []).filter(
              (g) => g.missing_capability !== gap.missing_capability,
            ),
            gap,
          ],
        };
        setOverlay(withGap);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              overlayLang === "zh"
                ? `已提交能力缺口（${gap.missing_capability}）。目前可繼續用最接近方案，或改寫需求後再送出。`
                : `Capability gap submitted (${gap.missing_capability}). You may continue with the nearest supported plan.`,
          },
        ]);
        return;
      }

      // accept-nearest | soften-target | default → acknowledge and unblock confirm
      const softened = clearConflicts(overlay);
      setOverlay(softened);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            optionId === "soften-target"
              ? overlayLang === "zh"
                ? "已記錄為縮小配置差異。請用較小衛星權重改寫需求，或直接確認目前最接近方案。"
                : "Recorded as soften-target. Adjust to smaller satellite weights, or confirm the nearest plan."
              : overlayLang === "zh"
                ? "已接受目前最接近方案（單層偏離）。確認 Overlay 後可繼續回測。"
                : "Accepted the nearest single-layer plan. Confirm the overlay to continue.",
        },
      ]);
    },
    [
      overlay,
      pendingConflicts,
      customizationDrift,
      onRaiseDrift,
      clearConflicts,
      overlayLang,
      rmId,
      clientRef,
    ],
  );

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
    // Adding names satisfies the review gate for this needs fingerprint.
    setNoAddsAckKey(null);

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

  const skipProposedNoAdds = () => {
    if (!overlay) return;
    const key = instrumentNeedsKey(overlay);
    setNoAddsAckKey(key);
    setOverlay(clearProposedTickers(overlay));
    setConfirmed(false);
    setError(null);
    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: t("overlay.proposedTickers.skipNoAdds"),
      },
      {
        role: "assistant",
        content: t("overlay.proposedTickers.skipNoAddsMessage"),
      },
    ]);
  };

  const phaseLabel = overlay?.audit.phase ?? t("overlay.chat.phaseDiscovery");

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, COMPOSER_MAX_PX)}px`;
  }, [input]);

  const proposedTickers = useMemo(() => {
    if (confirmed || !overlay) return EMPTY_PROPOSED;
    return proposedTickersAfterClarificationDedup(
      overlay.universe.proposed_tickers,
      clarifications,
    );
  }, [confirmed, overlay, clarifications]);

  const tickerReviewRequired = useMemo(() => {
    if (confirmed || !overlay) return false;
    return isTickerReviewBlocking(overlay, {
      visibleProposed: proposedTickers,
      noAddsAckKey,
      hasPendingClarifications,
    });
  }, [confirmed, overlay, proposedTickers, noAddsAckKey, hasPendingClarifications]);

  const driftHint = useMemo(
    () =>
      computeOverlayDriftHints(overlay, {
        anchorPositions,
        currentDrift: customizationDrift ?? 0.5,
      }),
    [overlay, anchorPositions, customizationDrift],
  );

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
        tickerReviewRequired={tickerReviewRequired}
        loading={loading}
        confirmed={confirmed}
        confirming={confirming}
        driftHint={driftHint}
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
        onSkipProposedNoAdds={skipProposedNoAdds}
      />

      {hasPendingConflicts
        ? pendingConflicts.map((conflict) => (
            <OverlayConflictDialog
              key={conflict.id}
              conflict={conflict}
              onChoose={(optionId) => {
                void handleConflictChoice(optionId);
              }}
            />
          ))
        : null}

      <div className="flex shrink-0 flex-wrap items-end gap-2">
        <textarea
          ref={composerRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading || confirming || hasPendingConflicts}
          rows={2}
          placeholder={
            hasPendingConflicts
              ? overlayLang === "zh"
                ? "請先處理上方衝突選項…"
                : "Resolve the conflict card above first…"
              : hasPendingClarifications
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
            disabled={
              confirmed ||
              loading ||
              confirming ||
              hasPendingConflicts ||
              tickerReviewRequired
            }
            className="pixel-btn shrink-0 self-end border border-[var(--primary)] bg-white text-[var(--primary)] hover:bg-[var(--primary-muted)] disabled:opacity-40"
            title={
              tickerReviewRequired
                ? t("overlay.proposedTickers.reviewRequired")
                : undefined
            }
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

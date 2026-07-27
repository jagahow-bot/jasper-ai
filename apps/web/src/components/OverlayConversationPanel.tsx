"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChatLog, type ChatMessage } from "@/components/ChatLog";
import { useI18n } from "@/lib/i18n";
import {
  isOverlayInterpretErrorBody,
  overlayInterpretErrorI18nKey,
} from "@/lib/overlay-interpret-errors";
import { pushLlmAuditLog, type LlmAuditEntry } from "@/lib/llm-audit";
import { uniqueTickers } from "@/lib/locked-universe";
import {
  formatOverlayAssistantReply,
  formatOverlaySummary,
  signOffOverlay,
  type ClientOverlay,
  type OverlayConversationMessage,
  type OverlayProposedTicker,
} from "@/lib/overlay-schema";

type Props = {
  rmId?: string;
  clientRef?: string;
  baseScenarioId?: string;
  onConfirm?: (overlay: ClientOverlay) => void;
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
      <div className="flex flex-col">
        <span>{t("overlay.thinking.label")}</span>
        <span className="text-xs text-[var(--primary)]">{steps[index]}</span>
      </div>
    </div>
  );
}

type ProposedTickersPanelProps = {
  candidates: OverlayProposedTicker[];
  onConfirm: (tickers: string[]) => void;
};

function ProposedTickersPanel({ candidates, onConfirm }: ProposedTickersPanelProps) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(candidates.map((c) => c.ticker)),
  );
  const candidateIds = useMemo(() => candidates.map((c) => c.ticker), [candidates]);

  useEffect(() => {
    setSelected(new Set(candidateIds));
  }, [candidateIds]);

  const allSelected = selected.size === candidates.length && candidates.length > 0;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(candidates.map((c) => c.ticker)));
  };

  const toggleOne = (ticker: string) => {
    const next = new Set(selected);
    if (next.has(ticker)) next.delete(ticker);
    else next.add(ticker);
    setSelected(next);
  };

  if (!candidates.length) return null;

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
        {candidates.map((c) => (
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

export function OverlayConversationPanel({
  rmId = "rm-demo",
  clientRef,
  baseScenarioId,
  onConfirm,
}: Props) {
  const { lang, t } = useI18n();

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<OverlayConversationMessage[]>([]);
  const [overlay, setOverlay] = useState<ClientOverlay | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{
    message: string;
    code?: string;
    detail?: string;
  } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [overlayLang, setOverlayLang] = useState<typeof lang>(lang);

  // If no overlay has been generated yet, keep the overlay language aligned with
  // the current UI locale. Once we generate an overlay, we keep the detected
  // language stable for that response.
  useEffect(() => {
    if (!overlay) setOverlayLang(lang);
  }, [lang, overlay]);

  const interpret = useCallback(
    async (nextMessages: OverlayConversationMessage[]) => {
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
          }),
        });
        const data: unknown = await res.json();
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
          if (process.env.NODE_ENV !== "production") {
            console.error("[overlay/interpret] error response", data);
          }
          const err = isOverlayInterpretErrorBody(data)
            ? {
                message: t(overlayInterpretErrorI18nKey(data.code)),
                code: data.code,
                detail: data.detail,
              }
            : data &&
                typeof data === "object" &&
                "error" in data &&
                typeof (data as { error?: unknown }).error === "string"
              ? { message: (data as { error: string }).error }
              : { message: t("overlay.interpret.error.generic") };
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
        const err = { message: t("overlay.interpret.error.generic") };
        setError(err);
        setMessages((prev) => [...prev, { role: "assistant", content: err.message }]);
      } finally {
        setLoading(false);
      }
    },
    [overlay, rmId, clientRef, baseScenarioId, t],
  );

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const userMsg: OverlayConversationMessage = { role: "user", content: text };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setConfirmed(false);
    await interpret(nextMessages);
  };

  const handleConfirm = () => {
    if (!overlay) return;
    const signed = signOffOverlay(overlay, rmId);
    setOverlay(signed);
    setConfirmed(true);
    onConfirm?.(signed);
  };

  const confirmProposedTickers = (tickers: string[]) => {
    if (!overlay || tickers.length === 0) return;
    const normalized = uniqueTickers(tickers);
    const updatedSupplements = uniqueTickers([
      ...(overlay.universe.supplement_tickers ?? []),
      ...normalized,
    ]);
    const remainingProposed = overlay.universe.proposed_tickers?.filter(
      (p) => !normalized.includes(p.ticker),
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

    const list = normalized.join(
      overlayLang === "zh" ? "、" : ", ",
    );
    const userMsg =
      overlayLang === "zh"
        ? `確認加入 ${list}`
        : overlayLang === "ko"
          ? `${list} 추가 확인`
          : `Confirm adding ${list}`;
    const assistantMsg = t("overlay.proposedTickers.confirmMessage", { tickers: list });
    setMessages((prev) => [
      ...prev,
      { role: "user", content: userMsg },
      { role: "assistant", content: assistantMsg },
    ]);
  };

  const phaseLabel =
    overlay?.audit.phase ??
    (overlayLang === "zh" ? "探索" : "discovery");

  return (
    <div className="pixel-panel flex min-h-0 flex-col gap-4">
      <div>
        <h3 className="ui-panel-title">
          {lang === "zh"
            ? "客戶需求對話"
            : lang === "ko"
              ? "고객 니즈 대화"
              : "Conversational Overlay"}
        </h3>
        <p className="mt-2 text-sm text-dim">
          {lang === "zh"
            ? "輸入客戶投資需求，Japser AI會引導釐清需求，並著手設計模型參數"
            : lang === "ko"
              ? "고객 투자 니즈를 입력하세요. Japser AI가 니즈를 명확히 하고 모델 파라미터 설계를 시작합니다."
              : "Enter the client's investment needs; Japser AI will guide requirement clarification and begin designing model parameters."}
        </p>
      </div>

      <div className="max-h-[280px] min-h-40 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2">
        <ChatLog variant="conversation" messages={toChatMessages(messages)} />
      </div>

      {loading && (
        <div className="rounded-lg border border-[var(--primary-muted)] bg-[var(--primary-muted)]/30 p-3">
          <ThinkingSteps />
        </div>
      )}

      <div className="flex shrink-0 items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
          rows={6}
          placeholder={
            lang === "zh"
              ? "例如：客戶想要增加AI產業布局，未來5年內有資金動用需求，所以不希望投資風險過高。"
              : lang === "ko"
                ? "예: 고객은 AI 산업 비중을 늘리고 싶지만, 향후 5년 내 자금 사용 계획이 있어 투자 위험이 너무 높지 않기를 원합니다."
                : "e.g. The client wants to increase AI sector exposure, but expects to use funds within the next 5 years, so they do not want investment risk to be too high."
          }
          className="pixel-input min-h-[160px] flex-1 resize-y"
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
          disabled={loading || !input.trim()}
          className="pixel-btn shrink-0 self-end disabled:opacity-40"
        >
          {loading
            ? lang === "zh"
              ? "分析中…"
              : "Analyzing…"
            : lang === "zh"
              ? "送出"
              : "Send"}
        </button>
      </div>

      {error && (
        <div className="text-sm text-[var(--magenta)]">
          <p>{error.message}</p>
          {(error.code || error.detail) && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-dim hover:text-[var(--foreground)]">
                Error details
              </summary>
              <div className="mt-1 space-y-1 rounded-md border border-[var(--magenta)]/30 bg-[var(--magenta)]/5 p-2 font-mono text-xs">
                {error.code && <p>Code: {error.code}</p>}
                {error.detail && <p>{error.detail}</p>}
              </div>
            </details>
          )}
        </div>
      )}

      {overlay && (
        <div className="space-y-3 rounded-lg border border-[var(--primary-muted)] bg-[var(--primary-muted)]/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="ui-section-title">
              {lang === "zh" ? "AI 理解的 Overlay" : "AI overlay summary"}
            </span>
            <span className="text-xs text-dim">
              {lang === "zh" ? "階段" : "Phase"}: {phaseLabel}
            </span>
          </div>
          <pre className="ui-body whitespace-pre-wrap leading-snug">
            {formatOverlaySummary(overlay, overlayLang)}
          </pre>
          {overlay.clarification_questions?.length ? (
            <ul className="list-inside list-disc text-sm text-dim">
              {overlay.clarification_questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-dim">{overlay.rationale}</p>
          <ProposedTickersPanel
            candidates={overlay.universe.proposed_tickers ?? []}
            onConfirm={confirmProposedTickers}
          />
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirmed || loading}
            className="pixel-btn w-full disabled:opacity-40"
          >
            {confirmed
              ? lang === "zh"
                ? "已確認並簽核"
                : lang === "ko"
                  ? "확인 및 서명 완료"
                  : "Confirmed & signed off"
              : lang === "zh"
                ? "確認 Overlay 並簽核"
                : lang === "ko"
                  ? "Overlay 확인 및 서명"
                  : "Confirm overlay & sign off"}
          </button>
        </div>
      )}
    </div>
  );
}

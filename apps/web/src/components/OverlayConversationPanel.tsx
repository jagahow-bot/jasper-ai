"use client";

import { useCallback, useState } from "react";
import { ChatLog, type ChatMessage } from "@/components/ChatLog";
import { useI18n } from "@/lib/i18n";
import {
  isOverlayInterpretErrorBody,
  overlayInterpretErrorI18nKey,
} from "@/lib/overlay-interpret-errors";
import {
  formatOverlayAssistantReply,
  formatOverlaySummary,
  signOffOverlay,
  type ClientOverlay,
  type OverlayConversationMessage,
} from "@/lib/overlay-schema";

type Props = {
  rmId?: string;
  clientRef?: string;
  baseScenarioId?: string;
  onConfirm?: (overlay: ClientOverlay) => void;
};

function toChatMessages(messages: OverlayConversationMessage[]): ChatMessage[] {
  return messages.map((m, i) => ({
    id: `msg-${i}`,
    role: m.role,
    content: m.content,
  }));
}

export function OverlayConversationPanel({
  rmId = "rm-demo",
  clientRef,
  baseScenarioId,
  onConfirm,
}: Props) {
  const { lang, t } = useI18n();
  const reportLanguage = lang === "zh" ? "zh-TW" : lang;

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<OverlayConversationMessage[]>([]);
  const [overlay, setOverlay] = useState<ClientOverlay | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const interpret = useCallback(
    async (nextMessages: OverlayConversationMessage[]) => {
      setLoading(true);
      setError(null);
      try {
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

        if (!res.ok || !interpretedOverlay) {
          const message = isOverlayInterpretErrorBody(data)
            ? t(overlayInterpretErrorI18nKey(data.code))
            : data &&
                typeof data === "object" &&
                "error" in data &&
                typeof (data as { error?: unknown }).error === "string"
              ? (data as { error: string }).error
              : t("overlay.interpret.error.generic");
          setError(message);
          setMessages((prev) => [...prev, { role: "assistant", content: message }]);
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

        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: formatOverlayAssistantReply(interpretedOverlay, lang) },
        ]);
      } catch {
        const message = t("overlay.interpret.error.generic");
        setError(message);
        setMessages((prev) => [...prev, { role: "assistant", content: message }]);
      } finally {
        setLoading(false);
      }
    },
    [overlay, rmId, clientRef, baseScenarioId, reportLanguage, lang, t],
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

  const phaseLabel =
    overlay?.audit.phase ??
    (lang === "zh" ? "探索" : "discovery");

  return (
    <div className="pixel-panel flex flex-col gap-4">
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
            ? "以自然語言描述客戶需求，AI 結構化為可回測 overlay；確認後方可執行。"
            : "Describe client needs in natural language; AI structures an overlay for backtest after RM sign-off."}
        </p>
      </div>

      <div className="h-56 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2">
        <ChatLog variant="conversation" messages={toChatMessages(messages)} />
      </div>

      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={
            lang === "zh"
              ? "例：客戶明年需要 80 萬美元流動性，目前持股偏科技…"
              : "e.g. Client needs $800k liquidity next year, overweight tech…"
          }
          className="pixel-input min-h-16 flex-1"
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

      {error && <p className="text-sm text-[var(--magenta)]">{error}</p>}

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
            {formatOverlaySummary(overlay, lang)}
          </pre>
          {overlay.clarification_questions?.length ? (
            <ul className="list-inside list-disc text-sm text-dim">
              {overlay.clarification_questions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-dim">{overlay.rationale}</p>
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

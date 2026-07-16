"use client";

import { useCallback, useEffect, useState } from "react";
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
  const [error, setError] = useState<string | null>(null);
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
        setOverlayLang(detectedLang);

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: formatOverlayAssistantReply(interpretedOverlay, detectedLang),
          },
        ]);
      } catch {
        const message = t("overlay.interpret.error.generic");
        setError(message);
        setMessages((prev) => [...prev, { role: "assistant", content: message }]);
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

      <div className="flex shrink-0 items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
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

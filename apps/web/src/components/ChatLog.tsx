"use client";

import { useEffect, useMemo, useRef } from "react";
import { useI18n } from "@/lib/i18n";

export type ChatMessage = {
  id: string;
  role: "assistant" | "user" | "system";
  content: string;
};

type ChatLogProps = {
  messages: ChatMessage[];
  /** Activity log: newest at top. Conversation: IM-style, newest at bottom. */
  variant?: "activity" | "conversation";
};

function getScrollParent(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return el;
}

/**
 * Activity log (`variant="activity"`): newest-first at top; auto-pins to top
 * unless the user scrolls down to read older lines.
 *
 * Conversation (`variant="conversation"`): chronological IM layout with speaker
 * labels; auto-scrolls to the latest message at the bottom.
 */
export function ChatLog({ messages, variant = "activity" }: ChatLogProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const ordered = useMemo(
    () => (variant === "activity" ? [...messages].reverse() : messages),
    [messages, variant],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !pinnedRef.current) return;
    if (variant === "conversation") {
      const scroller = getScrollParent(el);
      scroller.scrollTop = scroller.scrollHeight;
    } else {
      el.scrollTop = 0;
    }
  }, [ordered, variant]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    pinnedRef.current = el.scrollTop <= 24;
  };

  useEffect(() => {
    if (variant !== "conversation") return;
    const el = containerRef.current;
    if (!el) return;
    const scroller = getScrollParent(el);
    if (scroller === el) return;
    const onScroll = () => {
      pinnedRef.current =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 24;
    };
    scroller.addEventListener("scroll", onScroll);
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [variant]);

  if (variant === "conversation") {
    return (
      <div
        ref={containerRef}
        className="flex min-h-0 flex-col gap-3 px-1 py-1 text-sm"
      >
        {ordered.map((m) => {
          const isUser = m.role === "user";
          const isSystem = m.role === "system";
          const label = isUser
            ? t("chat.speakerYou")
            : isSystem
              ? t("chat.speakerSystem")
              : t("chat.speakerJasper");

          return (
            <div
              key={m.id}
              className={`flex flex-col gap-0.5 ${
                isUser ? "items-end" : "items-start"
              }`}
            >
              <span
                className={`px-1 text-[10px] font-semibold uppercase tracking-wide text-dim ${
                  isUser ? "text-right" : "text-left"
                }`}
              >
                {label}
              </span>
              <div
                className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2 leading-snug ${
                  isUser
                    ? "rounded-br-md bg-[var(--primary)]/15 text-[var(--foreground)]"
                    : isSystem
                      ? "rounded-bl-md border border-red-200 bg-red-50 text-red-700"
                      : "rounded-bl-md border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] shadow-sm"
                }`}
              >
                {m.content}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto pr-1 text-sm"
    >
      {ordered.map((m) => (
        <div
          key={m.id}
          className={`rounded-r-md border-l-2 px-3 py-2 leading-snug ${
            m.role === "assistant"
              ? "border-[var(--primary)] bg-[var(--primary-muted)]/50 text-[var(--foreground)]"
              : m.role === "user"
                ? "ml-3 border-[var(--cyan)] bg-indigo-50 text-[var(--foreground)]"
                : "border-red-300 bg-red-50 text-sm text-red-700"
          }`}
        >
          {m.content}
        </div>
      ))}
    </div>
  );
}

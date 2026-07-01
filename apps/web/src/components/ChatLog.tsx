"use client";

import { useEffect, useMemo, useRef } from "react";

export type ChatMessage = {
  id: string;
  role: "assistant" | "user" | "system";
  content: string;
};

/**
 * Activity log rendered newest-first (top). The container auto-pins to the top
 * as new messages arrive so the latest entry is always visible without
 * scrolling — unless the user has scrolled down to read older lines, in which
 * case we leave their position untouched.
 */
export function ChatLog({ messages }: { messages: ChatMessage[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  const ordered = useMemo(() => [...messages].reverse(), [messages]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !pinnedRef.current) return;
    el.scrollTop = 0;
  }, [ordered]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    // Consider the user "pinned" to the latest message while near the top.
    pinnedRef.current = el.scrollTop <= 24;
  };

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex h-full flex-col gap-2 overflow-y-auto pr-1 font-terminal text-lg"
    >
      {ordered.map((m) => (
        <div
          key={m.id}
          className={`border-l-2 px-2 py-1 leading-snug ${
            m.role === "assistant"
              ? "border-[var(--neon)] bg-[rgba(57,255,20,0.06)] text-[var(--foreground)]"
              : m.role === "user"
                ? "ml-4 border-[var(--cyan)] bg-[rgba(0,245,255,0.06)] text-[var(--cyan)]"
                : "border-[var(--magenta)] text-xs text-[var(--magenta)]"
          }`}
        >
          {m.role === "user" && <span className="text-[var(--text-dim)]">{"> "}</span>}
          {m.role === "assistant" && (
            <span className="text-[var(--neon-dim)]">$ </span>
          )}
          {m.content}
        </div>
      ))}
    </div>
  );
}

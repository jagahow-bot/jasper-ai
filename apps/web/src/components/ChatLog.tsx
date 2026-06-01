"use client";

export type ChatMessage = {
  id: string;
  role: "assistant" | "user" | "system";
  content: string;
};

export function ChatLog({ messages }: { messages: ChatMessage[] }) {
  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto pr-1 font-terminal text-lg">
      {messages.map((m) => (
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

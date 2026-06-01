"use client";

import { useState } from "react";
import type { ScenarioCard } from "@/lib/types";

type Props = {
  onScenario: (scenario: ScenarioCard) => void;
};

export function CustomScenarioInput({ onScenario }: Props) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/scenario/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text.trim() }),
      });
      const data = (await res.json()) as {
        scenario?: ScenarioCard;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Analysis failed");
      }
      if (!data.scenario) {
        throw new Error("Analysis failed");
      }
      onScenario(data.scenario);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed — try again");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pixel-panel space-y-4">
      <div>
        <h3 className="font-pixel text-xs text-neon">Custom macro view</h3>
        <p className="mt-2 text-sm text-dim">
          Describe macro, sector, or risk views — AI maps to a backtestable scenario.
        </p>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Sticky US inflation, Fed stays higher for longer, growth multiples under pressure — tilt short duration bonds and defensives…"
        className="pixel-input min-h-28"
      />
      {error && (
        <p className="text-sm text-[var(--magenta)]">{error}</p>
      )}
      <button
        type="button"
        onClick={() => void analyze()}
        disabled={loading || !text.trim()}
        className="pixel-btn w-full disabled:opacity-40"
      >
        {loading ? "Analyzing…" : "Analyze → scenario"}
      </button>
    </div>
  );
}

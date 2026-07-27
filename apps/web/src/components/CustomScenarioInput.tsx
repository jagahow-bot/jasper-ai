"use client";

import { useState } from "react";
import { pushLlmAuditLog, type LlmAuditEntry } from "@/lib/llm-audit";
import { useI18n } from "@/lib/i18n";
import type { ScenarioCard } from "@/lib/types";

type Props = {
  onScenario: (scenario: ScenarioCard) => void;
};

export function CustomScenarioInput({ onScenario }: Props) {
  const { t } = useI18n();
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
        llm_log?: LlmAuditEntry;
      };
      pushLlmAuditLog(data.llm_log);
      if (!res.ok) {
        throw new Error(data.error ?? t("customScenario.analysisFailed"));
      }
      if (!data.scenario) {
        throw new Error(t("customScenario.analysisFailed"));
      }
      onScenario(data.scenario);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("customScenario.analysisFailedRetry"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pixel-panel space-y-4">
      <div>
        <h3 className="ui-panel-title">{t("customScenario.title")}</h3>
        <p className="mt-2 text-sm text-dim">
          {t("customScenario.description")}
        </p>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("customScenario.placeholder")}
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
        {loading ? t("customScenario.analyzing") : t("customScenario.analyzeButton")}
      </button>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import {
  buildTalkingPoints,
  type HoldingDiffRow,
  type MetricCompareRow,
  type TalkingPointsInput,
} from "@/lib/rm-report-utils";
import type { Lang, TFn } from "@/lib/i18n";
import type { BacktestResult } from "@/lib/types";
import type { ClientOverlay } from "@/lib/overlay-schema";

type AiTalkingSummary = {
  summary: string[];
  performanceFlag: string | null;
  rerunRecommended: boolean;
  rerunReason: string | null;
  source: "kimi" | "template";
  loading: boolean;
  error: string | null;
};

const initial: AiTalkingSummary = {
  summary: [],
  performanceFlag: null,
  rerunRecommended: false,
  rerunReason: null,
  source: "template",
  loading: true,
  error: null,
};

export type UseAiTalkingSummaryInput = {
  metrics: MetricCompareRow[];
  holdingsDiff: HoldingDiffRow[];
  overlay: ClientOverlay | null;
  adjustedResult: BacktestResult;
  anchorLabel: string;
  objectiveKey: string;
  lang: Lang;
  t: TFn;
  customizedModelCode?: string | null;
  benchmark?: string;
};

export function useAiTalkingSummary(
  input: UseAiTalkingSummaryInput,
): AiTalkingSummary {
  const [state, setState] = useState<AiTalkingSummary>(initial);

  useEffect(() => {
    let cancelled = false;

    async function fetchSummary() {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const res = await fetch("/api/talking-summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lang: input.lang,
            metrics: input.metrics,
            holdingsDiff: input.holdingsDiff,
            overlay: input.overlay,
            adjustedResult: input.adjustedResult,
            anchorLabel: input.anchorLabel,
            objectiveKey: input.objectiveKey,
            customizedModelCode: input.customizedModelCode,
            benchmark: input.benchmark,
          }),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = (await res.json()) as {
          summary?: string[];
          performance_flag?: string | null;
          rerun_recommended?: boolean;
          rerun_reason?: string | null;
          source?: "kimi" | "template";
          error?: string;
        };
        if (data.error) {
          throw new Error(data.error);
        }
        if (cancelled) return;
        setState({
          summary: data.summary || [],
          performanceFlag: data.performance_flag ?? null,
          rerunRecommended: data.rerun_recommended ?? false,
          rerunReason: data.rerun_reason ?? null,
          source: data.source || "template",
          loading: false,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        const fallback = buildTalkingPoints({
          metrics: input.metrics,
          holdingsDiff: input.holdingsDiff,
          overlay: input.overlay,
          adjustedResult: input.adjustedResult,
          anchorLabel: input.anchorLabel,
          objectiveKey: input.objectiveKey,
          lang: input.lang,
          t: input.t,
          customizedModelCode: input.customizedModelCode,
        } as TalkingPointsInput);
        setState({
          summary: fallback,
          performanceFlag: null,
          rerunRecommended: false,
          rerunReason: null,
          source: "template",
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    fetchSummary();

    return () => {
      cancelled = true;
    };
  }, [
    input.lang,
    input.metrics,
    input.holdingsDiff,
    input.overlay,
    input.adjustedResult,
    input.anchorLabel,
    input.objectiveKey,
    input.customizedModelCode,
    input.benchmark,
    input.t,
  ]);

  return state;
}

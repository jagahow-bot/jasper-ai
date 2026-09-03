/**
 * Central LLM task routing (design §4.6 / §4.7).
 *
 * codegen_draft / codegen_repair MUST NOT silently fall back to Flash when
 * Kimi is unavailable — callers should mark tickets blocked_model_unavailable.
 */

import type { LanguageModel } from "ai";
import {
  createAiModel,
  DEFAULT_FLASH_MODEL_ID,
  isProviderConfigured,
  KIMI_K3_MODEL_ID,
  providerOptionsFor,
  type AiProviderOptions,
} from "./ai-provider";

export type LlmTask =
  | "interpret"
  | "chat_extract"
  | "universe_filter"
  | "scenario_analyze"
  | "param_seeds"
  | "goals_extract"
  | "narrate"
  | "talking_summary"
  | "gap_reasoning"
  | "codegen_draft"
  | "codegen_repair"
  | "semantic_review";

export type LlmTaskRoute = {
  modelId: string;
  jsonMode?: boolean;
  /** When true, never fall back to another model family. */
  noSilentFallback?: boolean;
};

const FLASH = DEFAULT_FLASH_MODEL_ID;
const KIMI = KIMI_K3_MODEL_ID;

export const LLM_TASK_ROUTING: Record<LlmTask, LlmTaskRoute> = {
  interpret: { modelId: FLASH, jsonMode: true },
  chat_extract: { modelId: FLASH, jsonMode: true },
  universe_filter: { modelId: FLASH, jsonMode: true },
  scenario_analyze: { modelId: FLASH },
  param_seeds: { modelId: FLASH, jsonMode: true },
  goals_extract: { modelId: FLASH, jsonMode: true },
  narrate: { modelId: KIMI },
  talking_summary: { modelId: KIMI },
  gap_reasoning: { modelId: KIMI },
  codegen_draft: { modelId: KIMI, noSilentFallback: true },
  codegen_repair: { modelId: KIMI, noSilentFallback: true },
  semantic_review: { modelId: FLASH, jsonMode: true },
};

function envOverrideKey(task: LlmTask): string {
  return `LLM_MODEL_${task.toUpperCase()}`;
}

export function resolveModelIdForTask(task: LlmTask): string {
  const override = process.env[envOverrideKey(task)]?.trim();
  if (override) return override;
  return LLM_TASK_ROUTING[task].modelId;
}

export class ModelUnavailableError extends Error {
  readonly task: LlmTask;
  readonly modelId: string;
  readonly code = "blocked_model_unavailable" as const;

  constructor(task: LlmTask, modelId: string) {
    super(`Model ${modelId} unavailable for task ${task}`);
    this.name = "ModelUnavailableError";
    this.task = task;
    this.modelId = modelId;
  }
}

export function modelForTask(task: LlmTask): LanguageModel {
  const route = LLM_TASK_ROUTING[task];
  const modelId = resolveModelIdForTask(task);
  if (!isProviderConfigured(modelId)) {
    if (route.noSilentFallback) {
      throw new ModelUnavailableError(task, modelId);
    }
    // Soft tasks may still throw; callers that want template fallback catch this.
    throw new ModelUnavailableError(task, modelId);
  }
  return createAiModel(modelId);
}

export function providerOptionsForTask(task: LlmTask): AiProviderOptions {
  const route = LLM_TASK_ROUTING[task];
  const modelId = resolveModelIdForTask(task);
  return providerOptionsFor(modelId, { jsonMode: Boolean(route.jsonMode) });
}

export function isCodegenTask(task: LlmTask): boolean {
  return task === "codegen_draft" || task === "codegen_repair";
}

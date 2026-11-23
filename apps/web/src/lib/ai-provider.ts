import { google } from "@ai-sdk/google";
import { moonshotai } from "@ai-sdk/moonshotai";
import type { LanguageModel } from "ai";
import {
  GEMINI_MAX_OUTPUT_TOKENS,
  GEMINI_NARRATIVE_MAX_OUTPUT_TOKENS,
} from "./gemini";

/**
 * Web LLM routing (model IDs + which helper each route should use):
 *
 * Gemini Flash (`defaultFlashModel` / DEFAULT_FLASH_MODEL_ID):
 *   Interactive / latency-sensitive — overlay/interpret, universe/filter,
 *   goals extract, overlay starters, semantic review.
 *
 * Gemini 4 Hydrogen (`reasoningModel` / DEFAULT_REASONING_MODEL_ID):
 *   Quality-first everyday intelligence — narrate, talking-summary,
 *   client briefing/ask, scenario analyze, param_seeds (web).
 *   Backend Pro refinement / AI param seeds use settings.ai_reasoning_model.
 *
 * Gemini 4 Neon (`DEFAULT_CODEGEN_MODEL_ID`):
 *   Frontier reasoning with throughput — gap_reasoning, codegen_draft/repair.
 *
 * Exact IDs: GEMINI_MODEL (Flash), GEMINI_REASONING_MODEL / AI_REASONING_MODEL
 * (Hydrogen), CODEGEN_MODEL / GEMINI_CODEGEN_MODEL (Neon).
 * Keep Neon/Hydrogen off the most latency-critical overlay confirm paths.
 */
export const DEFAULT_FLASH_MODEL_ID =
  process.env.GEMINI_MODEL?.trim() || "gemini-3.8-flash";

export const DEFAULT_REASONING_MODEL_ID =
  process.env.GEMINI_REASONING_MODEL?.trim() ||
  process.env.AI_REASONING_MODEL?.trim() ||
  process.env.MOONSHOT_MODEL?.trim() ||
  "gemini-4-hydrogen";

export const DEFAULT_CODEGEN_MODEL_ID =
  process.env.CODEGEN_MODEL?.trim() ||
  process.env.GEMINI_CODEGEN_MODEL?.trim() ||
  "gemini-4-neon";

/** @deprecated Prefer DEFAULT_REASONING_MODEL_ID — kept for existing imports. */
export const KIMI_K3_MODEL_ID = DEFAULT_REASONING_MODEL_ID;

export const KIMI_K3_REASONING_EFFORT =
  (
    process.env.MOONSHOT_REASONING_EFFORT?.trim() as
      | "low"
      | "high"
      | "max"
      | undefined
  ) || "max";

export const FLASH_MAX_OUTPUT_TOKENS = GEMINI_MAX_OUTPUT_TOKENS;
export const REASONING_MAX_OUTPUT_TOKENS = GEMINI_NARRATIVE_MAX_OUTPUT_TOKENS;

export type AiProvider = "google" | "moonshotai";

export function resolveProvider(modelId: string): AiProvider {
  const m = modelId.toLowerCase();
  if (m.startsWith("kimi") || m.includes("moonshot")) return "moonshotai";
  return "google";
}

export function createAiModel(modelId: string): LanguageModel {
  const provider = resolveProvider(modelId);
  if (provider === "moonshotai") {
    return moonshotai(modelId);
  }
  return google(modelId);
}

export function defaultFlashModel(): LanguageModel {
  return createAiModel(DEFAULT_FLASH_MODEL_ID);
}

export function reasoningModel(): LanguageModel {
  return createAiModel(KIMI_K3_MODEL_ID);
}

export function isProviderConfigured(modelId: string): boolean {
  const provider = resolveProvider(modelId);
  if (provider === "moonshotai") {
    return Boolean(process.env.MOONSHOT_API_KEY);
  }
  return Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY,
  );
}

export type GeminiThinkingLevel =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

export type AiProviderOptions = {
  google?: {
    thinkingConfig?: { thinkingLevel: GeminiThinkingLevel };
    responseMimeType?: "application/json";
  };
  moonshotai?: {
    reasoningEffort?: "low" | "high" | "max";
  };
};

/**
 * Gemini thinkingConfig for web Flash routes (overlay, goals, …).
 *
 * Do not send `thinkingLevel: "minimal"`: Gemini 3.7 Flash and 3.x Pro reject it
 * with 400 ("Thinking level MINIMAL is not supported for this model"). Omit the
 * config so the model uses its default rather than inventing a substitute level.
 */
export function thinkingConfigForGoogleModel(
  modelId: string,
): { thinkingLevel: GeminiThinkingLevel } | undefined {
  if (resolveProvider(modelId) !== "google") return undefined;
  // Gemini Flash/Pro reject thinkingLevel MINIMAL; omit config rather than substitute.
  return undefined;
}

export function providerOptionsFor(
  modelId: string,
  {
    jsonMode = false,
    reasoningEffort,
  }: {
    jsonMode?: boolean;
    /** Override Moonshot reasoning effort (talking-summary uses "low"). */
    reasoningEffort?: "low" | "high" | "max";
  } = {},
): AiProviderOptions {
  const provider = resolveProvider(modelId);
  if (provider === "moonshotai") {
    return {
      moonshotai: {
        reasoningEffort: reasoningEffort ?? KIMI_K3_REASONING_EFFORT,
      },
    };
  }
  const googleOptions: NonNullable<AiProviderOptions["google"]> = {};
  const thinkingConfig = thinkingConfigForGoogleModel(modelId);
  if (thinkingConfig) {
    googleOptions.thinkingConfig = thinkingConfig;
  }
  if (jsonMode) {
    googleOptions.responseMimeType = "application/json";
  }
  return { google: googleOptions };
}

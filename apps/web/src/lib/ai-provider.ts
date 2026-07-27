import { google } from "@ai-sdk/google";
import { moonshotai } from "@ai-sdk/moonshotai";
import type { LanguageModel } from "ai";
import {
  GEMINI_MAX_OUTPUT_TOKENS,
  GEMINI_NARRATIVE_MAX_OUTPUT_TOKENS,
} from "./gemini";

export const DEFAULT_FLASH_MODEL_ID =
  process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";

export const KIMI_K3_MODEL_ID =
  process.env.MOONSHOT_MODEL?.trim() || "kimi-k3";

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
    return moonshotai(modelId) as unknown as LanguageModel;
  }
  return google(modelId) as unknown as LanguageModel;
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

export type AiProviderOptions = {
  google?: {
    thinkingConfig?: { thinkingLevel: "minimal" | "low" | "medium" | "high" };
    responseMimeType?: "application/json";
  };
  moonshotai?: {
    reasoningEffort?: "low" | "high" | "max";
  };
};

export function providerOptionsFor(
  modelId: string,
  { jsonMode = false }: { jsonMode?: boolean } = {},
): AiProviderOptions {
  const provider = resolveProvider(modelId);
  if (provider === "moonshotai") {
    return { moonshotai: { reasoningEffort: KIMI_K3_REASONING_EFFORT } };
  }
  const googleOptions: NonNullable<AiProviderOptions["google"]> = {
    thinkingConfig: { thinkingLevel: "minimal" },
  };
  if (jsonMode) {
    googleOptions.responseMimeType = "application/json";
  }
  return { google: googleOptions };
}

import { describe, expect, it } from "vitest";
import {
  LLM_TASK_ROUTING,
  isCodegenTask,
  resolveModelIdForTask,
} from "./llm-task-routing";
import { DEFAULT_FLASH_MODEL_ID, KIMI_K3_MODEL_ID } from "./ai-provider";

describe("llm-task-routing", () => {
  it("routes interpret to Flash and codegen to Kimi with noSilentFallback", () => {
    expect(LLM_TASK_ROUTING.interpret.modelId).toBe(DEFAULT_FLASH_MODEL_ID);
    expect(LLM_TASK_ROUTING.codegen_draft.modelId).toBe(KIMI_K3_MODEL_ID);
    expect(LLM_TASK_ROUTING.codegen_draft.noSilentFallback).toBe(true);
    expect(LLM_TASK_ROUTING.codegen_repair.noSilentFallback).toBe(true);
    expect(LLM_TASK_ROUTING.semantic_review.modelId).toBe(DEFAULT_FLASH_MODEL_ID);
    expect(LLM_TASK_ROUTING.gap_reasoning.modelId).toBe(KIMI_K3_MODEL_ID);
  });

  it("marks codegen tasks", () => {
    expect(isCodegenTask("codegen_draft")).toBe(true);
    expect(isCodegenTask("interpret")).toBe(false);
  });

  it("resolves model ids", () => {
    expect(resolveModelIdForTask("narrate")).toBe(KIMI_K3_MODEL_ID);
    expect(resolveModelIdForTask("universe_filter")).toBe(DEFAULT_FLASH_MODEL_ID);
  });
});

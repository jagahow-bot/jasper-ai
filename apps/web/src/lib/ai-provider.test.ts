import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLASH_MODEL_ID,
  DEFAULT_REASONING_MODEL_ID,
  providerOptionsFor,
  resolveProvider,
  thinkingConfigForGoogleModel,
} from "./ai-provider";

describe("thinkingConfigForGoogleModel", () => {
  it("omits thinkingConfig instead of sending MINIMAL", () => {
    expect(thinkingConfigForGoogleModel(DEFAULT_FLASH_MODEL_ID)).toBeUndefined();
    expect(thinkingConfigForGoogleModel("gemini-3.7-flash")).toBeUndefined();
    expect(thinkingConfigForGoogleModel("gemini-3.8-flash")).toBeUndefined();
    expect(thinkingConfigForGoogleModel("gemini-4-hydrogen")).toBeUndefined();
    expect(thinkingConfigForGoogleModel("gemini-4-neon")).toBeUndefined();
  });
});

describe("providerOptionsFor", () => {
  it("does not send thinkingLevel MINIMAL for Gemini Flash", () => {
    const options = providerOptionsFor(DEFAULT_FLASH_MODEL_ID, { jsonMode: true });
    expect(options.google?.thinkingConfig).toBeUndefined();
    expect(options.google?.responseMimeType).toBe("application/json");
  });

  it("routes default reasoning model (Hydrogen) through Google", () => {
    expect(DEFAULT_REASONING_MODEL_ID).toContain("hydrogen");
    expect(resolveProvider(DEFAULT_REASONING_MODEL_ID)).toBe("google");
    const options = providerOptionsFor(DEFAULT_REASONING_MODEL_ID, { jsonMode: true });
    expect(options.moonshotai).toBeUndefined();
    expect(options.google?.responseMimeType).toBe("application/json");
  });

  it("keeps Moonshot reasoning options when model id is Kimi", () => {
    const options = providerOptionsFor("kimi-k3");
    expect(options.google).toBeUndefined();
    expect(options.moonshotai?.reasoningEffort).toBeDefined();
  });

  it("allows overriding Moonshot reasoningEffort for short routes", () => {
    const options = providerOptionsFor("kimi-k3", {
      jsonMode: true,
      reasoningEffort: "low",
    });
    expect(options.moonshotai?.reasoningEffort).toBe("low");
  });
});

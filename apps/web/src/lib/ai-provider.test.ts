import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLASH_MODEL_ID,
  KIMI_K3_MODEL_ID,
  providerOptionsFor,
  thinkingConfigForGoogleModel,
} from "./ai-provider";

describe("thinkingConfigForGoogleModel", () => {
  it("omits thinkingConfig instead of sending MINIMAL", () => {
    expect(thinkingConfigForGoogleModel(DEFAULT_FLASH_MODEL_ID)).toBeUndefined();
    expect(thinkingConfigForGoogleModel("gemini-3.7-flash")).toBeUndefined();
    expect(thinkingConfigForGoogleModel("gemini-3.8-flash")).toBeUndefined();
    expect(thinkingConfigForGoogleModel("gemini-3.1-pro-preview")).toBeUndefined();
  });
});

describe("providerOptionsFor", () => {
  it("does not send thinkingLevel MINIMAL for Gemini Flash", () => {
    const options = providerOptionsFor(DEFAULT_FLASH_MODEL_ID, { jsonMode: true });
    expect(options.google?.thinkingConfig).toBeUndefined();
    expect(options.google?.responseMimeType).toBe("application/json");
  });

  it("keeps Moonshot reasoning options unchanged", () => {
    const options = providerOptionsFor(KIMI_K3_MODEL_ID);
    expect(options.google).toBeUndefined();
    expect(options.moonshotai?.reasoningEffort).toBeDefined();
  });
});

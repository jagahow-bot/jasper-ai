import { generateObject, generateText } from "ai";
import type { LanguageModel } from "ai";
import { resolveProvider } from "./ai-provider";

export type LlmAuditEntry = {
  timestamp: string;
  provider: "google" | "moonshotai";
  model_id: string;
  call_type: "text" | "object";
  prompt: string;
  system?: string;
  messages?: Array<{ role: string; content: string }>;
  temperature?: number;
  maxOutputTokens?: number;
  response_mime_type?: string;
  raw_response: string;
  finish_reason: string;
  raw_finish_reason?: string;
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  duration_ms: number;
  error?: string;
};

function modelIdFromModel(model: LanguageModel): string {
  const anyModel = model as unknown as Record<string, unknown>;
  const id =
    anyModel.modelId ??
    anyModel.id ??
    anyModel.specificationVersion ??
    "unknown";
  return String(id);
}

function extractUserPrompt(args: {
  prompt?: string;
  messages?: Array<{ role: string; content: string }>;
}): string {
  if (args.prompt) return args.prompt;
  if (args.messages) {
    return args.messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n---\n");
  }
  return "";
}

function extractSystem(args: {
  system?: string;
  messages?: Array<{ role: string; content: string }>;
}): string | undefined {
  if (args.system) return args.system;
  if (args.messages) {
    const systemMessages = args.messages.filter((m) => m.role === "system");
    if (systemMessages.length > 0) {
      return systemMessages.map((m) => m.content).join("\n---\n");
    }
  }
  return undefined;
}

function buildEntry(
  model: LanguageModel,
  callType: "text" | "object",
  args: Record<string, unknown>,
  result: Record<string, unknown>,
  durationMs: number,
): LlmAuditEntry {
  const modelId = modelIdFromModel(model);
  const provider = resolveProvider(modelId);
  const usage = (result.usage as Record<string, number> | undefined) || {};
  const finishReason = String(result.finishReason ?? "unknown");
  const rawResponse =
    callType === "text"
      ? String(result.text ?? "")
      : JSON.stringify(result.object ?? null);

  return {
    timestamp: new Date().toISOString(),
    provider,
    model_id: modelId,
    call_type: callType,
    prompt: extractUserPrompt(args as { prompt?: string; messages?: Array<{ role: string; content: string }> }),
    system: extractSystem(args as { system?: string; messages?: Array<{ role: string; content: string }> }),
    messages: Array.isArray(args.messages) ? (args.messages as Array<{ role: string; content: string }>) : undefined,
    temperature: typeof args.temperature === "number" ? args.temperature : undefined,
    maxOutputTokens: typeof args.maxOutputTokens === "number" ? args.maxOutputTokens : undefined,
    response_mime_type:
      typeof args.responseMimeType === "string"
        ? args.responseMimeType
        : undefined,
    raw_response: rawResponse,
    finish_reason: finishReason,
    raw_finish_reason: result.rawFinishReason
      ? String(result.rawFinishReason)
      : undefined,
    usage: {
      prompt_tokens: usage.promptTokens ?? usage.prompt_tokens,
      completion_tokens:
        usage.completionTokens ?? usage.completion_tokens,
      total_tokens: usage.totalTokens ?? usage.total_tokens,
    },
    duration_ms: Math.round(durationMs),
  };
}

export async function generateTextWithAudit(
  options: Record<string, unknown> & { model: LanguageModel },
): Promise<{ result: { text: string; [key: string]: unknown }; log: LlmAuditEntry }> {
  const model = options.model as LanguageModel;
  const start = performance.now();
  try {
    const result = (await generateText(options as Parameters<typeof generateText>[0])) as unknown as {
      text: string;
      [key: string]: unknown;
    };
    const durationMs = performance.now() - start;
    const log = buildEntry(
      model,
      "text",
      options as Record<string, unknown>,
      result as Record<string, unknown>,
      durationMs,
    );
    return { result, log };
  } catch (error) {
    const durationMs = performance.now() - start;
    const log = buildEntry(
      model,
      "text",
      options as Record<string, unknown>,
      { finishReason: "error" },
      durationMs,
    );
    log.error = error instanceof Error ? error.message : String(error);
    throw { error, log };
  }
}

export async function generateObjectWithAudit(
  options: Record<string, unknown> & { model: LanguageModel },
): Promise<{ result: { object: unknown; [key: string]: unknown }; log: LlmAuditEntry }> {
  const model = options.model as LanguageModel;
  const start = performance.now();
  try {
    const result = (await generateObject(options as Parameters<typeof generateObject>[0])) as unknown as {
      object: unknown;
      [key: string]: unknown;
    };
    const durationMs = performance.now() - start;
    const log = buildEntry(
      model,
      "object",
      options as Record<string, unknown>,
      result as Record<string, unknown>,
      durationMs,
    );
    return { result, log };
  } catch (error) {
    const durationMs = performance.now() - start;
    const log = buildEntry(
      model,
      "object",
      options as Record<string, unknown>,
      { finishReason: "error" },
      durationMs,
    );
    log.error = error instanceof Error ? error.message : String(error);
    throw { error, log };
  }
}

export async function uploadLlmLogs(
  jobId: string,
  entries: LlmAuditEntry[],
): Promise<{ ok: boolean; merged: number }> {
  if (!entries.length) return { ok: true, merged: 0 };
  try {
    const res = await fetch(
      `/quant-api/jobs/${encodeURIComponent(jobId)}/llm-logs`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      },
    );
    if (!res.ok) {
      return { ok: false, merged: 0 };
    }
    const data = (await res.json()) as { ok: boolean; merged: number };
    return { ok: data.ok, merged: data.merged };
  } catch {
    return { ok: false, merged: 0 };
  }
}

let pendingLogs: LlmAuditEntry[] = [];

export function pushLlmAuditLog(entry: LlmAuditEntry | LlmAuditEntry[] | undefined) {
  if (!entry) return;
  if (Array.isArray(entry)) {
    pendingLogs.push(...entry);
  } else {
    pendingLogs.push(entry);
  }
}

export function getPendingLlmAuditLogs(): LlmAuditEntry[] {
  return [...pendingLogs];
}

export function clearPendingLlmAuditLogs(): void {
  pendingLogs = [];
}

export async function flushLlmAuditLogs(jobId: string): Promise<{ ok: boolean; merged: number }> {
  const logs = pendingLogs;
  pendingLogs = [];
  return uploadLlmLogs(jobId, logs);
}

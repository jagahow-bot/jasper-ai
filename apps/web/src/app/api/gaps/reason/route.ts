import { NextResponse } from "next/server";
import {
  ModelUnavailableError,
  modelForTask,
  providerOptionsForTask,
  resolveModelIdForTask,
} from "@/lib/llm-task-routing";
import { buildBehaviorSpecCard } from "@/lib/behavior-spec-card";
import { generateTextWithAudit } from "@/lib/llm-audit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    stage?: string;
    missing_capability?: string;
    summary?: string;
    requested?: Record<string, unknown>;
    nearest_supported?: Record<string, unknown>;
    gap_ticket_id?: string;
  };
  const stage = body.stage || "allocator";
  const missing = body.missing_capability || "unspecified_capability";
  const summary = body.summary || missing;

  const templateCard = buildBehaviorSpecCard({
    stage,
    missing_capability: missing,
    summary,
    gap_ticket_id: body.gap_ticket_id,
    requested: body.requested,
    nearest_supported: body.nearest_supported,
  });

  try {
    const modelId = resolveModelIdForTask("gap_reasoning");
    const { result } = await generateTextWithAudit({
      model: modelForTask("gap_reasoning"),
      maxOutputTokens: 4096,
      prompt: `Draft a concise Behavior Spec Card JSON for capability gap "${missing}" on stage "${stage}". Summary: ${summary}. Return JSON only.`,
      providerOptions: providerOptionsForTask("gap_reasoning"),
    });
    return NextResponse.json({
      draft_source: "kimi",
      modelId,
      raw: result.text,
      behavior_spec_card: templateCard,
    });
  } catch (err) {
    const inner = err && typeof err === "object" && "error" in err ? (err as { error: unknown }).error : err;
    if (inner instanceof ModelUnavailableError || err instanceof ModelUnavailableError) {
      return NextResponse.json({
        draft_source: "template",
        behavior_spec_card: templateCard,
        warning: "blocked_model_unavailable",
      });
    }
    return NextResponse.json({
      draft_source: "template",
      behavior_spec_card: templateCard,
      warning: "gap_reasoning_failed",
    });
  }
}

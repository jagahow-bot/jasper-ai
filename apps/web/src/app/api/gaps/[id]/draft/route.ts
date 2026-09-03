import { NextResponse } from "next/server";
import {
  ModelUnavailableError,
  modelForTask,
  providerOptionsForTask,
  resolveModelIdForTask,
} from "@/lib/llm-task-routing";
import {
  buildBehaviorSpecCard,
  buildLocalCodegenDraft,
} from "@/lib/behavior-spec-card";
import { generateTextWithAudit } from "@/lib/llm-audit";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    stage?: string;
    implementation_id?: string;
    missing_capability?: string;
    summary?: string;
    requested?: Record<string, unknown>;
  };
  const stage = body.stage || "allocator";
  const impl =
    body.implementation_id ||
    `${(body.missing_capability || "capability").replace(/[^a-z0-9_]+/gi, "_").toLowerCase()}_v1`;
  const missing = body.missing_capability || impl;
  const summary = body.summary || missing;
  const card = buildBehaviorSpecCard({
    stage,
    missing_capability: missing,
    summary,
    gap_ticket_id: id,
    requested: body.requested,
  });

  try {
    const modelId = resolveModelIdForTask("codegen_draft");
    const { result } = await generateTextWithAudit({
      model: modelForTask("codegen_draft"),
      maxOutputTokens: 8192,
      prompt: `Draft stage contrib files for ${stage}/${impl}. Capability: ${missing}. Return a short plan; files are scaffolded locally.`,
      providerOptions: providerOptionsForTask("codegen_draft"),
    });
    const draft = buildLocalCodegenDraft({
      stage,
      implementation_id: impl,
      missing_capability: missing,
      summary,
      behavior_spec_card: card,
    });
    return NextResponse.json({
      ticket_id: id,
      status: "drafted",
      draft_source: "kimi",
      modelId,
      model_plan: result.text,
      ...draft,
    });
  } catch (err) {
    const inner =
      err && typeof err === "object" && "error" in err
        ? (err as { error: unknown }).error
        : err;
    const blocked =
      inner instanceof ModelUnavailableError || err instanceof ModelUnavailableError;
    return NextResponse.json(
      {
        ticket_id: id,
        status: "blocked_model_unavailable",
        code: "blocked_model_unavailable",
        modelId: resolveModelIdForTask("codegen_draft"),
        error: blocked
          ? "kimi_unavailable"
          : inner instanceof Error
            ? inner.message
            : "codegen_failed",
      },
      { status: 503 },
    );
  }
}

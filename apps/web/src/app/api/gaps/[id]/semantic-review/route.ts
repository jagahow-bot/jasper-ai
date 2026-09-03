import { NextResponse } from "next/server";
import {
  ModelUnavailableError,
  modelForTask,
  providerOptionsForTask,
  resolveModelIdForTask,
} from "@/lib/ai-provider";
import { generateTextWithAudit } from "@/lib/llm-audit";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export type SemanticReviewResult = {
  intention_alignment: "aligned" | "partial" | "mismatched";
  reasons: string[];
  requires_engineer_signoff: boolean;
  engineer_checklist?: {
    ast_allowlist: boolean;
    no_runtime_io: boolean;
    bounds_branches: boolean;
    attainment_safe: boolean;
    i18n_complete: boolean;
    perf_attached: boolean;
    review_items_addressed: boolean;
  };
};

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    missing_capability?: string;
    requested?: Record<string, unknown>;
    draft_excerpt?: string;
    spec_card?: Record<string, unknown>;
  };

  try {
    const { result } = await generateTextWithAudit({
      model: modelForTask("semantic_review"),
      maxOutputTokens: 2048,
      prompt: `Compare gap intent "${body.missing_capability ?? id}" to the draft. Return JSON: {"intention_alignment":"aligned|partial|mismatched","reasons":[...]}`,
      providerOptions: providerOptionsForTask("semantic_review"),
    });
    let alignment: SemanticReviewResult["intention_alignment"] = "partial";
    let reasons: string[] = [];
    try {
      const parsed = JSON.parse(result.text) as {
        intention_alignment?: SemanticReviewResult["intention_alignment"];
        reasons?: string[];
      };
      if (
        parsed.intention_alignment === "aligned" ||
        parsed.intention_alignment === "partial" ||
        parsed.intention_alignment === "mismatched"
      ) {
        alignment = parsed.intention_alignment;
      }
      if (Array.isArray(parsed.reasons)) reasons = parsed.reasons.map(String);
    } catch {
      reasons = ["Could not parse model JSON; treat as partial."];
      alignment = "partial";
    }
    const requires = alignment !== "aligned";
    const out: SemanticReviewResult = {
      intention_alignment: alignment,
      reasons,
      requires_engineer_signoff: requires,
      engineer_checklist: requires
        ? {
            ast_allowlist: false,
            no_runtime_io: false,
            bounds_branches: false,
            attainment_safe: false,
            i18n_complete: false,
            perf_attached: false,
            review_items_addressed: false,
          }
        : undefined,
    };
    return NextResponse.json({
      ticket_id: id,
      modelId: resolveModelIdForTask("semantic_review"),
      ...out,
      raw: result.text,
    });
  } catch (err) {
    const inner =
      err && typeof err === "object" && "error" in err
        ? (err as { error: unknown }).error
        : err;
    if (inner instanceof ModelUnavailableError || err instanceof ModelUnavailableError) {
      return NextResponse.json(
        {
          ticket_id: id,
          status: "queued_waiting_gemini",
          code: "semantic_review_queued",
          message:
            "Gemini unavailable — queued for cross-family review (will not use Kimi self-review).",
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        ticket_id: id,
        error: inner instanceof Error ? inner.message : "review_failed",
      },
      { status: 500 },
    );
  }
}

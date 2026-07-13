import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { NextResponse } from "next/server";
import { GEMINI_MAX_OUTPUT_TOKENS, GEMINI_MODEL } from "@/lib/gemini";
import { parseOverlayExtractFromGemini } from "@/lib/overlay-gemini-parse";
import { interpretOverlayFallback } from "@/lib/overlay-fallback";
import {
  createSessionId,
  validateOverlayExtract,
  wrapExtractAsOverlay,
  type ClientOverlay,
  type OverlayConversationMessage,
} from "@/lib/overlay-schema";
import {
  parseReportLanguage,
  rationaleLanguageDirective,
  type Lang,
} from "@/lib/universe-filter-locale";

type InterpretBody = {
  messages?: OverlayConversationMessage[];
  /** Latest user utterance (shortcut when messages omitted). */
  text?: string;
  session_id?: string;
  prior_overlay?: ClientOverlay | null;
  rm_id?: string;
  client_ref?: string;
  base_scenario_id?: string;
  report_language?: string;
};

function buildConversationPrompt(
  messages: OverlayConversationMessage[],
  prior: ClientOverlay | null | undefined,
): string {
  const transcript = messages
    .map((m) => `${m.role === "user" ? "RM" : "AI"}: ${m.content}`)
    .join("\n");
  const priorBlock = prior
    ? `\n\nPrior structured overlay (update incrementally, do not discard confirmed fields):\n${JSON.stringify(
        {
          client_profile: prior.client_profile,
          market_view: prior.market_view,
          allocation: prior.allocation,
          universe: prior.universe,
          optimization: prior.optimization,
        },
        null,
        2,
      )}`
    : "";
  return `Conversation transcript:\n${transcript}${priorBlock}`;
}

function overlaySystemPrompt(lang: Lang): string {
  return `Private banking quant copilot. Extract client needs from RM conversation into structured overlay JSON.

Rules:
- You assist RM structuring — NEVER output trade orders ("buy/sell X shares") or fabricated performance.
- Output ONLY fields in the schema; use clarification_questions when information is missing.
- confidence: 0–1 reflecting how complete the structured overlay is.
- rationale: 2–4 sentences for RM confirmation (${rationaleLanguageDirective(lang)}).
- allocation.asset_classes: pick 1–5 from equity,bond,commodity,real_estate,alternative.
- allocation.sleeve_targets: optional w_equity,w_bond,w_commodity,w_real_estate,w_alternative (0–1, should sum ≈1).
- allocation.sub_sleeve_targets: optional regional keys like w_equity_us,w_bond_us.
- universe.prompts: natural-language ETF filter rules (not trade instructions).
- optimization.objective: max_sharpe for risk-on, min_max_drawdown for defensive/liquidity.
- optimization.regime_adaptive: true when RM mentions regime/market switching.
- param_adjustments: only when RM specifies factor tilts (w_lowvol, w_mom, etc.).
- experiment: only when RM explicitly wants regime objective switch testing.
- Conservative: lower confidence and ask rather than guess weights.`;
}

function parseMessages(body: InterpretBody): OverlayConversationMessage[] {
  if (body.messages?.length) {
    return body.messages.filter((m) => m.content?.trim());
  }
  if (body.text?.trim()) {
    return [{ role: "user", content: body.text.trim() }];
  }
  return [];
}

function logInterpretResult(
  source: "gemini" | "rules",
  overlay: ClientOverlay,
  turns: number,
): void {
  if (process.env.NODE_ENV === "production") return;
  console.info("[overlay/interpret]", {
    source,
    session_id: overlay.audit.session_id,
    turns,
    confidence: overlay.confidence,
    questions: overlay.clarification_questions ?? [],
    liquidity_amount_usd: overlay.client_profile.liquidity_need?.amount_usd,
  });
}

export async function POST(req: Request) {
  const body = (await req.json()) as InterpretBody;
  const messages = parseMessages(body);

  if (!messages.length) {
    return NextResponse.json({ error: "Provide messages or text" }, { status: 400 });
  }

  const lang = parseReportLanguage(body.report_language);
  const sessionId = body.session_id?.trim() || createSessionId();
  const turns = messages.filter((m) => m.role === "user").length;
  const latestUser =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? messages.at(-1)!.content;
  const userTranscript =
    messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join("\n") || latestUser;

  const runFallback = () => {
    const overlay = interpretOverlayFallback(userTranscript, lang, sessionId, turns, body.prior_overlay);
    if (body.rm_id) overlay.audit.rm_id = body.rm_id;
    if (body.client_ref) overlay.audit.client_ref = body.client_ref;
    if (body.base_scenario_id) overlay.audit.base_scenario_id = body.base_scenario_id;
    logInterpretResult("rules", overlay, turns);
    return overlay;
  };

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const overlay = runFallback();
    return NextResponse.json({ overlay, source: "rules" });
  }

  try {
    const result = await generateText({
      model: google(GEMINI_MODEL),
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      system: overlaySystemPrompt(lang),
      prompt: buildConversationPrompt(messages, body.prior_overlay),
      providerOptions: {
        google: {
          responseMimeType: "application/json",
          thinkingConfig: { thinkingLevel: "minimal" as const },
        },
      },
    });

    const extract = validateOverlayExtract(parseOverlayExtractFromGemini(result.text));
    const overlay = wrapExtractAsOverlay(extract, sessionId, turns, "gemini", body.prior_overlay);
    if (body.rm_id) overlay.audit.rm_id = body.rm_id;
    if (body.client_ref) overlay.audit.client_ref = body.client_ref;
    if (body.base_scenario_id) overlay.audit.base_scenario_id = body.base_scenario_id;
    logInterpretResult("gemini", overlay, turns);

    return NextResponse.json({ overlay, source: "gemini" });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[overlay/interpret] Gemini failed; using rules fallback", error);
    }
    const overlay = runFallback();
    return NextResponse.json({ overlay, source: "rules" });
  }
}

import { NextResponse } from "next/server";
import { generateTextWithAudit } from "@/lib/llm-audit";
import {
  isProviderConfigured,
  KIMI_K3_MODEL_ID,
  providerOptionsFor,
  reasoningModel,
  REASONING_MAX_OUTPUT_TOKENS,
} from "@/lib/ai-provider";
import { languageDirective } from "@/lib/ai-language";
import { interpretOverlayFallback } from "@/lib/overlay-fallback";
import {
  allowOverlayRulesFallback,
  buildOverlayInterpretError,
  classifyOverlayAiFailure,
  OVERLAY_INTERPRET_ERROR_CODES,
} from "@/lib/overlay-interpret-errors";
import { parseOverlayExtractFromGemini } from "@/lib/overlay-gemini-parse";
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

type ContextPosition = {
  ticker: string;
  label?: string;
  weightLabel?: string;
};

type ContextGroup = {
  id: string;
  name: string;
  holdings: ContextPosition[];
};

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
  /** Holdings already selected for customization (display context for the AI). */
  selected_groups?: ContextGroup[];
  /** Target model portfolio anchor holdings (display context for the AI). */
  anchor_positions?: ContextPosition[];
  anchor_label?: string;
};

function formatPositions(positions?: ContextPosition[]): string {
  if (!positions || positions.length === 0) return "none";
  return positions
    .map((p) => `${p.ticker}${p.weightLabel ? ` (${p.weightLabel})` : ""}`)
    .join(", ");
}

function buildContextBlock(
  selectedGroups?: ContextGroup[],
  anchorPositions?: ContextPosition[],
  anchorLabel?: string,
): string {
  const groupLines = (selectedGroups ?? []).map(
    (g) => `- ${g.name}: ${formatPositions(g.holdings)}`,
  );
  const anchorLine = `Target model portfolio${anchorLabel ? ` (${anchorLabel})` : ""}: ${formatPositions(anchorPositions)}`;
  return `Already-confirmed customization scope (do not ask the RM to repeat this):
${anchorLine}
${groupLines.length > 0 ? `Groups selected for customization:\n${groupLines.join("\n")}` : "No specific groups selected; the whole anchor portfolio is the customization scope."}`;
}

function buildConversationPrompt(
  messages: OverlayConversationMessage[],
  prior: ClientOverlay | null | undefined,
  selectedGroups?: ContextGroup[],
  anchorPositions?: ContextPosition[],
  anchorLabel?: string,
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
  const contextBlock = buildContextBlock(selectedGroups, anchorPositions, anchorLabel);
  return `Conversation transcript:\n${transcript}\n\n${contextBlock}${priorBlock}`;
}

function overlaySystemPrompt(lang: Lang): string {
  return `Private banking quant copilot. Extract client needs from RM conversation into structured overlay JSON.

${languageDirective(lang)}

Output MUST be a single JSON object matching this schema exactly. Do not wrap in markdown.

Required top-level keys (always present):
- client_profile (object)
- market_view (object) — REQUIRED, never omit
- allocation (object)
- universe (object)
- optimization (object)
- clarification_questions (array of strings) — use [] if none
- confidence (number 0–1)
- rationale (string, 8–600 chars)

Optional top-level keys (omit entirely if unused — do not invent wrong shapes):
- param_adjustments
- experiment

Field rules:
- client_profile.risk_tolerance: "conservative" | "moderate" | "aggressive" only.
- client_profile.investment_horizon_years: number 1–50 (not a string like "long-term").
- client_profile.liquidity_need: OBJECT with optional amount_usd (number), within_months (1–120), description (string).
  NEVER use string key "liquidity_needs". If no liquidity/withdrawal need is stated, OMIT liquidity_need entirely.
- client_profile.esg_preference: "none" | "light" | "strict" only. Use "none" when client rejects ESG.
- client_profile.income_need_pct: 0–1 fraction if stated.
- market_view.stance: "risk_on" | "neutral" | "risk_off" (aggressive/growth HNWI → risk_on).
- market_view.themes: array of 1–8 short strings (e.g. "us_multi_cap", "concentration_reduction").
- market_view.narrative_summary: 8–400 chars summarizing the investment view.
- allocation.asset_classes: 1–5 from equity,bond,commodity,real_estate,alternative (required).
- allocation.sleeve_targets: optional object of w_* keys with 0–1 fractions summing ≈1. Omit if unknown; never emit {}.
- allocation.sub_sleeve_targets: optional regional weights (0–1). Omit if unknown; never emit {}.
- allocation.max_single_position_pct: 0–1 FRACTION in [0.05, 0.25]. Prefer 0.35→0.25 (schema cap). Accept 35 only if you must; prefer 0.25.
- allocation.enforce_class_weights: boolean when RM wants hard sleeve enforcement.
- universe.prompts: optional short notes for RM display only. Do NOT use prompts to invent broad ETF baskets — locked model runs ignore thematic/category matching.
- universe.supplement_tickers: explicit symbols the client (or RM) wants to ADD beyond the target model portfolio (e.g. "GLD", "BTAL"). Only add tickers here when the RM has explicitly confirmed them.
- universe.exclude_tickers: tickers to REMOVE from the target model holdings (explicit symbols only).
- universe.proposed_tickers: when the client mentions a theme/sector but does NOT provide explicit ticker symbols, list 3–6 concrete, well-known ETF candidates here for RM review. Include name, category, and a one-line rationale when helpful. These candidates are NOT part of the fund pool until the RM confirms them.
- Never add large thematic lists to supplement_tickers automatically; use proposed_tickers for suggestions and wait for RM confirmation.
- optimization.objective: max_sharpe for risk-on/growth; min_max_drawdown for defensive/liquidity.
- optimization.regime_adaptive: true when RM mentions regime/market switching.
- clarification_questions: array of STRINGS only (not objects), each 4–200 chars, max 5.
- param_adjustments: only for explicit factor tilts. Shape: { "w_lowvol": { "mode": "fixed"|"search"|"off", "fixed"?: number, "min"?: number, "max"?: number } }.
- experiment: only when RM explicitly wants regime objective-switch testing:
  { "enabled": true, "mode": "objective_switch", "regime_mode": "auto"|"risk_off"|"neutral"|"risk_on" }.

Soft guidance:
- If uncertain about an optional field, OMIT it rather than inventing wrong types/keys.
- You assist RM structuring — NEVER output trade orders ("buy/sell X shares") or fabricated performance.
- confidence: 0–1 reflecting completeness of the structured overlay.
- rationale: 2–4 sentences for RM confirmation (${rationaleLanguageDirective(lang)}). Use plain wealth-management language; avoid internal JSON field names or enum values.
- clarification_questions: ask only about information that is truly missing or ambiguous. Do NOT ask about the target model portfolio or current holdings listed in the "Already-confirmed customization scope" block; use that context to assess overlap yourself.
- All RM-facing text (questions, rationale, prompts) must be in plain, professional wealth-management language. Do NOT use developer terms or JSON values such as "risk_on", "max_sharpe", "proposed_tickers", "supplement_tickers", "factor", "objective", etc. in the text the RM reads. Internal JSON schema values may still be used in the structured fields only.

Example (aggressive growth HNWI, US multi-cap anchor, reduce QQQ concentration, no ESG, gradual cash invest, no liquidity withdrawal):
{
  "client_profile": {
    "risk_tolerance": "aggressive",
    "investment_horizon_years": 10,
    "esg_preference": "none"
  },
  "market_view": {
    "stance": "risk_on",
    "themes": ["us_multi_cap", "concentration_reduction", "phased_deployment"],
    "narrative_summary": "Aggressive HNWI with US multi-cap core; reduce single-ETF QQQ concentration and deploy cash gradually without ESG screens."
  },
  "allocation": {
    "asset_classes": ["equity", "bond"],
    "max_single_position_pct": 0.25,
    "enforce_class_weights": false
  },
  "universe": {
    "prompts": [
      "Keep US multi-cap core; reduce Nasdaq-100 concentration"
    ],
    "supplement_tickers": ["IVV", "VTI"],
    "exclude_tickers": ["QQQ"]
  },
  "optimization": {
    "objective": "max_sharpe",
    "regime_adaptive": false
  },
  "clarification_questions": [
    "Preferred equity vs bond sleeve split for the core book?",
    "Cash deployment schedule (e.g. 3 vs 6 months)?"
  ],
  "confidence": 0.72,
  "rationale": "Client is aggressive with a US multi-cap preference, wants lower QQQ concentration, no ESG, and gradual cash investment. No near-term liquidity withdrawal was stated."
}`;
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
  source: "kimi" | "rules",
  overlay: ClientOverlay,
  turns: number,
): void {
  if (process.env.NODE_ENV === "production") return;
  console.info("[overlay/interpret]", {
    source: source === "rules" ? "fallback" : "kimi",
    session_id: overlay.audit.session_id,
    turns,
    confidence: overlay.confidence,
    question_count: overlay.clarification_questions?.length ?? 0,
    liquidity_amount_usd: overlay.client_profile.liquidity_need?.amount_usd,
  });
}

function attachAuditFields(
  overlay: ClientOverlay,
  body: InterpretBody,
): ClientOverlay {
  if (body.rm_id) overlay.audit.rm_id = body.rm_id;
  if (body.client_ref) overlay.audit.client_ref = body.client_ref;
  if (body.base_scenario_id) overlay.audit.base_scenario_id = body.base_scenario_id;
  return overlay;
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

  const useRulesFallback = allowOverlayRulesFallback(req);

  const runFallback = () => {
    const overlay = interpretOverlayFallback(userTranscript, lang, sessionId, turns, body.prior_overlay);
    attachAuditFields(overlay, body);
    logInterpretResult("rules", overlay, turns);
    return overlay;
  };

  if (!isProviderConfigured(KIMI_K3_MODEL_ID)) {
    if (useRulesFallback) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[overlay/interpret] AI provider not configured; using rules fallback");
      }
      const overlay = runFallback();
      return NextResponse.json({ overlay, source: "rules" });
    }
    return buildOverlayInterpretError(
      OVERLAY_INTERPRET_ERROR_CODES.API_KEY_MISSING,
      "AI API key is not configured",
      "Set MOONSHOT_API_KEY or enable rules fallback for offline demos.",
      503,
    );
  }

  let llmLog: import("@/lib/llm-audit").LlmAuditEntry | undefined;
  try {
    const { result, log } = await generateTextWithAudit({
      model: reasoningModel(),
      maxOutputTokens: REASONING_MAX_OUTPUT_TOKENS,
      system: overlaySystemPrompt(lang),
      prompt: buildConversationPrompt(
        messages,
        body.prior_overlay,
        body.selected_groups,
        body.anchor_positions,
        body.anchor_label,
      ),
      providerOptions: providerOptionsFor(KIMI_K3_MODEL_ID, { jsonMode: true }),
    });
    llmLog = log;

    let extract;
    try {
      extract = validateOverlayExtract(parseOverlayExtractFromGemini(result.text));
    } catch (parseError) {
      if (useRulesFallback) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[overlay/interpret] AI response unusable; using rules fallback", parseError);
        }
        const overlay = runFallback();
        return NextResponse.json({ overlay, source: "rules", llm_log: llmLog });
      }
      const classified = classifyOverlayAiFailure(parseError);
      return buildOverlayInterpretError(
        classified.code,
        classified.error,
        classified.detail,
        classified.status,
      );
    }

    const overlay = wrapExtractAsOverlay(extract, sessionId, turns, "kimi", body.prior_overlay);
    attachAuditFields(overlay, body);
    logInterpretResult("kimi", overlay, turns);

    return NextResponse.json({ overlay, source: "kimi", llm_log: llmLog });
  } catch (error) {
    if (error && typeof error === "object" && "log" in error) {
      llmLog = (error as { log: import("@/lib/llm-audit").LlmAuditEntry }).log;
    }
    if (useRulesFallback) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[overlay/interpret] AI failed; using rules fallback", error);
      }
      const overlay = runFallback();
      return NextResponse.json({ overlay, source: "rules", llm_log: llmLog });
    }
    const classified = classifyOverlayAiFailure(error);
    return buildOverlayInterpretError(
      classified.code,
      classified.error,
      classified.detail,
      classified.status,
    );
  }
}

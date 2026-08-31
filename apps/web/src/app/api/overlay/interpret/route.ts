import { NextResponse } from "next/server";
import { generateTextWithAudit } from "@/lib/llm-audit";
import {
  DEFAULT_FLASH_MODEL_ID,
  defaultFlashModel,
  FLASH_MAX_OUTPUT_TOKENS,
  isProviderConfigured,
  providerOptionsFor,
} from "@/lib/ai-provider";
import { languageDirective } from "@/lib/ai-language";
import { interpretOverlayFallback } from "@/lib/overlay-fallback";
import { applyDirectIndexingToExtract } from "@/lib/overlay-direct-index";
import {
  allowOverlayRulesFallback,
  buildOverlayInterpretError,
  classifyOverlayAiFailure,
  OVERLAY_INTERPRET_ERROR_CODES,
} from "@/lib/overlay-interpret-errors";
import { parseOverlayExtractFromGemini } from "@/lib/overlay-gemini-parse";
import paramCatalog from "@/data/param-catalog.json";
import {
  createSessionId,
  validateOverlayExtract,
  wrapExtractAsOverlay,
  type ClientOverlay,
  type OverlayConversationMessage,
} from "@/lib/overlay-schema";
import { syncExtractClarifications } from "@/lib/overlay-clarifications";
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

type ClarificationAnswerPair = {
  question: string;
  answer: string;
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
  /** Optional structured Q→A pairs for the latest clarification round. */
  clarification_answers?: ClarificationAnswerPair[];
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

function normalizeClarificationAnswers(
  raw: ClarificationAnswerPair[] | undefined,
): ClarificationAnswerPair[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => ({
      question: typeof row?.question === "string" ? row.question.trim() : "",
      answer: typeof row?.answer === "string" ? row.answer.trim() : "",
    }))
    .filter((row) => row.question.length > 0 && row.answer.length > 0);
}

function buildClarificationAnswersBlock(
  answers: ClarificationAnswerPair[],
): string {
  if (!answers.length) return "";
  const lines = answers.map(
    (row, i) => `Q${i + 1}: ${row.question}\nA${i + 1}: ${row.answer}`,
  );
  return `\n\nClarification Q→A bindings (bind each answer ONLY to its matching question; do not apply an answer to a different question):\n${lines.join("\n")}`;
}

function buildConversationPrompt(
  messages: OverlayConversationMessage[],
  prior: ClientOverlay | null | undefined,
  selectedGroups?: ContextGroup[],
  anchorPositions?: ContextPosition[],
  anchorLabel?: string,
  clarificationAnswers?: ClarificationAnswerPair[],
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
          asks: prior.asks,
          clarification_questions: prior.clarification_questions ?? [],
        },
        null,
        2,
      )}`
    : "";
  const contextBlock = buildContextBlock(selectedGroups, anchorPositions, anchorLabel);
  const answersBlock = buildClarificationAnswersBlock(
    normalizeClarificationAnswers(clarificationAnswers),
  );
  return `Conversation transcript:\n${transcript}\n\n${contextBlock}${priorBlock}${answersBlock}`;
}

function overlayParamCatalogBlock(): string {
  const params = (
    paramCatalog as {
      params?: Array<{
        key: string;
        overlay_eligible?: boolean;
        bounds?: number[];
        description?: string;
        client_hint?: string;
      }>;
    }
  ).params ?? [];
  const lines = params
    .filter((p) => p.overlay_eligible)
    .map((p) => {
      const bounds =
        Array.isArray(p.bounds) && p.bounds.length >= 2
          ? `[${p.bounds[0]}~${p.bounds[1]}]`
          : "";
      return `- ${p.key} ${bounds} ${p.description ?? ""} Trigger: ${p.client_hint ?? ""}`.trim();
    });
  if (!lines.length) return "";
  return `TUNABLE PARAMETERS (param_adjustments whitelist — only these keys):
${lines.join("\n")}

param_adjustments POLICY:
- Shape: { "w_lowvol": { "mode": "fixed"|"search"|"off", "fixed"?: number, "min"?: number, "max"?: number } }.
- mode=fixed → pin the value; mode=search → give Optuna [min,max] within the listed bounds; mode=off → disable that signal.
- Prefer allocation.sleeve_targets / sub_sleeve_targets / max_single_position_pct for asset-class and single-name caps — do NOT put w_equity / w_bond / class budgets in param_adjustments.
- Only emit param_adjustments when the conversation implies an explicit factor tilt or customization-drift preference; otherwise OMIT the key entirely.`;
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
- clarification_questions (array of strings) — use [] if none; keep in sync with clarifications[].question
- clarifications (optional array, max 5) — structured clarification cards with preset answer chips:
  { "id": "q1", "question": "…", "options": [{ "id": "opt-a", "label": "…" }, …], "allow_multiple": true, "allow_free_text": true }
  Each question: 2–5 short preset options (label ≤ 20 chars, report language). Options may combine (non-mutually-exclusive). Do NOT include an "Other" option — UI adds free text. Open-ended questions may use options: [].
- confidence (number 0–1)
- rationale (string, 8–600 chars)

Optional top-level keys (omit entirely if unused — do not invent wrong shapes):
- param_adjustments
- experiment
- asks — numbered soft client asks from the RM brief (preferred when the brief is numbered)

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
- allocation.max_single_position_pct: OMIT unless the brief/asks explicitly set a single-name or ticker max. When stated, use 0–1 FRACTION in [0.05, 0.40]. Do NOT invent a default (e.g. 0.25) just because the book is locked, aggressive, or thematic.
- Needs caps/floors: do NOT invent theme exposure caps, drawdown floors/tolerances, or cash-reserve floors. Theme exposure caps apply ONLY when the client explicitly asks to cap/limit *theme* / *tech sleeve* / *growth sleeve* exposure — NOT when trimming a single ticker (e.g. NVDA), consolidating core overlap, or merely mentioning AI/tech themes. Do NOT tag themes with "concentration_reduction" for a single-name trim. Soft asks stay soft evidence — do not silently encode hard Needs floors.
- allocation.enforce_class_weights: boolean when RM wants hard sleeve enforcement.
- universe.prompts: optional short notes for RM display only. Do NOT use prompts to invent broad ETF baskets — locked model runs ignore thematic/category matching.
- universe.construction: set "direct_index" when the RM asks for direct indexing / 直接指數化 / 直接索引 / 직접 인덱싱. This means replicate or tilt around a benchmark ETF (e.g. SPY) using INDIVIDUAL STOCKS, not by swapping in other ETFs.
- universe.supplement_tickers: explicit symbols the client (or RM) wants to ADD beyond the target model portfolio (e.g. "GLD", "BTAL"). Only add tickers here when the RM has explicitly confirmed them — EXCEPT for direct_index, where you SHOULD list the stock-sleeve candidates here so the optimizer can use them.
- universe.exclude_tickers: tickers to REMOVE from the target model holdings (explicit symbols only).
- universe.proposed_tickers: when the client mentions a theme/sector but does NOT provide explicit ticker symbols, list 3–6 concrete candidates here for RM review. Default for ordinary themes: well-known ETFs. For DIRECT INDEXING: if the RM specifies a count N (e.g. "top 30", "前 30", "S&P 500 top 30"), list N S&P 500 large-cap STOCKS in typical cap order — not the 8-name mega-cap default. If no count is stated, list 4–8 individual stocks (e.g. NVDA, MSFT, AAPL, GOOGL, AMZN, META, AVGO, BRK-B). AI/theme tilt means OVERWEIGHT those names inside the N-stock sleeve, not replace the sleeve with 8 AI names. NEVER use AIQ, IRBO, BOTZ, ROBO, or similar thematic ETFs as the primary solution. Include name, category, and a one-line rationale when helpful. These candidates are NOT part of the fund pool until the RM confirms them, except direct_index stock sleeves which are also copied to supplement_tickers.
- Never add large thematic ETF lists to supplement_tickers automatically; use proposed_tickers for suggestions and wait for RM confirmation. Direct indexing is the exception: propose stocks, not thematic ETFs.
- optimization.objective: max_sharpe for risk-on/growth; min_max_drawdown for defensive/liquidity.
- optimization.regime_adaptive: true when RM mentions regime/market switching.
- clarification_questions: array of STRINGS only (not objects), each 4–200 chars, max 5. MUST mirror clarifications[].question when clarifications is present.
${overlayParamCatalogBlock()}
- experiment: only when RM explicitly wants regime objective-switch testing:
  { "enabled": true, "mode": "objective_switch", "regime_mode": "auto"|"risk_off"|"neutral"|"risk_on" }.
- asks: when the RM brief has numbered requests (1/2/3…), emit one soft ask object per request (max 12). Each ask:
  { "id": "ask-1", "title": short label, "summary": client-facing sentence,
    "kind": "group_weight_band"|"ticker_max"|"exclude_ticker"|"ticker_min"|"objective"|"cash_reserve"|"direct_index"|"other",
    "group_id"?, "tickers"?, "min_pct"?, "max_pct"?, "target_pct"?, "objective"?, "cash_reserve_pct"? }
  Percents are 0–1 fractions. Asks are SOFT targets for RM evidence — still map them into existing fields:
  cash_reserve → deployment_schedule.liquidity_buffer_pct; objective → optimization.objective;
  ticker_max → allocation.max_single_position_pct; exclude_ticker → universe.exclude_tickers;
  ticker_min preferred names → universe.supplement_tickers (do not invent large baskets).
  direct_index → universe.construction "direct_index" plus individual-stock proposed_tickers AND supplement_tickers (keep a reduced core ETF if present; do not substitute AIQ/BOTZ/IRBO).
  IMPORTANT: do NOT treat "keep AI/tech satellite aggressive at 40–45%" or "trim NVDA" as a theme CAP.
  Only apply theme-exposure reduce/cap intent when the client explicitly asks to cap/limit the *theme sleeve* (not a single ticker).

Soft guidance:
- Direct indexing (direct indexing / 直接指數化 / 直接索引 / 직접 인덱싱): this is a STOCK construction, not an ETF swap. Keep or reduce the named core ETF (SPY, IVV, VOO, …) and express factor/sector/AI tilts with individual equities already in the book or well-known mega/tech names. When the RM names a count (top 30 / 前 30), the stock sleeve MUST contain that many S&P 500 large-cap names; AI tilt is an overweight inside those N names. Do NOT propose thematic ETFs (AIQ, IRBO, BOTZ, ROBO, THNQ, …) as the way to implement direct indexing. Set universe.construction to "direct_index", emit a kind="direct_index" ask whose summary says the book is a direct index with stocks, and list those stocks on proposed_tickers + supplement_tickers.
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
  "asks": [
    {
      "id": "ask-1",
      "title": "Reduce QQQ concentration",
      "summary": "Lower single-ETF Nasdaq concentration while keeping a US multi-cap core.",
      "kind": "exclude_ticker",
      "tickers": ["QQQ"]
    },
    {
      "id": "ask-2",
      "title": "Max Sharpe",
      "summary": "Optimize for maximum Sharpe under an aggressive growth mandate.",
      "kind": "objective",
      "objective": "max_sharpe"
    }
  ],
  "clarifications": [
    {
      "id": "q1",
      "question": "Preferred equity vs bond sleeve split for the core book?",
      "options": [
        { "id": "70-30", "label": "70% equity / 30% bonds" },
        { "id": "60-40", "label": "60% equity / 40% bonds" },
        { "id": "80-20", "label": "80% equity / 20% bonds" }
      ],
      "allow_multiple": false,
      "allow_free_text": true
    },
    {
      "id": "q2",
      "question": "Cash deployment schedule?",
      "options": [
        { "id": "3m", "label": "3 months" },
        { "id": "6m", "label": "6 months" },
        { "id": "12m", "label": "12 months" }
      ],
      "allow_multiple": false,
      "allow_free_text": true
    }
  ],
  "clarification_questions": [
    "Preferred equity vs bond sleeve split for the core book?",
    "Cash deployment schedule (e.g. 3 vs 6 months)?"
  ],
  "confidence": 0.72,
  "rationale": "Client is aggressive with a US multi-cap preference, wants lower QQQ concentration, no ESG, and gradual cash investment. No near-term liquidity withdrawal was stated."
}`;
}

function parseMessages(body: InterpretBody | null | undefined): OverlayConversationMessage[] {
  if (!body || typeof body !== "object") return [];
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
    source: source === "rules" ? "fallback" : "gemini",
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

function logInterpretFailure(
  classified: ReturnType<typeof classifyOverlayAiFailure>,
): void {
  if (process.env.NODE_ENV === "production") return;
  console.warn("[overlay/interpret] error", {
    code: classified.code,
    status: classified.status,
    error: classified.error,
    detail: classified.detail,
  });
}

export async function POST(req: Request) {
  let body: InterpretBody;
  try {
    body = (await req.json()) as InterpretBody;
  } catch (error) {
    const detail =
      error instanceof Error ? error.message.slice(0, 500) : "Request body must be JSON";
    return buildOverlayInterpretError(
      OVERLAY_INTERPRET_ERROR_CODES.RESPONSE_INVALID,
      "Invalid JSON request body",
      detail,
      400,
    );
  }

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
  const clarificationAnswers = normalizeClarificationAnswers(body.clarification_answers);
  const diSourceText = [
    userTranscript,
    ...clarificationAnswers.flatMap((row) => [row.question, row.answer]),
  ]
    .filter(Boolean)
    .join("\n");

  const useRulesFallback = allowOverlayRulesFallback(req);

  const runFallback = () => {
    const overlay = interpretOverlayFallback(diSourceText, lang, sessionId, turns, body.prior_overlay);
    attachAuditFields(overlay, body);
    logInterpretResult("rules", overlay, turns);
    return overlay;
  };

  if (!isProviderConfigured(DEFAULT_FLASH_MODEL_ID)) {
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
      "Set GOOGLE_GENERATIVE_AI_API_KEY (or GEMINI_API_KEY) or enable rules fallback for offline demos.",
      503,
    );
  }

  let llmLog: import("@/lib/llm-audit").LlmAuditEntry | undefined;
  try {
    const { result, log } = await generateTextWithAudit({
      model: defaultFlashModel(),
      maxOutputTokens: FLASH_MAX_OUTPUT_TOKENS,
      system: overlaySystemPrompt(lang),
      prompt: buildConversationPrompt(
        messages,
        body.prior_overlay,
        body.selected_groups,
        body.anchor_positions,
        body.anchor_label,
        body.clarification_answers,
      ),
      providerOptions: providerOptionsFor(DEFAULT_FLASH_MODEL_ID, { jsonMode: true }),
    });
    llmLog = log;

    let extract;
    try {
      extract = validateOverlayExtract(parseOverlayExtractFromGemini(result.text));
      extract = syncExtractClarifications(extract, lang);
      extract = applyDirectIndexingToExtract(extract, diSourceText, lang);
    } catch (parseError) {
      if (useRulesFallback) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[overlay/interpret] AI response unusable; using rules fallback", parseError);
        }
        const overlay = runFallback();
        return NextResponse.json({ overlay, source: "rules", llm_log: llmLog });
      }
      const classified = classifyOverlayAiFailure(parseError);
      logInterpretFailure(classified);
      return buildOverlayInterpretError(
        classified.code,
        classified.error,
        classified.detail,
        classified.status,
      );
    }

    const overlay = wrapExtractAsOverlay(extract, sessionId, turns, "gemini", body.prior_overlay);
    attachAuditFields(overlay, body);
    logInterpretResult("gemini", overlay, turns);

    return NextResponse.json({ overlay, source: "gemini", llm_log: llmLog });
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
    logInterpretFailure(classified);
    return buildOverlayInterpretError(
      classified.code,
      classified.error,
      classified.detail,
      classified.status,
    );
  }
}

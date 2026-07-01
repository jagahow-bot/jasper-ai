import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { NextResponse } from "next/server";
import { type AiLang, languageDirective, normalizeAiLang } from "@/lib/ai-language";
import { AI_METRIC_FORMAT_RULES, formatPctDecimal } from "@/lib/ai-metric-format";
import { GEMINI_MAX_OUTPUT_TOKENS, GEMINI_MODEL } from "@/lib/gemini";
import { slimNarrativeFacts } from "@/lib/narrative-slim";
import { validateNarrative } from "@/lib/narrative-validate";

function buildSystem(lang: AiLang): string {
  return `You are a quant strategy analyst. ${languageDirective(lang)} Use only JSON facts.
${AI_METRIC_FORMAT_RULES}
- Trial selection / champion pick uses in-sample only when report_horizons.oos_enabled is true (see report_analysis_note).
- For interpretation, always use report_horizons when present: compare in_sample, out_of_sample, and full_sample (ttl) Sharpe/CAGR/max drawdown/objective_value.
- Discuss IS vs OOS vs full-sample gaps for overfitting / generalization when holdout is enabled.
- top_sharpe / top_cagr on the root object are champion display metrics (in-sample when holdout on); full_sample lives under report_horizons.full_sample.
- train_* / validation_* mirror holdout diagnostics; prefer report_horizons for structured comparison.
- Objective: always describe the optimization/ranking objective as objective_label (the user's pick, e.g. "Max CAGR"). Never claim a different objective, and never invent an objective not in the facts.
  - When dynamic_objective_mode is true, the strategy is ranked on a blended composite ("dynamic") score — you may call it a dynamic/composite objective.
  - When regime_adaptive is true but dynamic_objective_mode is false, the ALLOCATOR preset switches by market regime (risk_off/neutral/risk_on) each rebalance while ranking still uses objective_label. Describe this as regime-adaptive allocation with {objective_label} ranking — do NOT call it a dynamic or multi-objective strategy, and do NOT say the objective itself changes over time.
  - dynamic_objectives_used lists the per-regime allocator presets, not the ranking objective; only reference it as allocator behavior.
- Mention: each rebalance runs factor Top-N screen then allocator (dynamic), if narrative_facts mentions it.
- Mention max_weight_constraint vs max_weight_trial_param vs max_weight_observed when discussing concentration risk.
- Mention assumptions: fee_bps, rebalance_freq, benchmark (backtest_spec).
- If a field is null, say "not provided"
- End with: For research and education only — not investment advice.`;
}

export async function POST(req: Request) {
  const { facts, lang: rawLang } = (await req.json()) as {
    facts: Record<string, unknown>;
    lang?: string;
  };
  const lang = normalizeAiLang(rawLang);

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return NextResponse.json({
      narrative: buildFallbackNarrative(facts),
      source: "template",
      validated: true,
    });
  }

  try {
    const text = await generateWithValidation(facts, lang);
    return NextResponse.json({ narrative: text, source: "gemini", validated: true });
  } catch {
    return NextResponse.json({
      narrative: buildFallbackNarrative(facts),
      source: "template",
      validated: true,
    });
  }
}

async function generateWithValidation(facts: Record<string, unknown>, lang: AiLang) {
  const slim = slimNarrativeFacts(facts);
  let text = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const extra =
      attempt === 0
        ? ""
        : "\nPrior draft had unauthorized numbers or wrong % scaling. Use only facts values; rates are decimals → multiply by 100 for %.";
    const result = await generateText({
      model: google(GEMINI_MODEL),
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      providerOptions: {
        google: {
          thinkingConfig: {
            thinkingLevel: "minimal" as const,
          },
        },
      },
      system: buildSystem(lang),
      prompt: `Write 2-4 paragraphs interpreting this backtest:\n${JSON.stringify(slim, null, 2)}${extra}`,
    });
    text = result.text;
    const check = validateNarrative(text, facts);
    if (check.ok) return text;
  }
  return buildFallbackNarrative(facts);
}

function buildFallbackNarrative(facts: Record<string, unknown>) {
  const period = facts.period as { start?: string; end?: string } | undefined;
  const horizons = facts.report_horizons as
    | {
        in_sample?: Record<string, unknown>;
        out_of_sample?: Record<string, unknown> | null;
        full_sample?: Record<string, unknown>;
        gap?: Record<string, unknown> | null;
      }
    | undefined;
  const lines = [
    `Period ${period?.start ?? "—"} ~ ${period?.end ?? "—"}.`,
    `Champion (selection view): Sharpe ${facts.top_sharpe ?? "—"}, max DD ${formatPctDecimal(facts.top_max_drawdown)}, CAGR ${formatPctDecimal(facts.top_cagr)}.`,
  ];
  if (horizons?.full_sample) {
    const full = horizons.full_sample;
    lines.push(
      `Full sample (ttl): Sharpe ${full.sharpe ?? "—"}, max DD ${formatPctDecimal(full.max_drawdown)}, CAGR ${formatPctDecimal(full.cagr)}.`,
    );
  }
  if (facts.oos_enabled) {
    const is = horizons?.in_sample;
    const oos = horizons?.out_of_sample;
    lines.push(
      `In-sample: Sharpe ${is?.sharpe ?? facts.train_sharpe ?? "—"}, max DD ${formatPctDecimal(is?.max_drawdown ?? facts.train_max_drawdown)}.`,
    );
    lines.push(
      `Out-of-sample: Sharpe ${oos?.sharpe ?? facts.validation_sharpe ?? "—"}, max DD ${formatPctDecimal(oos?.max_drawdown ?? facts.validation_max_drawdown)}.`,
    );
    const gap = horizons?.gap as { sharpe?: number; objective?: number } | null | undefined;
    if (gap?.sharpe != null || gap?.objective != null) {
      lines.push(
        `IS−OOS gap: objective ${gap.objective ?? "—"}, Sharpe ${gap.sharpe ?? "—"}.`,
      );
    }
  }
  const spec = facts.backtest_spec as Record<string, unknown> | undefined;
  if (spec) {
    lines.push(
      `Assumptions: fee ${spec.fee_bps} bps, rebalance ${spec.rebalance_freq}, benchmark ${spec.benchmark}.`,
    );
  }
  lines.push("For research and education only — not investment advice.");
  return lines.join("\n");
}

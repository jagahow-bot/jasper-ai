import { ASSET_CLASSES } from "@/lib/constants";
import {
  goalHorizonYears,
  nearestLiquidityGoal,
  type FinancialGoal,
  type GoalAssumptions,
} from "@/lib/financial-goal";
import type { GoalPathInsight } from "@/lib/financial-goal-insights";
import { rewriteLargeMonthDurationsInText } from "@/lib/financial-goal-insights";
import {
  createSessionId,
  wrapExtractAsOverlay,
  type ClientOverlay,
  type OverlayConversationMessage,
} from "@/lib/overlay-schema";

function applyInsightHooks(
  hooks: Set<string>,
  near: FinancialGoal | null,
): {
  objective: "max_sharpe" | "min_max_drawdown" | "max_return";
  liquidity_buffer_pct: number;
  sleeve_targets: {
    w_equity: number;
    w_bond: number;
    w_commodity: number;
    w_real_estate: number;
  };
} {
  const objective = hooks.has("min_drawdown")
    ? "min_max_drawdown"
    : hooks.has("return")
      ? "max_return"
      : "max_sharpe";

  let liquidity_buffer_pct = near
    ? Math.min(0.4, near.amountUsd > 0 ? 0.15 : 0)
    : 0.1;
  if (hooks.has("liquidity_buffer")) {
    liquidity_buffer_pct = Math.min(0.4, Math.max(liquidity_buffer_pct, 0.22));
  }

  let sleeve_targets = {
    w_equity: 0.45,
    w_bond: 0.4,
    w_commodity: 0.05,
    w_real_estate: 0.1,
  };
  if (hooks.has("min_drawdown") || hooks.has("risk")) {
    sleeve_targets = {
      w_equity: 0.35,
      w_bond: 0.5,
      w_commodity: 0.05,
      w_real_estate: 0.1,
    };
  } else if (hooks.has("return")) {
    sleeve_targets = {
      w_equity: 0.55,
      w_bond: 0.3,
      w_commodity: 0.05,
      w_real_estate: 0.1,
    };
  }

  return { objective, liquidity_buffer_pct, sleeve_targets };
}

/** Prefill Overlay draft from confirmed goals + assumptions (+ optional path insights). */
export function seedOverlayFromFinancialGoals(
  goals: FinancialGoal[],
  assumptions: GoalAssumptions,
  clientId: string,
  lang: "en" | "zh" | "ko",
  insights?: GoalPathInsight[] | null,
): { overlay: ClientOverlay; messages: OverlayConversationMessage[] } {
  const near = nearestLiquidityGoal(goals);
  const goalSummary = goals
    .map(
      (g) =>
        `${g.label || g.type}: USD ${Math.round(g.amountUsd).toLocaleString()} @ ${g.withinMonths}m`,
    )
    .join("; ");

  const sanitizedInsights =
    insights?.map((i) => ({
      ...i,
      title: rewriteLargeMonthDurationsInText(i.title, lang),
      detail: rewriteLargeMonthDurationsInText(i.detail, lang),
      talking_point: rewriteLargeMonthDurationsInText(i.talking_point, lang),
    })) ?? null;
  const hasInsights = Boolean(sanitizedInsights && sanitizedInsights.length > 0);
  const insightLines = hasInsights
    ? sanitizedInsights!
        .map((i) => `${i.title}: ${i.detail}`)
        .join(lang === "zh" || lang === "ko" ? "；" : "; ")
    : "";

  const desc =
    near?.label ||
    (lang === "zh"
      ? "財務目標模擬器流動性需求"
      : lang === "ko"
        ? "재무 목표 시뮬레이터 유동성 니즈"
        : "Goal-simulator liquidity need");

  const rationaleBase =
    lang === "zh"
      ? `財務目標模擬預填。目標：${goalSummary}。報酬假設 ${(assumptions.annualReturn * 100).toFixed(1)}%，年增投入 USD ${Math.round(assumptions.annualContributionUsd).toLocaleString()}。`
      : lang === "ko"
        ? `재무 목표 시뮬레이터 사전입력. 목표: ${goalSummary}. 수익률 ${(assumptions.annualReturn * 100).toFixed(1)}%, 연간 추가투자 USD ${Math.round(assumptions.annualContributionUsd).toLocaleString()}.`
        : `Seeded from goal simulator. Goals: ${goalSummary}. Return ${(assumptions.annualReturn * 100).toFixed(1)}%, annual contribution USD ${Math.round(assumptions.annualContributionUsd).toLocaleString()}.`;

  const rationale = insightLines
    ? `${rationaleBase} ${
        lang === "zh"
          ? `客製化優先課題：${insightLines}`
          : lang === "ko"
            ? `맞춤화 우선 과제: ${insightLines}`
            : `Customization priorities: ${insightLines}`
      }`
    : rationaleBase;

  const hooks = new Set(
    (sanitizedInsights ?? []).flatMap((i) => i.customization_hooks),
  );
  const goalYears = goalHorizonYears(goals);
  const tuned = applyInsightHooks(hooks, near);

  const themes = ["goals", "liquidity"];
  if (hooks.has("min_drawdown") || hooks.has("risk")) themes.push("drawdown");
  if (hooks.has("return")) themes.push("growth");
  if (hooks.has("deployment") || hooks.has("liquidity_buffer")) {
    themes.push("liquidity_buffer");
  }

  const narrative_summary = hasInsights
    ? lang === "zh"
      ? `由財務目標模擬帶入；客製化須優先處理：${sanitizedInsights!.map((i) => i.title).join("、")}。`
      : lang === "ko"
        ? `재무 목표 시뮬레이터에서 가져옴. 맞춤화 우선: ${sanitizedInsights!.map((i) => i.title).join(", ")}.`
        : `Imported from goal simulator; customization must address: ${sanitizedInsights!.map((i) => i.title).join(", ")}.`
    : lang === "zh"
      ? "由財務目標模擬帶入；請在對話中補強市場觀點與風險偏好。"
      : lang === "ko"
        ? "재무 목표 시뮬레이터에서 가져옴. 대화에서 시장 관점·위험성향을 보완하세요."
        : "Imported from goal simulator; refine market view and risk in chat.";

  const needDeployment =
    assumptions.annualContributionUsd > 0 ||
    hooks.has("deployment") ||
    hooks.has("liquidity_buffer") ||
    Boolean(near);

  const extract = {
    client_profile: {
      investment_horizon_years: goalYears,
      ...(near
        ? {
            liquidity_need: {
              amount_usd: near.amountUsd,
              within_months: Math.min(120, near.withinMonths),
              description: desc.slice(0, 300),
            },
          }
        : {}),
    },
    market_view: {
      stance: "neutral" as const,
      themes,
      narrative_summary,
    },
    allocation: {
      asset_classes: [...ASSET_CLASSES],
      sleeve_targets: tuned.sleeve_targets,
      max_single_position_pct: 0.1,
    },
    universe: { prompts: [] as string[] },
    optimization: {
      objective: tuned.objective,
      regime_adaptive: false,
      optimization_mode: "standard" as const,
    },
    deployment_schedule: needDeployment
      ? {
          months: Math.min(
            24,
            Math.max(
              1,
              near
                ? Math.ceil(near.withinMonths / 2)
                : goalYears * 2,
            ),
          ),
          liquidity_buffer_pct: tuned.liquidity_buffer_pct,
        }
      : undefined,
    clarification_questions: hasInsights
      ? sanitizedInsights!.slice(0, 3).map((i) =>
          lang === "zh"
            ? `客製化如何回應「${i.title}」？建議：${i.talking_point}`
            : lang === "ko"
              ? `맞춤화에서 「${i.title}」을(를) 어떻게 반영할까요? 제안: ${i.talking_point}`
              : `How should customization address “${i.title}”? Suggested: ${i.talking_point}`,
        )
      : [],
    confidence: hasInsights ? 0.7 : 0.6,
    rationale: rationale.slice(0, 2000),
  };

  const overlay = wrapExtractAsOverlay(
    extract,
    createSessionId(),
    1,
    "rules",
  );
  overlay.audit.client_ref = clientId;
  overlay.audit.phase = hasInsights ? "clarify" : "discovery";

  const insightLead = hasInsights
    ? lang === "zh"
      ? `客製化優先課題（請在 Overlay 對準解題）：\n${sanitizedInsights!
          .map(
            (i, n) =>
              `${n + 1}. ${i.title} — ${i.talking_point}\n   解法槓桿：${i.customization_hooks.join("、")}`,
          )
          .join("\n")}\n\n已依課題預填：優化目標=${tuned.objective}、流動性緩衝=${Math.round(tuned.liquidity_buffer_pct * 100)}%。\n\n`
      : lang === "ko"
        ? `맞춤화 우선 과제(Overlay에서 해결):\n${sanitizedInsights!
            .map(
              (i, n) =>
                `${n + 1}. ${i.title} — ${i.talking_point}\n   레버: ${i.customization_hooks.join(", ")}`,
            )
            .join("\n")}\n\n사전입력: 목표=${tuned.objective}, 유동성 버퍼=${Math.round(tuned.liquidity_buffer_pct * 100)}%.\n\n`
        : `Customization priorities (solve in Overlay):\n${sanitizedInsights!
            .map(
              (i, n) =>
                `${n + 1}. ${i.title} — ${i.talking_point}\n   Levers: ${i.customization_hooks.join(", ")}`,
            )
            .join("\n")}\n\nPrefill: objective=${tuned.objective}, liquidity buffer=${Math.round(tuned.liquidity_buffer_pct * 100)}%.\n\n`
    : "";

  const assistant =
    insightLead +
    (lang === "zh"
      ? `已從財務目標模擬器帶入 ${goals.length} 筆目標（${goalSummary}）。近端流動性與年期已預填，請確認課題對應後簽核。`
      : lang === "ko"
        ? `재무 목표 시뮬레이터에서 목표 ${goals.length}건을 가져왔습니다 (${goalSummary}). 유동성·투자기간이 사전입력되었으니 과제를 확인한 뒤 확정하세요.`
        : `Imported ${goals.length} goal(s) from the simulator (${goalSummary}). Liquidity/horizon are prefilled — confirm priorities then sign off.`);

  return {
    overlay,
    messages: [{ role: "assistant", content: assistant }],
  };
}

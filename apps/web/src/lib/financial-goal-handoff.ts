import { ASSET_CLASSES } from "@/lib/constants";
import {
  goalHorizonYears,
  nearestLiquidityGoal,
  type FinancialGoal,
  type GoalAssumptions,
} from "@/lib/financial-goal";
import {
  createSessionId,
  wrapExtractAsOverlay,
  type ClientOverlay,
  type OverlayConversationMessage,
} from "@/lib/overlay-schema";

/** Prefill Overlay draft from confirmed goals + assumptions. */
export function seedOverlayFromFinancialGoals(
  goals: FinancialGoal[],
  assumptions: GoalAssumptions,
  clientId: string,
  lang: "en" | "zh" | "ko",
): { overlay: ClientOverlay; messages: OverlayConversationMessage[] } {
  const near = nearestLiquidityGoal(goals);
  const goalSummary = goals
    .map(
      (g) =>
        `${g.label || g.type}: USD ${Math.round(g.amountUsd).toLocaleString()} @ ${g.withinMonths}m`,
    )
    .join("; ");

  const desc =
    near?.label ||
    (lang === "zh"
      ? "財務目標模擬器流動性需求"
      : lang === "ko"
        ? "재무 목표 시뮬레이터 유동성 니즈"
        : "Goal-simulator liquidity need");

  const rationale =
    lang === "zh"
      ? `財務目標模擬預填。目標：${goalSummary}。報酬假設 ${(assumptions.annualReturn * 100).toFixed(1)}%，年增投入 USD ${Math.round(assumptions.annualContributionUsd).toLocaleString()}。`
      : lang === "ko"
        ? `재무 목표 시뮬레이터 사전입력. 목표: ${goalSummary}. 수익률 ${(assumptions.annualReturn * 100).toFixed(1)}%, 연간 추가투자 USD ${Math.round(assumptions.annualContributionUsd).toLocaleString()}.`
        : `Seeded from goal simulator. Goals: ${goalSummary}. Return ${(assumptions.annualReturn * 100).toFixed(1)}%, annual contribution USD ${Math.round(assumptions.annualContributionUsd).toLocaleString()}.`;

  const extract = {
    client_profile: {
      investment_horizon_years: goalHorizonYears(goals),
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
      themes: ["goals", "liquidity"],
      narrative_summary:
        lang === "zh"
          ? "由財務目標模擬帶入；請在對話中補強市場觀點與風險偏好。"
          : lang === "ko"
            ? "재무 목표 시뮬레이터에서 가져옴. 대화에서 시장 관점·위험성향을 보완하세요."
            : "Imported from goal simulator; refine market view and risk in chat.",
    },
    allocation: {
      asset_classes: [...ASSET_CLASSES],
      sleeve_targets: {
        w_equity: 0.45,
        w_bond: 0.4,
        w_commodity: 0.05,
        w_real_estate: 0.1,
      },
      max_single_position_pct: 0.1,
    },
    universe: { prompts: [] as string[] },
    optimization: {
      objective: "max_sharpe" as const,
      regime_adaptive: false,
      optimization_mode: "standard" as const,
    },
    deployment_schedule:
      assumptions.annualContributionUsd > 0
        ? {
            months: Math.min(24, Math.max(1, goalHorizonYears(goals) * 2)),
            liquidity_buffer_pct: near
              ? Math.min(0.4, near.amountUsd > 0 ? 0.15 : 0)
              : 0.1,
          }
        : undefined,
    clarification_questions: [] as string[],
    confidence: 0.6,
    rationale,
  };

  const overlay = wrapExtractAsOverlay(
    extract,
    createSessionId(),
    1,
    "rules",
  );
  overlay.audit.client_ref = clientId;
  overlay.audit.phase = "discovery";

  const assistant =
    lang === "zh"
      ? `已從財務目標模擬器帶入 ${goals.length} 筆目標（${goalSummary}）。近端流動性與年期已預填，請補充風險偏好後簽核。`
      : lang === "ko"
        ? `재무 목표 시뮬레이터에서 목표 ${goals.length}건을 가져왔습니다 (${goalSummary}). 유동성·투자기간이 사전입력되었으니 위험성향을 보완한 뒤 확정하세요.`
        : `Imported ${goals.length} goal(s) from the simulator (${goalSummary}). Liquidity/horizon are prefilled — refine risk then sign off.`;

  return {
    overlay,
    messages: [{ role: "assistant", content: assistant }],
  };
}

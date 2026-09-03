import { ASSET_CLASSES } from "@/lib/constants";
import {
  goalHorizonYears,
  type FinancialGoal,
  type FinancialGoalType,
} from "@/lib/financial-goal";
import {
  createSessionId,
  wrapExtractAsOverlay,
  type ClientOverlay,
  type OverlayConversationMessage,
} from "@/lib/overlay-schema";

function goalTypeLabel(type: FinancialGoalType, lang: "en" | "zh" | "ko"): string {
  const map: Record<FinancialGoalType, Record<"en" | "zh" | "ko", string>> = {
    home: { en: "home purchase", zh: "購屋", ko: "주택 구매" },
    retirement: { en: "retirement", zh: "退休", ko: "은퇴" },
    education: { en: "education", zh: "教育", ko: "교육" },
    other: { en: "financial goal", zh: "財務目標", ko: "재무 목표" },
  };
  return map[type][lang];
}

/** Prefill Overlay draft from a confirmed financial goal (rules source). */
export function seedOverlayFromFinancialGoal(
  goal: FinancialGoal,
  clientId: string,
  lang: "en" | "zh" | "ko",
): { overlay: ClientOverlay; messages: OverlayConversationMessage[] } {
  const label = goalTypeLabel(goal.type, lang);
  const desc =
    goal.description?.trim() ||
    (lang === "zh"
      ? `${label}流動性需求`
      : lang === "ko"
        ? `${label} 유동성 니즈`
        : `${label} liquidity need`);
  const rationale =
    lang === "zh"
      ? `財務目標模擬器預填：${desc}，約 USD ${goal.amountUsd.toLocaleString()}，${goal.withinMonths} 個月內。`
      : lang === "ko"
        ? `재무 목표 시뮬레이터 사전입력: ${desc}, 약 USD ${goal.amountUsd.toLocaleString()}, ${goal.withinMonths}개월 내.`
        : `Seeded from financial goal simulator: ${desc}, ~USD ${goal.amountUsd.toLocaleString()}, within ${goal.withinMonths} months.`;

  const extract = {
    client_profile: {
      investment_horizon_years: goalHorizonYears(goal),
      liquidity_need: {
        amount_usd: goal.amountUsd,
        within_months: goal.withinMonths,
        description: desc.slice(0, 300),
      },
    },
    market_view: {
      stance: "neutral" as const,
      themes: ["liquidity"],
      narrative_summary:
        lang === "zh"
          ? "由財務目標模擬帶入；市場觀點待 RM 於對話中補充。"
          : lang === "ko"
            ? "재무 목표 시뮬레이터에서 가져옴. 시장 관점은 RM이 대화에서 보완."
            : "Imported from goal simulator; market view to be refined in chat.",
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
    clarification_questions: [] as string[],
    confidence: 0.55,
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
      ? `已從財務目標模擬器帶入流動性需求：${desc}（USD ${goal.amountUsd.toLocaleString()}／${goal.withinMonths} 個月）。請補充風險偏好或其他約束，再簽核。`
      : lang === "ko"
        ? `재무 목표 시뮬레이터에서 유동성 니즈를 가져왔습니다: ${desc}(USD ${goal.amountUsd.toLocaleString()} / ${goal.withinMonths}개월). 위험성향 등 제약을 보완한 뒤 확정해 주세요.`
        : `Imported liquidity need from the goal simulator: ${desc} (USD ${goal.amountUsd.toLocaleString()} / ${goal.withinMonths} months). Add risk or other constraints, then sign off.`;

  return {
    overlay,
    messages: [{ role: "assistant", content: assistant }],
  };
}

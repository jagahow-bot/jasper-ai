/**
 * Mechanical overlay feasibility pre-check (design §3.3).
 * Deterministic — no LLM. Used before interpret results become BacktestRequest.
 */

import type { CapabilityGap, OverlayConflict } from "@/lib/overlay-schema";

/** RM alone may raise customization_drift up to this; above → supervisor (§8). */
export const DRIFT_OVERRIDE_RM_MAX = 0.6;

export type L1DriftCheck = {
  minRequiredDrift: number;
  feasible: boolean;
  declaredDrift: number;
  oneWayTurnover: number;
};

/**
 * customization_drift is one-way L1: 0.5 · ‖w − anchor‖₁.
 * For sleeve targets that share no mass with the anchor, required drift ≈ 1.0
 * when Σ|remove| + Σ|add| = 2.
 */
export function minL1DriftForTarget(
  anchor: Record<string, number>,
  targetSleeves: Record<string, number>,
  sleeveMembership: Record<string, string[]>,
  declaredDrift: number,
): L1DriftCheck {
  const targetWeights: Record<string, number> = {};
  for (const [sleeve, weight] of Object.entries(targetSleeves)) {
    const members = sleeveMembership[sleeve] ?? [];
    const w = Number(weight);
    if (!Number.isFinite(w) || w <= 0 || members.length === 0) continue;
    const each = w / members.length;
    for (const t of members) {
      const key = t.toUpperCase();
      targetWeights[key] = (targetWeights[key] ?? 0) + each;
    }
  }
  const tickers = new Set([
    ...Object.keys(anchor),
    ...Object.keys(targetWeights),
  ]);
  let l1 = 0;
  for (const t of tickers) {
    const a = Number(anchor[t] ?? 0);
    const b = Number(targetWeights[t] ?? 0);
    l1 += Math.abs(a - b);
  }
  const oneWay = 0.5 * l1;
  const declared = Number.isFinite(declaredDrift) ? declaredDrift : 0.5;
  return {
    minRequiredDrift: oneWay,
    feasible: oneWay <= declared + 1e-9,
    declaredDrift: declared,
    oneWayTurnover: oneWay,
  };
}

export function buildInfeasibleDriftConflict(
  check: L1DriftCheck,
  opts: { lang?: "zh" | "en" | "ko" } = {},
): OverlayConflict {
  const lang = opts.lang ?? "zh";
  const needPct = Math.round(check.minRequiredDrift * 100);
  const havePct = Math.round(check.declaredDrift * 100);
  const suggested = Math.min(1, Math.ceil(check.minRequiredDrift * 100) / 100);
  const requiresSupervisor = suggested > DRIFT_OVERRIDE_RM_MAX;
  const titles = {
    zh: "目前的客製化幅度上限無法達成此配置",
    en: "Current customization drift cannot achieve this allocation",
    ko: "현재 커스터마이징 한도로 이 배분을 달성할 수 없습니다",
  };
  const explain = {
    zh: `此需求與基準的差異約需 ${needPct}% 偏離幅度；目前上限為 ${havePct}%，最多只能表達約 ${(havePct).toFixed(0)}% 的差異。請選擇調整方式——系統不會靜默給半套答案。`,
    en: `This request needs about ${needPct}% drift vs the anchor; the current cap is ${havePct}%. Choose an option — the system will not silently half-answer.`,
    ko: `이 요청은 기준 대비 약 ${needPct}% 편차가 필요하지만 현재 한도는 ${havePct}%입니다. 옵션을 선택하세요 — 시스템이 조용히 절반만 응답하지 않습니다.`,
  };
  const gapStub: CapabilityGap = {
    stage: "allocator",
    kind: "infeasible_combination",
    missing_capability: "two_layer_sleeve_allocation",
    summary:
      lang === "zh"
        ? "二層袖珍（如 50% AI / 50% 避險）超出目前單層配置器與漂移上限。"
        : "Two-layer sleeve allocation exceeds single-layer allocator + drift.",
    requested: {
      min_required_drift: check.minRequiredDrift,
      declared_drift: check.declaredDrift,
    },
    nearest_supported: {
      customization_drift: check.declaredDrift,
      note: "partial L1 projection toward sleeves",
    },
    severity: "blocking",
  };
  return {
    id: "conflict-drift",
    code: "INFEASIBLE_DRIFT",
    title: titles[lang],
    explanation: explain[lang],
    suggested_drift: suggested,
    requires_supervisor: requiresSupervisor,
    gap_stub: gapStub,
    options: [
      {
        id: "raise-drift",
        label:
          lang === "zh"
            ? `提高偏離至 ${Math.round(suggested * 100)}%`
            : `Raise drift to ${Math.round(suggested * 100)}%`,
      },
      {
        id: "soften-target",
        label: lang === "zh" ? "縮小配置差異" : "Soften target",
      },
      {
        id: "submit-gap",
        label: lang === "zh" ? "提交能力缺口" : "Submit capability gap",
      },
    ],
  };
}

/**
 * Stage attribution: LLM fills stage; BFF validates against the 8-stage enum.
 * Invalid → clarification ask (design §8 decision 1).
 */
export function validateCapabilityGapStages(
  gaps: CapabilityGap[] | undefined,
): { valid: CapabilityGap[]; clarifications: Array<{ id: string; question: string }> } {
  const valid: CapabilityGap[] = [];
  const clarifications: Array<{ id: string; question: string }> = [];
  const allowed = new Set([
    "universe",
    "signals",
    "allocator",
    "constraints",
    "objective",
    "rebalance",
    "cash_schedule",
    "reporting",
  ]);
  for (const g of gaps ?? []) {
    if (!allowed.has(g.stage)) {
      clarifications.push({
        id: `gap-stage-${g.missing_capability}`.slice(0, 40),
        question: `Which engine stage should own capability "${g.missing_capability}"? (universe/signals/allocator/constraints/objective/rebalance/cash_schedule/reporting)`,
      });
      continue;
    }
    valid.push(g);
  }
  return { valid, clarifications };
}

/** Encode §8 drift override policy. */
export function driftOverrideApproval(requestedDrift: number): {
  allowedForRm: boolean;
  requiresSupervisor: boolean;
} {
  const d = Math.max(0, Math.min(1, requestedDrift));
  return {
    allowedForRm: d <= DRIFT_OVERRIDE_RM_MAX + 1e-12,
    requiresSupervisor: d > DRIFT_OVERRIDE_RM_MAX + 1e-12,
  };
}


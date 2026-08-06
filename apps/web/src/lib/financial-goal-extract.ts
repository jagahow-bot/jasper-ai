import {
  clampAssumptions,
  createGoalId,
  DEFAULT_GOAL_ASSUMPTIONS,
  FINANCIAL_GOAL_TYPES,
  type FinancialGoal,
  type FinancialGoalType,
  type GoalAssumptions,
} from "@/lib/financial-goal";

export type GoalExtractResult = {
  goals: FinancialGoal[];
  assumptions: GoalAssumptions;
  clarification_questions: string[];
  confidence: number;
  rationale: string;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,%\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function normalizeType(raw: unknown): FinancialGoalType {
  const s = String(raw ?? "other").toLowerCase();
  if (s.includes("home") || s.includes("house") || s.includes("購屋") || s.includes("주택")) {
    return "home";
  }
  if (s.includes("retire") || s.includes("退休") || s.includes("은퇴")) {
    return "retirement";
  }
  if (s.includes("edu") || s.includes("tuition") || s.includes("教育") || s.includes("교육")) {
    return "education";
  }
  if (s.includes("liquid") || s.includes("流動") || s.includes("유동")) {
    return "liquidity";
  }
  if ((FINANCIAL_GOAL_TYPES as readonly string[]).includes(s)) {
    return s as FinancialGoalType;
  }
  return "other";
}

function parseGoal(raw: unknown, index: number): FinancialGoal | null {
  const o = asRecord(raw);
  if (!o) return null;
  const amount =
    asNumber(o.amount_usd) ??
    asNumber(o.amountUsd) ??
    asNumber(o.amount);
  const months =
    asNumber(o.within_months) ??
    asNumber(o.withinMonths) ??
    asNumber(o.months);
  if (amount == null || amount <= 0 || months == null || months < 1) return null;
  const type = normalizeType(o.type ?? o.goal_type);
  const label =
    asString(o.label) ??
    asString(o.description) ??
    asString(o.name) ??
    `${type}-${index + 1}`;
  const priority = Math.min(5, Math.max(1, Math.round(asNumber(o.priority) ?? 3)));
  return {
    id: asString(o.id) ?? createGoalId(),
    type,
    label: label.slice(0, 80),
    amountUsd: Math.round(amount),
    withinMonths: Math.min(360, Math.max(1, Math.round(months))),
    priority,
  };
}

function parseAssumptions(raw: unknown): GoalAssumptions {
  const o = asRecord(raw) ?? {};
  let annualReturn =
    asNumber(o.annual_return) ??
    asNumber(o.annualReturn) ??
    asNumber(o.expected_return);
  // Accept percent points (5) or fraction (0.05)
  if (annualReturn != null && annualReturn > 1) annualReturn = annualReturn / 100;
  let contributionGrowth =
    asNumber(o.contribution_growth) ??
    asNumber(o.contributionGrowth);
  if (contributionGrowth != null && Math.abs(contributionGrowth) > 1) {
    contributionGrowth = contributionGrowth / 100;
  }
  let inflation = asNumber(o.inflation);
  if (inflation != null && inflation > 1) inflation = inflation / 100;

  return clampAssumptions({
    ...DEFAULT_GOAL_ASSUMPTIONS,
    annualReturn: annualReturn ?? DEFAULT_GOAL_ASSUMPTIONS.annualReturn,
    optimisticDelta:
      asNumber(o.optimistic_delta) ??
      asNumber(o.optimisticDelta) ??
      DEFAULT_GOAL_ASSUMPTIONS.optimisticDelta,
    conservativeDelta:
      asNumber(o.conservative_delta) ??
      asNumber(o.conservativeDelta) ??
      DEFAULT_GOAL_ASSUMPTIONS.conservativeDelta,
    annualContributionUsd:
      asNumber(o.annual_contribution_usd) ??
      asNumber(o.annualContributionUsd) ??
      asNumber(o.annual_savings) ??
      0,
    contributionGrowth:
      contributionGrowth ?? DEFAULT_GOAL_ASSUMPTIONS.contributionGrowth,
    inflation: inflation ?? 0,
  });
}

/** Parse model JSON (or fenced JSON) into goals + assumptions. */
export function parseGoalExtractFromModel(text: string): GoalExtractResult {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const slice =
    start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const root = JSON.parse(slice) as unknown;
  const rec = asRecord(root);
  if (!rec) throw new Error("Goal extract root is not an object");

  const goalsRaw = Array.isArray(rec.goals) ? rec.goals : [];
  const goals = goalsRaw
    .map((g, i) => parseGoal(g, i))
    .filter((g): g is FinancialGoal => g != null)
    .slice(0, 8);

  const questions = Array.isArray(rec.clarification_questions)
    ? rec.clarification_questions
        .map((q) => asString(q))
        .filter((q): q is string => Boolean(q))
        .slice(0, 5)
    : [];

  const confidence = Math.min(
    1,
    Math.max(0, asNumber(rec.confidence) ?? (goals.length ? 0.6 : 0.3)),
  );

  return {
    goals,
    assumptions: parseAssumptions(rec.assumptions),
    clarification_questions: questions,
    confidence,
    rationale:
      asString(rec.rationale) ??
      (goals.length
        ? "Extracted goals and planning assumptions from RM notes."
        : "No structured goals found; please fill the form."),
  };
}

/** Heuristic fallback when AI is unavailable. */
export function extractGoalsRulesFallback(
  notes: string,
  lang: "en" | "zh" | "ko",
): GoalExtractResult {
  const text = notes.trim();
  const goals: FinancialGoal[] = [];
  const amountMatch = text.match(
    /(?:USD|US\$|\$)\s*([\d,.]+)\s*(?:m|million|萬|만)?/i,
  );
  let amount = amountMatch ? Number(amountMatch[1].replace(/,/g, "")) : null;
  if (amount != null && /million|\bm\b|萬|만/i.test(amountMatch?.[0] ?? "")) {
    if (amount < 1000) amount *= 1_000_000;
  }
  const monthMatch = text.match(
    /(\d+)\s*(?:months?|個月|个月|개월)|(?:within|內|내)\s*(\d+)\s*(?:years?|年|년)/i,
  );
  let months = 12;
  if (monthMatch?.[1]) months = Number(monthMatch[1]);
  else if (monthMatch?.[2]) months = Number(monthMatch[2]) * 12;

  const type = normalizeType(text);
  if (amount && amount > 0) {
    goals.push({
      id: createGoalId(),
      type,
      label:
        lang === "zh"
          ? "從筆記辨識的目標"
          : lang === "ko"
            ? "노트에서 인식한 목표"
            : "Goal from notes",
      amountUsd: Math.round(amount),
      withinMonths: Math.min(360, Math.max(1, months)),
      priority: 4,
    });
  }

  const returnMatch = text.match(
    /(?:return|報酬|收益|수익률)\s*(?:of|約|약|=|:)?\s*(\d+(?:\.\d+)?)\s*%/i,
  );
  const contribMatch = text.match(
    /(?:contribute|contribution|年投|每年|연간)\s*(?:USD|US\$|\$)?\s*([\d,.]+)/i,
  );

  const assumptions = clampAssumptions({
    ...DEFAULT_GOAL_ASSUMPTIONS,
    annualReturn: returnMatch
      ? Number(returnMatch[1]) / 100
      : DEFAULT_GOAL_ASSUMPTIONS.annualReturn,
    annualContributionUsd: contribMatch
      ? Number(contribMatch[1].replace(/,/g, ""))
      : 0,
  });

  const clarification_questions: string[] = [];
  if (!goals.length) {
    clarification_questions.push(
      lang === "zh"
        ? "請補充至少一筆目標金額與時間（例如：12 個月內購屋 USD 150 萬）。"
        : lang === "ko"
          ? "목표 금액과 시점을 최소 하나 적어 주세요 (예: 12개월 내 주택 USD 150만)."
          : "Add at least one goal amount and timing (e.g. home USD 1.5M within 12 months).",
    );
  }
  if (!returnMatch) {
    clarification_questions.push(
      lang === "zh"
        ? "預期投資報酬率假設是多少（例如 5%）？"
        : lang === "ko"
          ? "기대 수익률 가정은 얼마인가요 (예: 5%)?"
          : "What expected return assumption should we use (e.g. 5%)?",
    );
  }

  return {
    goals,
    assumptions,
    clarification_questions: clarification_questions.slice(0, 5),
    confidence: goals.length ? 0.45 : 0.25,
    rationale:
      lang === "zh"
        ? "AI 未設定時以規則從筆記粗抽目標／假設，請在表單上確認。"
        : lang === "ko"
          ? "AI 미설정 시 규칙으로 노트에서 목표·가정을 추출했습니다. 폼에서 확인하세요."
          : "Rules fallback extracted goals/assumptions from notes — confirm in the form.",
  };
}

import {
  clampAssumptions,
  createGoalId,
  DEFAULT_GOAL_ASSUMPTIONS,
  FINANCIAL_GOAL_TYPES,
  retirementSpendYearsFromLongevity,
  type ClientGender,
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
  const goal: FinancialGoal = {
    id: asString(o.id) ?? createGoalId(),
    type,
    label: label.slice(0, 80),
    amountUsd: Math.round(amount),
    withinMonths: Math.min(360, Math.max(1, Math.round(months))),
    priority,
  };

  if (type === "home") {
    const mortRaw = asRecord(o.mortgage) ?? o;
    let rate =
      asNumber(mortRaw.annual_rate) ??
      asNumber(mortRaw.annualRate) ??
      asNumber(mortRaw.mortgage_rate) ??
      asNumber(o.mortgage_rate);
    if (rate != null && rate > 1) rate = rate / 100;
    const loan =
      asNumber(mortRaw.loan_usd) ??
      asNumber(mortRaw.loanUsd) ??
      asNumber(o.mortgage_loan_usd) ??
      asNumber(o.loan_usd);
    const termYears =
      asNumber(mortRaw.term_years) ??
      asNumber(mortRaw.termYears) ??
      asNumber(o.mortgage_years);
    const termMonths =
      asNumber(mortRaw.term_months) ??
      asNumber(mortRaw.termMonths) ??
      (termYears != null ? termYears * 12 : null);
    if (loan != null && loan > 0) {
      goal.mortgage = {
        loanUsd: Math.round(loan),
        annualRate: rate ?? 0.03,
        termMonths: termMonths ?? 360,
      };
    }
  }

  if (type === "retirement") {
    const spendYears =
      asNumber(o.retirement_spend_years) ??
      asNumber(o.retirementSpendYears) ??
      asNumber(o.spend_years);
    if (spendYears != null) {
      goal.retirementSpendYears = Math.min(
        40,
        Math.max(1, Math.round(spendYears)),
      );
    } else {
      goal.retirementSpendYears = 20;
    }
  }

  return goal;
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
    annualLivingSpendUsd:
      asNumber(o.annual_living_spend_usd) ??
      asNumber(o.annualLivingSpendUsd) ??
      asNumber(o.annual_living_expenses) ??
      asNumber(o.current_living_spend_usd) ??
      0,
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

/** Parse target retirement age from notes (e.g. "retire at 60", "60歲退休"). */
export function parseTargetRetirementAge(notes: string): number | null {
  const patterns = [
    /(\d{2})\s*(?:歲|세)\s*(?:以後|以后|之後|之后|後|后|이후)?\s*(?:退休|은퇴)/i,
    /(?:retire|retirement)\s*(?:at|after)?\s*(?:age\s*)?(\d{2})/i,
    /(?:after|過了|满)\s*(?:age\s*)?(\d{2})\s*(?:歲|세)?[^\n]{0,12}(?:retire|退休|은퇴)/i,
    /(?:retire|retirement|退休|은퇴)[^\d]{0,24}(?:at|after|到|至|後|후)?\s*(?:age\s*)?(\d{2})/i,
  ];
  for (const re of patterns) {
    const m = notes.match(re);
    if (!m?.[1]) continue;
    const age = Number(m[1]);
    if (age >= 40 && age <= 85) return age;
  }
  return null;
}

export function monthsUntilAge(
  currentAge: number,
  targetAge: number,
): number | null {
  if (!(currentAge > 0) || !(targetAge > currentAge)) return null;
  return Math.min(360, Math.max(1, Math.round((targetAge - currentAge) * 12)));
}

export type GoalExtractClientContext = {
  age?: number | null;
  gender?: ClientGender | null;
  aum_usd?: number | null;
  /** Optional name blob (en/zh) to infer Mr/Ms when gender missing. */
  display_name?: string | null;
};

/** Infer male/female from notes or honorifics in the client name. */
export function parseClientGender(
  notes: string,
  displayName?: string | null,
): ClientGender | null {
  const blob = `${notes}\n${displayName ?? ""}`;
  if (
    /(?:\bMs\.|\bMrs\.|\bMiss\b|女士|小姐|女性|\bfemale\b|\bwoman\b)/i.test(blob)
  ) {
    return "female";
  }
  if (/(?:\bMr\.|先生|男性|\bmale\b|\bman\b)/i.test(blob)) {
    return "male";
  }
  return null;
}

/**
 * Fill retirement within_months from client age + notes ("retire at 60"),
 * set retirementSpendYears from life expectancy − retirement age,
 * and drop redundant age-clarification questions when age is known.
 */
export function enrichGoalExtractWithClientContext(
  extract: GoalExtractResult,
  notes: string,
  client?: GoalExtractClientContext | null,
  lang: "en" | "zh" | "ko" = "en",
): GoalExtractResult {
  const age =
    typeof client?.age === "number" && Number.isFinite(client.age)
      ? client.age
      : null;
  const gender =
    client?.gender === "male" || client?.gender === "female"
      ? client.gender
      : parseClientGender(notes, client?.display_name);
  const targetRetire = parseTargetRetirementAge(notes) ?? 60;
  const months =
    age != null ? monthsUntilAge(age, targetRetire) : null;
  const spendYears = retirementSpendYearsFromLongevity(targetRetire, gender);
  const le =
    gender === "male" ? 78 : gender === "female" ? 85 : 82;

  let goals = extract.goals;
  let appliedRetirementTiming = false;
  let appliedLongevitySpend = false;
  goals = extract.goals.map((g) => {
    if (g.type !== "retirement") return g;
    const next = { ...g, retirementSpendYears: spendYears };
    appliedLongevitySpend = true;
    if (months != null) {
      appliedRetirementTiming = true;
      next.withinMonths = months;
    }
    return next;
  });

  const questions = extract.clarification_questions.filter((q) => {
    if (age == null) return true;
    return !/(目前|當前|当前|實際年齡|实际年龄|current age|how many months.*retir|距離.*退休|거리.*은퇴|나이)/i.test(
      q,
    );
  }).filter((q) => {
    // Longevity already sets spend years — drop "how many years of expenses" prompts.
    if (!appliedLongevitySpend) return true;
    return !/(多少年|幾年|几年|how many years|spend years|생활비.*년|維持)/i.test(q);
  });

  let rationale = extract.rationale;
  if (appliedRetirementTiming && age != null) {
    const note =
      lang === "zh"
        ? `退休時點已用客戶年齡 ${age} 歲與目標 ${targetRetire} 歲推算為 ${months} 個月。`
        : lang === "ko"
          ? `은퇴 시점은 고객 연령 ${age}세와 목표 ${targetRetire}세로 ${months}개월로 계산했습니다.`
          : `Retirement timing set to ${months} months from client age ${age} → target ${targetRetire}.`;
    rationale = `${rationale} ${note}`.trim();
  }
  if (appliedLongevitySpend) {
    const genderLabel =
      gender === "male"
        ? lang === "zh"
          ? "男性"
          : lang === "ko"
            ? "남성"
            : "male"
        : gender === "female"
          ? lang === "zh"
            ? "女性"
            : lang === "ko"
              ? "여성"
              : "female"
          : lang === "zh"
            ? "未分性別"
            : lang === "ko"
              ? "성별 미상"
              : "unisex";
    const note =
      lang === "zh"
        ? `退休提領年數以規劃用平均壽命 ${le} 歲（${genderLabel}）− 退休年齡 ${targetRetire} 歲 = ${spendYears} 年。`
        : lang === "ko"
          ? `은퇴 인출 연수는 계획용 평균 수명 ${le}세(${genderLabel}) − 은퇴 연령 ${targetRetire}세 = ${spendYears}년입니다.`
          : `Retirement spend years set to life expectancy ${le} (${genderLabel}) − retire age ${targetRetire} = ${spendYears} years.`;
    rationale = `${rationale} ${note}`.trim();
  }
  const hasRetirement = goals.some((g) => g.type === "retirement");
  const contrib = extract.assumptions?.annualContributionUsd ?? 0;
  if (hasRetirement && contrib > 0) {
    const note =
      lang === "zh"
        ? `每年投入僅計算至退休開始前；退休後不再固定加碼投入。`
        : lang === "ko"
          ? `연간 추가는 은퇴 시작 전까지만 반영하며, 은퇴 후에는 고정 적립하지 않습니다.`
          : `Annual contributions apply only until retirement starts; no fixed contributions afterward.`;
    rationale = `${rationale} ${note}`.trim();
  }

  let assumptions = extract.assumptions;
  const retirementSpend = goals.find(
    (g) => g.type === "retirement" && g.amountUsd > 0,
  )?.amountUsd;
  let appliedLivingFromRetirement = false;
  if (
    (assumptions.annualLivingSpendUsd ?? 0) <= 0 &&
    retirementSpend != null &&
    retirementSpend > 0
  ) {
    assumptions = {
      ...assumptions,
      annualLivingSpendUsd: retirementSpend,
    };
    appliedLivingFromRetirement = true;
  }
  if (assumptions.annualLivingSpendUsd > 0) {
    const note = appliedLivingFromRetirement
      ? lang === "zh"
        ? `目前年生活開銷未另述，暫與退休年開銷相同（USD ${Math.round(assumptions.annualLivingSpendUsd).toLocaleString()}），工作期間自資產月提領，退休後改由退休目標提領。`
        : lang === "ko"
          ? `현재 생활비가 별도로 없으면 은퇴 연간 생활비와 동일(USD ${Math.round(assumptions.annualLivingSpendUsd).toLocaleString()})로 가정하며, 은퇴 전 자산에서 월 인출합니다.`
          : `Current living spend not stated separately — defaulted to retirement annual spend (USD ${Math.round(assumptions.annualLivingSpendUsd).toLocaleString()}), drawn monthly from wealth until retirement.`
      : lang === "zh"
        ? `目前年生活開銷 USD ${Math.round(assumptions.annualLivingSpendUsd).toLocaleString()} 於退休前自資產月提領。`
        : lang === "ko"
          ? `현재 연간 생활비 USD ${Math.round(assumptions.annualLivingSpendUsd).toLocaleString()}는 은퇴 전 자산에서 월 인출됩니다.`
          : `Current annual living spend USD ${Math.round(assumptions.annualLivingSpendUsd).toLocaleString()} is drawn monthly from wealth until retirement.`;
    rationale = `${rationale} ${note}`.trim();
  }

  return {
    ...extract,
    goals,
    assumptions,
    clarification_questions: questions.slice(0, 5),
    rationale,
  };
}

/** Heuristic fallback when AI is unavailable. */
export function extractGoalsRulesFallback(
  notes: string,
  lang: "en" | "zh" | "ko",
  client?: GoalExtractClientContext | null,
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
    const retireAge = parseTargetRetirementAge(text);
    const age =
      typeof client?.age === "number" && Number.isFinite(client.age)
        ? client.age
        : null;
    const retireMonths =
      type === "retirement" && age != null && retireAge != null
        ? monthsUntilAge(age, retireAge)
        : null;
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
      withinMonths: Math.min(
        360,
        Math.max(1, retireMonths ?? months),
      ),
      priority: 4,
    });
  }

  // Explicit retirement from living expenses + age even if amount parser missed.
  if (
    !goals.some((g) => g.type === "retirement") &&
    /retir|退休|은퇴/i.test(text)
  ) {
    const age =
      typeof client?.age === "number" && Number.isFinite(client.age)
        ? client.age
        : null;
    const target = parseTargetRetirementAge(text) ?? 60;
    const retireMonths = age != null ? monthsUntilAge(age, target) : null;
    const living = text.match(
      /(?:living|expenses|生活費|생활비)\s*(?:of|約|약|=|:)?\s*(?:USD|US\$|\$)?\s*([\d,.]+)/i,
    );
    const livingAmt = living ? Number(living[1].replace(/,/g, "")) : null;
    if (livingAmt && livingAmt > 0) {
      goals.push({
        id: createGoalId(),
        type: "retirement",
        label:
          lang === "zh" ? "退休生活" : lang === "ko" ? "은퇴 생활" : "Retirement",
        amountUsd: Math.round(livingAmt),
        withinMonths: Math.min(360, Math.max(1, retireMonths ?? 120)),
        priority: 3,
        retirementSpendYears: 20,
      });
    }
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

  return enrichGoalExtractWithClientContext(
    {
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
    },
    notes,
    client,
    lang,
  );
}

/* -------------------------------------------------------------------------- */
/* Soft-merge extract → form (Option B)                                         */
/* -------------------------------------------------------------------------- */

export type GoalExtractSnapshot = {
  goals: FinancialGoal[];
  assumptions: GoalAssumptions;
};

export type GoalExtractMergeSummary = {
  updatedFields: number;
  addedGoals: number;
  keptManualEdits: number;
};

export type GoalExtractMergeResult = {
  goals: FinancialGoal[];
  assumptions: GoalAssumptions;
  summary: GoalExtractMergeSummary;
  /** Remapped last-applied extract for the next dirty check. */
  baseline: GoalExtractSnapshot;
};

/** Return fields auto-fill may manage until the RM edits them. */
export type GoalReturnField =
  | "annualReturn"
  | "optimisticDelta"
  | "conservativeDelta";

export type MergeGoalExtractOptions = {
  /** Fields the RM (or prior deliberate input) has set — kept when no baseline. */
  returnTouched?: ReadonlySet<GoalReturnField>;
};

const ASSUMPTION_KEYS: readonly (keyof GoalAssumptions)[] = [
  "annualReturn",
  "optimisticDelta",
  "conservativeDelta",
  "annualContributionUsd",
  "contributionGrowth",
  "annualLivingSpendUsd",
  "inflation",
] as const;

const RETURN_FIELD_SET = new Set<string>([
  "annualReturn",
  "optimisticDelta",
  "conservativeDelta",
]);

function approxEq(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

function normalizeLabel(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Dice coefficient on bigrams; 1 = identical, 0 = no overlap. */
function labelSimilarity(a: string, b: string): number {
  const x = normalizeLabel(a);
  const y = normalizeLabel(b);
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.85;
  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const bx = bigrams(x);
  const by = bigrams(y);
  if (bx.size === 0 || by.size === 0) {
    return x[0] === y[0] ? 0.2 : 0;
  }
  let overlap = 0;
  for (const [g, cx] of bx) {
    const cy = by.get(g);
    if (cy) overlap += Math.min(cx, cy);
  }
  return (2 * overlap) / (x.length - 1 + (y.length - 1));
}

function mortgageEqual(
  a: FinancialGoal["mortgage"],
  b: FinancialGoal["mortgage"],
): boolean {
  const am = a && a.loanUsd > 0 ? a : null;
  const bm = b && b.loanUsd > 0 ? b : null;
  if (!am && !bm) return true;
  if (!am || !bm) return false;
  return (
    am.loanUsd === bm.loanUsd &&
    approxEq(am.annualRate, bm.annualRate) &&
    am.termMonths === bm.termMonths
  );
}

function goalFieldEqual(
  key: keyof FinancialGoal,
  cur: FinancialGoal,
  base: FinancialGoal,
): boolean {
  if (key === "mortgage") return mortgageEqual(cur.mortgage, base.mortgage);
  if (key === "retirementSpendYears") {
    const c = cur.retirementSpendYears ?? null;
    const b = base.retirementSpendYears ?? null;
    if (c == null && b == null) return true;
    if (c == null || b == null) return false;
    return c === b;
  }
  if (key === "label") {
    return normalizeLabel(cur.label) === normalizeLabel(base.label);
  }
  if (key === "amountUsd" || key === "withinMonths" || key === "priority") {
    return cur[key] === base[key];
  }
  if (key === "type") return cur.type === base.type;
  if (key === "id") return cur.id === base.id;
  return cur[key] === base[key];
}

function isEmptyGoalField(key: keyof FinancialGoal, g: FinancialGoal): boolean {
  if (key === "amountUsd") return !(g.amountUsd > 0);
  if (key === "label") return !g.label.trim();
  if (key === "mortgage") {
    if (g.type !== "home") return false;
    return !(g.mortgage && g.mortgage.loanUsd > 0);
  }
  if (key === "retirementSpendYears") {
    if (g.type !== "retirement") return false;
    return g.retirementSpendYears == null;
  }
  return false;
}

function isEmptyAssumptionField(
  key: keyof GoalAssumptions,
  a: GoalAssumptions,
): boolean {
  if (key === "annualContributionUsd") return !(a.annualContributionUsd > 0);
  if (key === "annualLivingSpendUsd") return !(a.annualLivingSpendUsd > 0);
  return false;
}

function cloneGoal(g: FinancialGoal): FinancialGoal {
  return {
    ...g,
    mortgage: g.mortgage ? { ...g.mortgage } : g.mortgage,
  };
}

function cloneAssumptions(a: GoalAssumptions): GoalAssumptions {
  return { ...a };
}

type GoalMatch = { currentIdx: number; incomingIdx: number; score: number };

/**
 * Greedy 1:1 match: same type required, then closest withinMonths, then label
 * similarity. Unmatched incoming / current stay unmatched.
 */
function matchGoalsGreedy(
  current: FinancialGoal[],
  incoming: FinancialGoal[],
): { matches: GoalMatch[]; unmatchedCurrent: number[]; unmatchedIncoming: number[] } {
  const usedCurrent = new Set<number>();
  const usedIncoming = new Set<number>();
  const candidates: GoalMatch[] = [];

  for (let ci = 0; ci < current.length; ci++) {
    for (let ii = 0; ii < incoming.length; ii++) {
      const c = current[ci];
      const inc = incoming[ii];
      if (c.type !== inc.type) continue;
      const monthDist = Math.abs(c.withinMonths - inc.withinMonths);
      const sim = labelSimilarity(c.label, inc.label);
      // Prefer closer months, then higher label similarity.
      const score = 1_000_000 - monthDist * 1000 + sim * 100;
      candidates.push({ currentIdx: ci, incomingIdx: ii, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const matches: GoalMatch[] = [];
  for (const m of candidates) {
    if (usedCurrent.has(m.currentIdx) || usedIncoming.has(m.incomingIdx)) {
      continue;
    }
    usedCurrent.add(m.currentIdx);
    usedIncoming.add(m.incomingIdx);
    matches.push(m);
  }

  const unmatchedCurrent: number[] = [];
  const unmatchedIncoming: number[] = [];
  for (let i = 0; i < current.length; i++) {
    if (!usedCurrent.has(i)) unmatchedCurrent.push(i);
  }
  for (let i = 0; i < incoming.length; i++) {
    if (!usedIncoming.has(i)) unmatchedIncoming.push(i);
  }
  return { matches, unmatchedCurrent, unmatchedIncoming };
}

const GOAL_MERGE_FIELDS: readonly (keyof FinancialGoal)[] = [
  "type",
  "label",
  "amountUsd",
  "withinMonths",
  "priority",
  "mortgage",
  "retirementSpendYears",
];

function mergeMatchedGoal(
  current: FinancialGoal,
  incoming: FinancialGoal,
  baselineGoal: FinancialGoal | null,
  summary: GoalExtractMergeSummary,
): { goal: FinancialGoal; baseline: FinancialGoal } {
  const next: FinancialGoal = { ...current };
  const baseOut: FinancialGoal = {
    ...cloneGoal(incoming),
    id: current.id,
  };

  for (const key of GOAL_MERGE_FIELDS) {
    if (key === "mortgage" && incoming.type !== "home" && current.type !== "home") {
      continue;
    }
    if (
      key === "retirementSpendYears" &&
      incoming.type !== "retirement" &&
      current.type !== "retirement"
    ) {
      continue;
    }

    const empty = isEmptyGoalField(key, current);
    const hasIncoming =
      key === "mortgage"
        ? Boolean(incoming.mortgage && incoming.mortgage.loanUsd > 0)
        : key === "retirementSpendYears"
          ? incoming.retirementSpendYears != null
          : key === "label"
            ? Boolean(incoming.label.trim())
            : key === "amountUsd"
              ? incoming.amountUsd > 0
              : true;

    let dirty = false;
    if (baselineGoal) {
      dirty = !goalFieldEqual(key, current, baselineGoal);
    } else {
      // No baseline: non-empty form values are treated as manual.
      dirty = !empty;
    }

    const shouldTake = (empty && hasIncoming) || !dirty;
    if (shouldTake) {
      const prev = cloneGoal(next);
      if (key === "mortgage") {
        next.mortgage = incoming.mortgage ? { ...incoming.mortgage } : null;
      } else if (key === "retirementSpendYears") {
        next.retirementSpendYears = incoming.retirementSpendYears ?? null;
      } else if (key === "label") {
        next.label = incoming.label;
      } else if (key === "amountUsd") {
        next.amountUsd = incoming.amountUsd;
      } else if (key === "type") {
        next.type = incoming.type;
      } else if (key === "withinMonths") {
        next.withinMonths = incoming.withinMonths;
      } else if (key === "priority") {
        next.priority = incoming.priority;
      }
      if (!goalFieldEqual(key, prev, next)) {
        summary.updatedFields += 1;
      }
    } else {
      summary.keptManualEdits += 1;
    }
  }

  // Drop irrelevant nested fields when type changed to/from home/retirement.
  if (next.type !== "home") next.mortgage = null;
  if (next.type !== "retirement") next.retirementSpendYears = null;

  return { goal: next, baseline: baseOut };
}

function mergeAssumptionsSoft(
  current: GoalAssumptions,
  incoming: GoalAssumptions,
  baseline: GoalAssumptions | null,
  returnTouched: ReadonlySet<GoalReturnField> | undefined,
  summary: GoalExtractMergeSummary,
): GoalAssumptions {
  const next = cloneAssumptions(current);

  for (const key of ASSUMPTION_KEYS) {
    const empty = isEmptyAssumptionField(key, current);
    const isReturn = RETURN_FIELD_SET.has(key);
    let dirty = false;
    if (baseline) {
      const cv = current[key];
      const bv = baseline[key];
      dirty =
        typeof cv === "number" && typeof bv === "number"
          ? !approxEq(cv, bv)
          : cv !== bv;
    } else if (isReturn) {
      dirty = Boolean(
        returnTouched?.has(key as GoalReturnField),
      );
    } else {
      dirty = !empty;
    }

    if (empty && incoming[key] !== current[key] && (incoming[key] as number) > 0) {
      (next as GoalAssumptions)[key] = incoming[key];
      summary.updatedFields += 1;
    } else if (!dirty) {
      if (
        typeof current[key] === "number" &&
        typeof incoming[key] === "number" &&
        !approxEq(current[key] as number, incoming[key] as number)
      ) {
        (next as GoalAssumptions)[key] = incoming[key];
        summary.updatedFields += 1;
      } else if (current[key] !== incoming[key]) {
        (next as GoalAssumptions)[key] = incoming[key];
        summary.updatedFields += 1;
      } else {
        (next as GoalAssumptions)[key] = incoming[key];
      }
    } else {
      summary.keptManualEdits += 1;
    }
  }

  return clampAssumptions(next);
}

/**
 * Soft-merge an AI extract into the current form.
 *
 * - Empty goals table → full fill (like a first extract).
 * - Soft merge never deletes form-only goals; empty incoming goals do not clear.
 * - Dirty fields (current ≠ baseline) are kept; empty/zero fillable fields take extract.
 * - Unmatched extract goals are appended with new ids.
 */
export function mergeGoalExtract(
  current: GoalExtractSnapshot,
  incoming: GoalExtractSnapshot,
  baseline: GoalExtractSnapshot | null,
  options?: MergeGoalExtractOptions,
): GoalExtractMergeResult {
  const summary: GoalExtractMergeSummary = {
    updatedFields: 0,
    addedGoals: 0,
    keptManualEdits: 0,
  };

  // First extract / empty goals table: full fill.
  if (current.goals.length === 0) {
    const goals = incoming.goals.map((g) => cloneGoal(g));
    const assumptions = clampAssumptions(cloneAssumptions(incoming.assumptions));
    summary.addedGoals = goals.length;
    for (const key of ASSUMPTION_KEYS) {
      if (current.assumptions[key] !== assumptions[key]) {
        summary.updatedFields += 1;
      }
    }
    return {
      goals,
      assumptions,
      summary,
      baseline: {
        goals: goals.map(cloneGoal),
        assumptions: cloneAssumptions(assumptions),
      },
    };
  }

  const baselineById = new Map(
    (baseline?.goals ?? []).map((g) => [g.id, g] as const),
  );

  // Soft merge with empty extract goals → do not clear the table.
  const { matches, unmatchedCurrent, unmatchedIncoming } =
    incoming.goals.length === 0
      ? {
          matches: [] as GoalMatch[],
          unmatchedCurrent: current.goals.map((_, i) => i),
          unmatchedIncoming: [] as number[],
        }
      : matchGoalsGreedy(current.goals, incoming.goals);

  const mergedGoals: FinancialGoal[] = new Array(current.goals.length);
  const baselineGoals: FinancialGoal[] = [];

  for (const m of matches) {
    const cur = current.goals[m.currentIdx];
    const inc = incoming.goals[m.incomingIdx];
    const baseGoal = baselineById.get(cur.id) ?? null;
    const { goal, baseline: b } = mergeMatchedGoal(cur, inc, baseGoal, summary);
    mergedGoals[m.currentIdx] = goal;
    baselineGoals.push(b);
  }

  for (const ci of unmatchedCurrent) {
    // Form-only goals → keep.
    mergedGoals[ci] = cloneGoal(current.goals[ci]);
    const prev = baselineById.get(current.goals[ci].id);
    if (prev) baselineGoals.push(cloneGoal(prev));
  }

  const appended: FinancialGoal[] = [];
  for (const ii of unmatchedIncoming) {
    const g = cloneGoal(incoming.goals[ii]);
    g.id = createGoalId();
    appended.push(g);
    baselineGoals.push(cloneGoal(g));
    summary.addedGoals += 1;
  }

  const goals = [
    ...mergedGoals.filter((g): g is FinancialGoal => g != null),
    ...appended,
  ];

  const assumptions = mergeAssumptionsSoft(
    current.assumptions,
    incoming.assumptions,
    baseline?.assumptions ?? null,
    options?.returnTouched,
    summary,
  );

  return {
    goals,
    assumptions,
    summary,
    baseline: {
      goals: baselineGoals,
      assumptions: cloneAssumptions(incoming.assumptions),
    },
  };
}

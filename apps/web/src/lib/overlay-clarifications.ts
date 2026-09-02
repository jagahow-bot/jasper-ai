import type {
  ClientOverlay,
  OverlayClarification,
  OverlayClarificationOption,
  OverlayExtractOutput,
} from "./overlay-schema";

export type ClarificationDraft = {
  selectedOptionIds: string[];
  freeText: string;
  otherOpen: boolean;
};

export type ClarificationSnapshot = {
  id: string;
  items: { question: string; answer: string }[];
};

export function emptyClarificationDraft(): ClarificationDraft {
  return { selectedOptionIds: [], freeText: "", otherOpen: false };
}

export function joinClarificationLabels(
  labels: string[],
  lang: "zh" | "en" | "ko",
): string {
  const sep = lang === "zh" ? "、" : ", ";
  return labels.filter(Boolean).join(sep);
}

export function buildClarificationAnswer(
  clarification: OverlayClarification,
  draft: ClarificationDraft,
  lang: "zh" | "en" | "ko",
): string {
  const selected = new Set(draft.selectedOptionIds);
  const labels = clarification.options
    .filter((o) => selected.has(o.id))
    .map((o) => o.label);
  const parts = [...labels];
  const free = draft.freeText.trim();
  if (free) parts.push(free);
  return joinClarificationLabels(parts, lang);
}

export function clarificationAllowsMultiple(
  clarification: OverlayClarification,
): boolean {
  return clarification.allow_multiple === true;
}

function slugId(label: string, index: number): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  return base ? `${base}-${index}` : `opt-${index}`;
}

export function normalizeClarificationOptions(
  options: OverlayClarificationOption[] | undefined,
): OverlayClarificationOption[] {
  if (!options?.length) return [];
  const seen = new Set<string>();
  return options
    .map((o, i) => ({
      id: String(o.id || slugId(o.label, i)),
      label: String(o.label || "").trim(),
    }))
    .filter((o) => {
      if (!o.label) return false;
      const key = o.id.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function clarificationFromQuestion(
  question: string,
  index: number,
  lang: "zh" | "en" | "ko",
  options?: OverlayClarificationOption[],
  flags?: Pick<OverlayClarification, "allow_free_text" | "allow_multiple">,
): OverlayClarification {
  const normalizedOptions = normalizeClarificationOptions(options);
  return {
    id: `q-${index + 1}`,
    question,
    options:
      normalizedOptions.length > 0
        ? normalizedOptions
        : normalizeClarificationOptions(inferClarificationOptions(question, lang)),
    allow_free_text: flags?.allow_free_text !== false,
    allow_multiple: flags?.allow_multiple === true,
  };
}

/** Preserve LLM structured clarifications; infer options only when absent. */
export function finalizeStructuredClarification(
  clarification: OverlayClarification,
  index: number,
  lang: "zh" | "en" | "ko",
): OverlayClarification {
  const normalizedOptions = normalizeClarificationOptions(clarification.options);
  return {
    id: clarification.id || `q-${index + 1}`,
    question: clarification.question,
    options:
      normalizedOptions.length > 0
        ? normalizedOptions
        : normalizeClarificationOptions(
            inferClarificationOptions(clarification.question, lang),
          ),
    allow_free_text: clarification.allow_free_text !== false,
    allow_multiple: clarification.allow_multiple === true,
  };
}

/** Prefer structured clarifications; fall back to plain question strings. */
export function resolveClarifications(
  overlay: Pick<
    ClientOverlay,
    "clarifications" | "clarification_questions"
  > | null | undefined,
  lang: "zh" | "en" | "ko" = "en",
): OverlayClarification[] {
  if (!overlay) return [];
  if (overlay.clarifications?.length) {
    return overlay.clarifications.map((c, i) =>
      finalizeStructuredClarification(c, i, lang),
    );
  }
  const questions = overlay.clarification_questions ?? [];
  return questions.map((q, i) => clarificationFromQuestion(q, i, lang));
}

export function syncExtractClarifications(
  extract: OverlayExtractOutput,
  lang: "zh" | "en" | "ko",
): OverlayExtractOutput {
  if (extract.clarifications?.length) {
    const clarifications = extract.clarifications.map((c, i) =>
      finalizeStructuredClarification(c, i, lang),
    );
    return {
      ...extract,
      clarifications,
      clarification_questions: clarifications.map((c) => c.question),
    };
  }
  const questions = extract.clarification_questions ?? [];
  if (!questions.length) {
    return { ...extract, clarifications: [], clarification_questions: [] };
  }
  const clarifications = questions.map((q, i) =>
    clarificationFromQuestion(q, i, lang),
  );
  return { ...extract, clarifications, clarification_questions: questions };
}

/** Rules fallback: keyword-matched preset option chips (trilingual). */
export function inferClarificationOptions(
  question: string,
  lang: "zh" | "en" | "ko",
): OverlayClarificationOption[] {
  const q = question.toLowerCase();

  const riskOpts: Record<typeof lang, OverlayClarificationOption[]> = {
    en: [
      { id: "conservative", label: "Conservative" },
      { id: "moderate", label: "Moderate" },
      { id: "aggressive", label: "Aggressive" },
      { id: "growth", label: "Full growth" },
    ],
    zh: [
      { id: "conservative", label: "保守" },
      { id: "moderate", label: "穩健" },
      { id: "aggressive", label: "積極" },
      { id: "growth", label: "全面成長" },
    ],
    ko: [
      { id: "conservative", label: "보수적" },
      { id: "moderate", label: "중립" },
      { id: "aggressive", label: "공격적" },
      { id: "growth", label: "성장 중심" },
    ],
  };

  const horizonOpts: Record<typeof lang, OverlayClarificationOption[]> = {
    en: [
      { id: "lt1y", label: "Within 1 year" },
      { id: "1-3y", label: "1–3 years" },
      { id: "3-5y", label: "3–5 years" },
      { id: "gt5y", label: "5+ years" },
    ],
    zh: [
      { id: "lt1y", label: "1 年內" },
      { id: "1-3y", label: "1–3 年" },
      { id: "3-5y", label: "3–5 年" },
      { id: "gt5y", label: "5 年以上" },
    ],
    ko: [
      { id: "lt1y", label: "1년 이내" },
      { id: "1-3y", label: "1–3년" },
      { id: "3-5y", label: "3–5년" },
      { id: "gt5y", label: "5년 이상" },
    ],
  };

  const liquidityOpts: Record<typeof lang, OverlayClarificationOption[]> = {
    en: [
      { id: "known-amt", label: "Known amount" },
      { id: "pct", label: "Proportional withdrawal" },
      { id: "none", label: "None for now" },
    ],
    zh: [
      { id: "known-amt", label: "已知金額" },
      { id: "pct", label: "比例提領" },
      { id: "none", label: "暫無" },
    ],
    ko: [
      { id: "known-amt", label: "확정 금액" },
      { id: "pct", label: "비율 인출" },
      { id: "none", label: "해당 없음" },
    ],
  };

  const techCapOpts: Record<typeof lang, OverlayClarificationOption[]> = {
    en: [
      { id: "10", label: "10%" },
      { id: "20", label: "20%" },
      { id: "30", label: "30%" },
      { id: "no-cap", label: "No cap" },
    ],
    zh: [
      { id: "10", label: "10%" },
      { id: "20", label: "20%" },
      { id: "30", label: "30%" },
      { id: "no-cap", label: "不設上限" },
    ],
    ko: [
      { id: "10", label: "10%" },
      { id: "20", label: "20%" },
      { id: "30", label: "30%" },
      { id: "no-cap", label: "상한 없음" },
    ],
  };

  const hyOpts: Record<typeof lang, OverlayClarificationOption[]> = {
    en: [
      { id: "exclude", label: "Exclude HY" },
      { id: "include", label: "Allow HY" },
      { id: "limit", label: "Limit to ≤10%" },
    ],
    zh: [
      { id: "exclude", label: "排除高收益債" },
      { id: "include", label: "可納入高收益債" },
      { id: "limit", label: "限制 ≤10%" },
    ],
    ko: [
      { id: "exclude", label: "하이일드 제외" },
      { id: "include", label: "하이일드 허용" },
      { id: "limit", label: "10% 이하" },
    ],
  };

  if (
    /risk|conservative|aggressive|moderate|風險|保守|積極|穩健|리스크|성향/.test(
      q + question,
    )
  ) {
    return riskOpts[lang];
  }
  if (
    /horizon|year|month|期限|期間|投資期|기간|년/.test(q + question)
  ) {
    return horizonOpts[lang];
  }
  if (
    /liquidity|withdraw|amount|usd|提領|流動|金額|현금|인출/.test(q + question)
  ) {
    return liquidityOpts[lang];
  }
  if (
    /tech|technology|sector|exposure|cap|科技|產業|曝險|上限|섹터|기술/.test(
      q + question,
    )
  ) {
    return techCapOpts[lang];
  }
  if (/high.?yield|hy|高收益|하이일드|junk/.test(q + question)) {
    return hyOpts[lang];
  }

  return [];
}

export function clarificationsHash(
  clarifications: OverlayClarification[],
): string {
  return clarifications
    .map((c) => `${c.id}\0${c.question}\0${c.options.map((o) => o.id).join(",")}`)
    .join("\n");
}

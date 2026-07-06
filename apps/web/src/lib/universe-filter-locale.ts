import type { Lang } from "./i18n";

export type { Lang };

export function parseReportLanguage(value: string | undefined | null): Lang {
  const lang = (value ?? "en").trim().toLowerCase();
  if (lang.startsWith("zh")) return "zh";
  if (lang.startsWith("ko")) return "ko";
  return "en";
}

/** Prompt directive so Gemini rationale matches the user's UI locale. */
export function rationaleLanguageDirective(lang: Lang): string {
  if (lang === "zh") {
    return (
      "Write the rationale in Traditional Chinese (繁體中文). " +
      "Keep ETF tickers and numbers as-is."
    );
  }
  if (lang === "ko") {
    return (
      "Write the rationale in Korean (한국어). " +
      "Keep ETF tickers and numbers as-is."
    );
  }
  return "Write the rationale in English.";
}

type FallbackRationaleParts = {
  matchingCount?: number;
  categories?: string[];
};

export function localizedFallbackRationale(
  lang: Lang,
  parts: FallbackRationaleParts,
): string {
  const segments: string[] = [];
  if (parts.matchingCount != null && parts.matchingCount > 0) {
    if (lang === "zh") {
      segments.push(`符合 ${parts.matchingCount} 檔 ETF`);
    } else if (lang === "ko") {
      segments.push(`일치 ETF ${parts.matchingCount}개`);
    } else {
      segments.push(`${parts.matchingCount} matching ETF(s)`);
    }
  }
  if (parts.categories?.length) {
    const shown = parts.categories.slice(0, 4);
    const suffix = parts.categories.length > 4 ? "…" : "";
    if (lang === "zh") {
      segments.push(`類別：${shown.join("、")}${suffix}`);
    } else if (lang === "ko") {
      segments.push(`카테고리: ${shown.join(", ")}${suffix}`);
    } else {
      segments.push(
        `Categories: ${shown.join(", ")}${suffix}`,
      );
    }
  }
  if (segments.length) return segments.join(" · ");

  if (lang === "zh") return "依規則在全宇宙 ETF 中比對後新增的補充標的。";
  if (lang === "ko") return "규칙 기반으로 전체 ETF 유니버스에서 일치하는 보충 종목입니다.";
  return "Supplement tickers from rule-based match in full universe.";
}

export function localizedMergeRationale(
  lang: Lang,
  ruleCount: number,
  etfCount: number,
): string {
  if (lang === "zh") {
    return `補充：${ruleCount} 條規則在全宇宙中共符合 ${etfCount} 檔 ETF（聯集）。`;
  }
  if (lang === "ko") {
    return `보충: ${ruleCount}개 규칙이 전체 유니버스에서 ${etfCount}개 ETF와 일치합니다(합집합).`;
  }
  return `Supplement: ${ruleCount} rules matched ${etfCount} ETF(s) in the full universe (union).`;
}

export function localizedNoRulesRationale(lang: Lang): string {
  if (lang === "zh") return "未套用 AI 補充規則。";
  if (lang === "ko") return "AI 보충 규칙이 적용되지 않았습니다.";
  return "No AI supplement rules applied.";
}

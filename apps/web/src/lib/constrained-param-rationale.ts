/** Deterministic RM copy for constrained-customization param rationale. */

export const CONSTRAINED_SCENARIO_STYLES = [
  "anchor_close",
  "full_drift",
  "defensive",
  "theme",
] as const;

export type ConstrainedScenarioStyle =
  (typeof CONSTRAINED_SCENARIO_STYLES)[number];

type Translate = (key: string, vars?: Record<string, string | number>) => string;

const TECHNICAL_RATIONALE_RE =
  /Constrained customization mode:\s*named optimizer scenarios/i;

export function isTechnicalConstrainedParamRationale(
  text: string | null | undefined,
): boolean {
  return TECHNICAL_RATIONALE_RE.test(String(text ?? "").trim());
}

export function normalizeConstrainedScenarioStyle(
  value: unknown,
): ConstrainedScenarioStyle | null {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  return (CONSTRAINED_SCENARIO_STYLES as readonly string[]).includes(raw)
    ? (raw as ConstrainedScenarioStyle)
    : null;
}

export function isConstrainedParamSetupContext(input: {
  constrainedCustomization?: unknown;
  engine?: unknown;
  optimizationMode?: unknown;
  aiModel?: unknown;
  paramSource?: unknown;
  scenarioStyle?: unknown;
  storedRationale?: string | null;
}): boolean {
  if (input.constrainedCustomization === true) return true;
  if (String(input.engine ?? "") === "constrained_scenarios") return true;
  if (String(input.optimizationMode ?? "") === "constrained_customization") {
    return true;
  }
  if (String(input.aiModel ?? "") === "constrained_scenarios") return true;
  if (String(input.paramSource ?? "") === "constrained_scenario") return true;
  if (normalizeConstrainedScenarioStyle(input.scenarioStyle)) return true;
  return isTechnicalConstrainedParamRationale(input.storedRationale);
}

function pctLabel(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  return `${(value * 100).toFixed(0)}%`;
}

function styleLabel(t: Translate, style: ConstrainedScenarioStyle): string {
  return t(`results.proposalLabel.${style}`);
}

function allocatorLabel(t: Translate, mode: string | null | undefined): string | null {
  const key = String(mode ?? "")
    .trim()
    .toLowerCase();
  if (!key) return null;
  const i18nKey = `allocator.${key}`;
  const labeled = t(i18nKey);
  return labeled === i18nKey ? key : labeled;
}

/**
 * Build localized 「參數為何這樣設定」 copy for constrained / named-scenario runs.
 * Prefer champion scenario_style + drift/allocator when present.
 */
export function buildConstrainedParamSetupRationale(input: {
  t: Translate;
  scenarioStyle?: unknown;
  styles?: unknown;
  driftActual?: number | null;
  driftCap?: number | null;
  allocatorMode?: string | null;
}): string {
  const t = input.t;
  const style = normalizeConstrainedScenarioStyle(input.scenarioStyle);
  const rawStyles = Array.isArray(input.styles)
    ? input.styles
        .map((s) => normalizeConstrainedScenarioStyle(s))
        .filter((s): s is ConstrainedScenarioStyle => Boolean(s))
    : [];
  const styles =
    rawStyles.length > 0
      ? rawStyles
      : ([...CONSTRAINED_SCENARIO_STYLES] as ConstrainedScenarioStyle[]);
  const stylesJoined = styles.map((s) => styleLabel(t, s)).join(" / ");

  const lead = t("results.championWhyParamsConstrainedLead", {
    styles: stylesJoined,
  });

  if (!style) return lead;

  const body = t(`results.championWhyParamsConstrained.${style}`, {
    styleLabel: styleLabel(t, style),
  });

  const drift = pctLabel(input.driftActual);
  const cap = pctLabel(input.driftCap);
  const allocator = allocatorLabel(t, input.allocatorMode);
  const metricsParts: string[] = [];
  if (drift && cap) {
    metricsParts.push(
      t("results.championWhyParamsConstrainedDriftBoth", { drift, cap }),
    );
  } else if (drift) {
    metricsParts.push(
      t("results.championWhyParamsConstrainedDriftOnly", { drift }),
    );
  } else if (cap) {
    metricsParts.push(
      t("results.championWhyParamsConstrainedCapOnly", { cap }),
    );
  }
  if (allocator) {
    metricsParts.push(
      t("results.championWhyParamsConstrainedAllocator", { allocator }),
    );
  }

  if (metricsParts.length === 0) return `${lead} ${body}`;
  const metrics = t("results.championWhyParamsConstrainedMetrics", {
    metrics: metricsParts.join(
      t("results.championWhyParamsConstrainedMetricsJoin"),
    ),
  });
  return `${lead} ${body} ${metrics}`;
}

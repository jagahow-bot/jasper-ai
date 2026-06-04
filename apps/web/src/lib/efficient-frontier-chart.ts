/** Efficient frontier scatter: param-search samples vs ranked output models. */

export type FrontierSamplePoint = {
  name?: string;
  model_code?: string | null;
  volatility: number;
  return: number;
  sharpe?: number;
  score?: number;
};

export type FrontierOutputPoint = {
  chartKey: string;
  name: string;
  model_code?: string | null;
  rank?: number;
  volatility: number;
  return: number;
  sharpe?: number;
  isSelected?: number;
  series?: "output";
};

export function frontierSampleModelKey(
  point: Pick<FrontierSamplePoint, "model_code" | "name">,
): string | null {
  const code =
    typeof point.model_code === "string" ? point.model_code.trim() : "";
  if (code) return code;
  const name = typeof point.name === "string" ? point.name.trim() : "";
  if (name && name !== "sample") return name;
  return null;
}

/** Drop search samples that duplicate a ranked output model (API also excludes). */
export function filterFrontierSamplesForDisplay(
  samples: FrontierSamplePoint[],
  outputModelCodes: Iterable<string | null | undefined>,
): FrontierSamplePoint[] {
  const exclude = new Set(
    [...outputModelCodes]
      .map((c) => (typeof c === "string" ? c.trim() : ""))
      .filter(Boolean),
  );
  if (!exclude.size) return samples;
  return samples.filter((p) => {
    const key = frontierSampleModelKey(p);
    return !key || !exclude.has(key);
  });
}

export function frontierTooltipLabel(
  payload: {
    model_code?: string | null;
    name?: string;
  } | undefined,
): string {
  const code =
    typeof payload?.model_code === "string" ? payload.model_code.trim() : "";
  if (code) return code;
  const name = typeof payload?.name === "string" ? payload.name.trim() : "";
  if (name && name !== "sample") return name;
  return "sample";
}

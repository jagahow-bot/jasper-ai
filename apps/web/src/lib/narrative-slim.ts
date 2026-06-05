/**
 * Strip chart/UI-only fields from narrative_facts before Gemini narrate calls.
 * Full facts remain in job results for the dashboard; only the LLM prompt is slimmed.
 */
export function slimNarrativeFacts(
  facts: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...facts };

  delete out.dynamic_objective_benchmark_series;
  delete out.weight_cap_audit;

  const pro = out.pro_refinement;
  if (pro && typeof pro === "object" && !Array.isArray(pro)) {
    const perRound = (pro as Record<string, unknown>).per_round;
    if (Array.isArray(perRound)) {
      out.pro_refinement = {
        ...(pro as Record<string, unknown>),
        per_round: perRound.map((row) => {
          if (!row || typeof row !== "object" || Array.isArray(row)) return row;
          const { pool_signatures: _ps, ...rest } = row as Record<string, unknown>;
          return rest;
        }),
      };
    }
  }

  return out;
}

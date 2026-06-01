import { z } from "zod";
import type { AssetClass } from "./constants";

export const scenarioAnalyzeSchema = z.object({
  title: z.string().min(2).max(40),
  subtitle: z.string().min(2).max(80),
  narrative_points: z.array(z.string()).min(2).max(5),
  defaults: z.object({
    max_weight: z.number().min(0.05).max(0.15),
    objective: z.enum(["max_sharpe", "min_max_drawdown"]),
    backtest_mode: z.literal("static"),
    start_date: z.string(),
    end_date: z.string(),
  }),
  suggested_asset_classes: z.array(
    z.enum(["equity", "bond", "commodity", "real_estate", "alternative"]),
  ),
});

export type ScenarioAnalyzeOutput = z.infer<typeof scenarioAnalyzeSchema>;

export function toScenarioCard(
  output: ScenarioAnalyzeOutput,
  customId: string,
): import("./types").ScenarioCard {
  return {
    id: customId,
    title: output.title,
    subtitle: output.subtitle,
    narrative_points: output.narrative_points,
    defaults: output.defaults,
    suggested_asset_classes: output.suggested_asset_classes as AssetClass[],
  };
}

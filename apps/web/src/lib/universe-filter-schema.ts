import { z } from "zod";
import { ASSET_CLASSES } from "./constants";

export const universeFilterSchema = z.object({
  asset_classes: z.array(z.enum(ASSET_CLASSES)).min(1),
  categories: z.array(z.string()).optional(),
  tickers: z.array(z.string()).optional(),
  rationale: z.string().min(8).max(400),
});

export type UniverseFilterOutput = z.infer<typeof universeFilterSchema>;

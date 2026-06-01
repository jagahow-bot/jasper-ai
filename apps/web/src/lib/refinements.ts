import type { BacktestRequest } from "@/lib/types";

export type QuickRefinement = {
  id: string;
  label: string;
  description: string;
  apply: (req: BacktestRequest) => BacktestRequest;
};

export const QUICK_REFINEMENTS: QuickRefinement[] = [
  {
    id: "bond-tilt",
    label: "Bond tilt",
    description: "Equity + bond focus, drawdown-aware objective",
    apply: (req) => ({
      ...req,
      asset_classes: ["equity", "bond"],
      objective: "min_max_drawdown",
    }),
  },
  {
    id: "dd-guard",
    label: "Drawdown guard",
    description: "Minimize max drawdown objective",
    apply: (req) => ({
      ...req,
      objective: "min_max_drawdown",
    }),
  },
  {
    id: "cap-2",
    label: "Cap −2%",
    description: "Tighter single-name concentration",
    apply: (req) => ({
      ...req,
      max_weight: Math.max(0.05, req.max_weight - 0.02),
    }),
  },
  {
    id: "sharpe",
    label: "Sharpe hunt",
    description: "Maximize Sharpe ratio",
    apply: (req) => ({
      ...req,
      objective: "max_sharpe",
    }),
  },
  {
    id: "defensive",
    label: "Defensive mix",
    description: "Bond, REIT, commodity, alternatives",
    apply: (req) => ({
      ...req,
      asset_classes: ["bond", "real_estate", "commodity", "alternative"],
    }),
  },
  {
    id: "equity-only",
    label: "Equity only",
    description: "Optimize within equity ETFs only",
    apply: (req) => ({
      ...req,
      asset_classes: ["equity"],
    }),
  },
];

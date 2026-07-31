import { describe, expect, it } from "vitest";
import {
  dedupeProposalSet,
  weightsSignature,
} from "@/lib/proposal-set";
import type { PortfolioCandidate, ProposalCard } from "@/lib/types";

const EQUAL_WEIGHTS = {
  AGG: 0.125,
  DODIX: 0.125,
  GLD: 0.125,
  IVV: 0.125,
  PG: 0.125,
  SHY: 0.125,
  TLT: 0.125,
  VWELX: 0.125,
};

const NEEDS = {
  within_drawdown_tolerance: false,
  within_single_name_cap: false,
  within_theme_cap: true,
  all_floors_met: false,
};

function card(
  code: string,
  opts: Partial<ProposalCard> & { is_recommended?: boolean } = {},
): ProposalCard {
  return {
    model_code: code,
    label: opts.label ?? (opts.is_recommended ? "recommended" : `alternative_${code}`),
    is_recommended: opts.is_recommended ?? false,
    sharpe: opts.sharpe ?? 0.422,
    cagr: opts.cagr ?? 0.07,
    max_drawdown: opts.max_drawdown ?? -0.181,
    objective_score: opts.objective_score ?? 0.202246,
    needs_attainment: opts.needs_attainment ?? NEEDS,
  };
}

function cand(code: string, weights = EQUAL_WEIGHTS): PortfolioCandidate {
  return {
    rank: 1,
    model_code: code,
    is_champion: code === "M0004",
    weights,
    sharpe: 0.422,
    max_drawdown: -0.181,
    cagr: 0.07,
    volatility: 0.1,
    needs_attainment: NEEDS,
  };
}

describe("weightsSignature", () => {
  it("rounds and sorts tickers", () => {
    expect(weightsSignature({ b: 0.50001, a: 0.49999 })).toBe("A:0.5000|B:0.5000");
    expect(weightsSignature({})).toBeNull();
  });
});

describe("dedupeProposalSet", () => {
  it("collapses job-style identical M0004/5/6 cards to recommended", () => {
    const proposals = [
      card("M0004", { is_recommended: true, label: "recommended" }),
      card("M0005", { label: "alternative_2" }),
      card("M0006", { label: "alternative_3" }),
    ];
    const out = dedupeProposalSet(proposals, [
      cand("M0004"),
      cand("M0005"),
      cand("M0006"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.model_code).toBe("M0004");
  });

  it("dedupes by metrics alone when candidates omitted", () => {
    const out = dedupeProposalSet([
      card("M0004", { is_recommended: true }),
      card("M0005"),
      card("M0006"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.model_code).toBe("M0004");
  });

  it("keeps true trade-offs", () => {
    const out = dedupeProposalSet(
      [
        card("REC", {
          is_recommended: true,
          label: "recommended",
          sharpe: 1.0,
          cagr: 0.1,
          max_drawdown: -0.15,
        }),
        card("DEF", {
          label: "defensive",
          sharpe: 0.6,
          cagr: 0.04,
          max_drawdown: -0.04,
        }),
        card("GRO", {
          label: "growth",
          sharpe: 1.4,
          cagr: 0.18,
          max_drawdown: -0.28,
        }),
      ],
      [
        cand("REC", { IVV: 0.7, TLT: 0.3 }),
        cand("DEF", { IVV: 0.2, TLT: 0.8 }),
        cand("GRO", { IVV: 0.95, TLT: 0.05 }),
      ],
    );
    expect(out.map((c) => c.model_code)).toEqual(["REC", "DEF", "GRO"]);
  });

  it("returns empty for null/empty", () => {
    expect(dedupeProposalSet(null)).toEqual([]);
    expect(dedupeProposalSet([])).toEqual([]);
  });
});

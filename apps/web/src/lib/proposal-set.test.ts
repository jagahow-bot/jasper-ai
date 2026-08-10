import { describe, expect, it } from "vitest";
import {
  alignPrimaryRecommendation,
  buildDisplayProposalSet,
  dedupeProposalSet,
  normalizeProposalLabel,
  resolvePrimaryRecommendationCode,
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

function cand(
  code: string,
  weights: Record<string, number> = EQUAL_WEIGHTS,
  extras: Partial<PortfolioCandidate> = {},
): PortfolioCandidate {
  return {
    rank: extras.rank ?? 1,
    model_code: code,
    is_champion: extras.is_champion ?? code === "M0004",
    weights,
    sharpe: extras.sharpe ?? 0.422,
    max_drawdown: extras.max_drawdown ?? -0.181,
    cagr: extras.cagr ?? 0.07,
    volatility: 0.1,
    needs_attainment: NEEDS,
    ...extras,
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

  it("keeps distinct holdings even when headline metrics match", () => {
    const out = dedupeProposalSet(
      [
        card("M0001", {
          is_recommended: true,
          label: "recommended",
          sharpe: 0.318,
          cagr: 0.061,
          max_drawdown: -0.195,
        }),
        card("M0002", {
          label: "alternative_2",
          sharpe: 0.318,
          cagr: 0.061,
          max_drawdown: -0.195,
        }),
      ],
      [
        cand("M0001", {
          AGG: 0.12,
          IVV: 0.12,
          TLT: 0.2,
          SHY: 0.12,
          GLD: 0.12,
          DODIX: 0.12,
          VWELX: 0.12,
        }, { is_champion: true, sharpe: 0.318, cagr: 0.061, max_drawdown: -0.195 }),
        cand("M0002", {
          AGG: 0.12,
          IVV: 0.12,
          TLT: 0.2,
          SHY: 0.12,
          GLD: 0.12,
          DODIX: 0.12,
          VWELX: 0.12,
          PG: 0.06,
        }, { is_champion: false, sharpe: 0.318, cagr: 0.061, max_drawdown: -0.195 }),
      ],
    );
    expect(out.map((c) => c.model_code)).toEqual(["M0001", "M0002"]);
  });

  it("returns empty for null/empty", () => {
    expect(dedupeProposalSet(null)).toEqual([]);
    expect(dedupeProposalSet([])).toEqual([]);
  });
});

describe("buildDisplayProposalSet", () => {
  it("fills thin API proposal_set from weight-distinct candidates", () => {
    const out = buildDisplayProposalSet(
      [card("M0023", { is_recommended: true, label: "recommended", sharpe: 0.911, cagr: 0.238, max_drawdown: -0.326 })],
      [
        cand("M0023", { AAPL: 0.13, FXAIX: 0.15, SPY: 0.4, NVDA: 0.1, MSFT: 0.1, META: 0.12 }, {
          is_champion: true,
          sharpe: 0.911,
          cagr: 0.238,
          max_drawdown: -0.326,
        }),
        cand("M0025", { AAPL: 0.1, FXAIX: 0.15, SPY: 0.35, NVDA: 0.15, MSFT: 0.1, META: 0.15 }, {
          is_champion: false,
          sharpe: 0.912,
          cagr: 0.238,
          max_drawdown: -0.327,
          rank: 2,
        }),
        cand("M0040", { AAPL: 0.08, FXAIX: 0.12, SPY: 0.3, NVDA: 0.2, MSFT: 0.15, META: 0.15 }, {
          is_champion: false,
          sharpe: 0.915,
          cagr: 0.239,
          max_drawdown: -0.327,
          rank: 3,
        }),
      ],
    );
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[0]?.model_code).toBe("M0023");
    expect(out.some((p) => !p.is_recommended)).toBe(true);
  });

  it("does not reintroduce exact weight clones like repeated M0001", () => {
    const cloneW = {
      SPY: 0.1843,
      FXAIX: 0.1843,
      XLF: 0.1525,
      XLV: 0.1525,
      AAPL: 0.1398,
      MSFT: 0.1,
      NVDA: 0.0866,
    };
    const out = buildDisplayProposalSet(
      [
        card("M0022", {
          is_recommended: true,
          label: "recommended",
          sharpe: 1.428,
          cagr: 0.299,
          max_drawdown: -0.198,
        }),
        card("M0001", {
          label: "growth",
          sharpe: 1.408,
          cagr: 0.3,
          max_drawdown: -0.21,
        }),
      ],
      [
        cand("M0001", cloneW, { rank: 1, is_champion: false, sharpe: 1.408, cagr: 0.3, max_drawdown: -0.21 }),
        cand("M0001", cloneW, { rank: 2, is_champion: false, sharpe: 1.408, cagr: 0.3, max_drawdown: -0.21 }),
        cand("M0001", cloneW, { rank: 3, is_champion: false, sharpe: 1.408, cagr: 0.3, max_drawdown: -0.21 }),
        cand("M0001", cloneW, { rank: 4, is_champion: false, sharpe: 1.408, cagr: 0.3, max_drawdown: -0.21 }),
        cand(
          "M0022",
          { FXAIX: 0.1942, SPY: 0.1875, NVDA: 0.1502, XLF: 0.1296, MSFT: 0.1145, AAPL: 0.1, XLV: 0.124 },
          { rank: 5, is_champion: true, sharpe: 1.428, cagr: 0.299, max_drawdown: -0.198 },
        ),
      ],
    );
    expect(out.map((p) => p.model_code).sort()).toEqual(["M0001", "M0022"]);
  });

  it("promotes search champion to sole recommended even if API marked another", () => {
    const out = buildDisplayProposalSet(
      [
        card("M0022", {
          is_recommended: true,
          label: "recommended",
          sharpe: 1.2,
          cagr: 0.14,
          max_drawdown: -0.1,
        }),
        card("M0001", {
          label: "growth",
          sharpe: 1.4,
          cagr: 0.18,
          max_drawdown: -0.3,
        }),
        card("M0036", {
          label: "alternative_2",
          sharpe: 0.9,
          cagr: 0.12,
          max_drawdown: -0.25,
        }),
      ],
      [
        cand("M0022", { IVV: 0.4, TLT: 0.6 }, {
          is_champion: false,
          sharpe: 1.2,
          cagr: 0.14,
          max_drawdown: -0.1,
        }),
        cand("M0001", { IVV: 0.95, TLT: 0.05 }, {
          is_champion: false,
          sharpe: 1.4,
          cagr: 0.18,
          max_drawdown: -0.3,
        }),
        cand("M0036", { IVV: 0.8, TLT: 0.2 }, {
          is_champion: true,
          sharpe: 0.9,
          cagr: 0.12,
          max_drawdown: -0.25,
        }),
      ],
    );
    const recommended = out.filter((p) => p.is_recommended);
    expect(recommended).toHaveLength(1);
    expect(recommended[0]?.model_code).toBe("M0036");
    expect(recommended[0]?.label).toBe("recommended");
    expect(out.find((p) => p.model_code === "M0022")?.label).not.toBe("recommended");
    expect(out.every((p) => !/^alternative_\d+$/i.test(p.label))).toBe(true);
    expect(resolvePrimaryRecommendationCode(
      [
        card("M0022", { is_recommended: true, label: "recommended" }),
        card("M0036", { label: "alternative_2" }),
      ],
      [
        cand("M0022", { A: 1 }, { is_champion: false }),
        cand("M0036", { B: 1 }, { is_champion: true }),
      ],
    )).toBe("M0036");
  });
});

describe("normalizeProposalLabel", () => {
  it("maps raw alternative enums to alternative", () => {
    expect(normalizeProposalLabel("ALTERNATIVE_2")).toBe("alternative");
    expect(normalizeProposalLabel("alternative_3")).toBe("alternative");
    expect(normalizeProposalLabel("growth")).toBe("growth");
  });

  it("preserves constrained customization scenario labels", () => {
    expect(normalizeProposalLabel("anchor_close")).toBe("anchor_close");
    expect(normalizeProposalLabel("full_drift")).toBe("full_drift");
    expect(normalizeProposalLabel("theme")).toBe("theme");
  });
});

describe("alignPrimaryRecommendation", () => {
  it("keeps distinct weight alternatives while demoting false recommended", () => {
    const out = alignPrimaryRecommendation(
      [
        card("M0022", { is_recommended: true, label: "recommended" }),
        card("M0001", { label: "growth" }),
      ],
      [
        cand("M0022", { A: 0.5, B: 0.5 }, { is_champion: false }),
        cand("M0001", { A: 0.9, B: 0.1 }, { is_champion: true }),
      ],
    );
    expect(out.find((p) => p.is_recommended)?.model_code).toBe("M0001");
    expect(out).toHaveLength(2);
  });
});

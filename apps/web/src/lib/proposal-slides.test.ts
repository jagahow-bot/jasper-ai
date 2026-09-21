import { describe, expect, it } from "vitest";
import { getDemoClientById, DEMO_RM_PROFILE } from "@/lib/clients";
import { getModelPortfolioById, SPY_ANCHOR } from "@/lib/model-portfolios";
import { buildProposalSlideDeck } from "@/lib/proposal-slides";
import type { BacktestResult, PersonalizationCompare } from "@/lib/types";
import type { ClientOverlay } from "@/lib/overlay-schema";

function stubResult(
  weights: Record<string, number>,
  opts?: {
    jobId?: string;
    calmar?: number;
    turnover?: number;
    episodes?: NonNullable<
      NonNullable<BacktestResult["candidates"]>[0]["analytics"]
    >["drawdown_episodes"];
    scenarios?: NonNullable<
      NonNullable<BacktestResult["candidates"]>[0]["analytics"]
    >["stress_scenarios"];
    equity?: { date: string; value: number }[];
  },
): BacktestResult {
  return {
    job_id: opts?.jobId ?? "test-job",
    status: "completed",
    message: "ok",
    candidates: [
      {
        rank: 1,
        model_code: "M0001",
        is_champion: true,
        weights,
        sharpe: 1.1,
        max_drawdown: -0.12,
        cagr: 0.08,
        volatility: 0.14,
        calmar: opts?.calmar ?? 0.67,
        turnover_total: opts?.turnover ?? 0.35,
        equity_curve: opts?.equity ?? [
          { date: "2020-01-01", value: 100 },
          { date: "2021-01-01", value: 110 },
          { date: "2022-01-01", value: 105 },
        ],
        analytics: {
          drawdown_episodes: opts?.episodes,
          stress_scenarios: opts?.scenarios,
          exposure: {
            by_asset_class: { equity: 0.6, bond: 0.4 },
          },
        },
        needs_attainment: {
          max_drawdown_tolerance: 0.15,
          max_single_name_actual: 0.18,
          customization_drift_l1: 0.082,
        },
      },
    ],
    equity_curve: [],
    narrative_facts: { champion_model_code: "M0001" },
    narrative: "",
  } as unknown as BacktestResult;
}

const STRINGS: Record<string, string> = {
  "compare.metric.cagr": "CAGR",
  "compare.metric.sharpe": "Sharpe",
  "compare.metric.mdd": "MDD",
  "compare.metric.vol": "Vol",
  "common.calmar": "Calmar",
  "proposal.cover.docTitle": "Investment Proposal",
  "proposal.cover.firm": "PB",
  "proposal.cover.confidential": "Confidential",
  "proposal.cover.clientFallback": "Valued client",
  "proposal.cover.rmFallback": "RM",
  "proposal.cover.amountPending": "TBD",
  "proposal.cover.strategyLine": "Anchor: {am} · {theme}. Path: {customized}.",
  "proposal.field.client": "Client",
  "proposal.field.risk": "Risk",
  "proposal.field.aum": "AUM",
  "proposal.field.preparedBy": "Prepared by",
  "proposal.field.date": "Date",
  "proposal.field.objective": "Objective",
  "proposal.field.horizon": "Horizon",
  "proposal.field.years": "{n} years",
  "proposal.table.total": "Total",
  "proposal.body.market": "Market view for {customized} vs {anchor}",
  "proposal.warning.pastPerformance": "W1",
  "proposal.warning.valueFluctuation": "W2",
  "proposal.warning.currency": "W3",
  "proposal.warning.estimates": "W4",
  "proposal.warning.noAdvice": "W5",
  "objective.max_sharpe": "Best risk-adjusted return",
  "enum.risk.moderate": "Moderate",
  "enum.risk.conservative": "Conservative",
  "enum.risk.aggressive": "Aggressive",
  "institutional.equity": "Equity",
  "institutional.bond": "Bond",
  "institutional.cash": "Cash",
  "institutional.other": "Other",
  "institutional.commodity": "Commodity",
  "institutional.real_estate": "REIT",
  "institutional.alternative": "Alt",
  "slides.cover.strategyLineSingle": "Single path: {customized}",
  "slides.s1.title": "Basic",
  "slides.s1.account": "Account",
  "slides.s1.branch": "Branch",
  "slides.s2.title": "Goals",
  "slides.s2.targetReturn": "Target",
  "slides.s2.targetReturnNote": "Note",
  "slides.s2.reference": "ref",
  "slides.s2.maxDd": "Max DD",
  "slides.s2.drift": "Drift",
  "slides.s2.concentration": "Concentration",
  "slides.s2.singleName": "Single",
  "slides.s2.necessity": "Necessity",
  "slides.s3.title": "Market",
  "slides.s3.houseView": "House",
  "slides.s4.title": "Allocation",
  "slides.s4.current": "Current",
  "slides.s4.proposed": "Proposed",
  "slides.s4.adjustment": "Adj",
  "slides.s4.amount": "Amount",
  "slides.s4.class": "Class",
  "slides.s4.anchorFootnote": "Anchor footnote",
  "slides.s5.title": "Metrics",
  "slides.s5.period": "Window {start}–{end}",
  "slides.s5.improvement": "Improve",
  "slides.s6.title": "Stress",
  "slides.s6.blockA": "Block A",
  "slides.s6.blockB": "Block B",
  "slides.s6.honesty": "Honest",
  "slides.s6.defenseDelta": "Delta",
  "slides.s6.window": "Window",
  "slides.s6.scenario.2008": "2008",
  "slides.s6.scenario.2020": "2020",
  "slides.s6.scenario.2022": "2022",
  "slides.s7.title": "Trades",
  "slides.s7.sell": "Sell",
  "slides.s7.buy": "Buy",
  "slides.s7.isin": "ISIN",
  "slides.s7.rr": "RR",
  "slides.s7.pendingData": "Pending",
  "slides.s7.reason": "Reason",
  "slides.s7.reason.sell": "Sell reason",
  "slides.s7.reason.buy": "Buy reason",
  "slides.s7.none": "No trades",
  "slides.s8.title": "Cost",
  "slides.s8.assumption": "Assume {subBps}/{redBps}",
  "slides.s8.totalCost": "Total cost",
  "slides.s8.turnover": "Turnover",
  "slides.s8.feeSplit": "Fees {subBps}/{redBps}",
  "slides.s8.costPct": "Cost %",
  "slides.s8.benefit": "Benefit",
  "slides.s9.title": "Monitor",
  "slides.s9.driftAlert": "Drift alert",
  "slides.s9.review": "Review",
  "slides.s9.event": "Event",
  "slides.s10.title": "Signoff",
  "slides.s10.rm": "RM",
  "slides.s10.supervisor": "Supervisor",
  "slides.s10.client": "Client",
  "slides.s10.ack": "Ack",
  "slides.s10.signatureLine": "Sign",
  "slides.placeholder.dash": "—",
  "regime.risk_off": "Risk-off",
  "regime.neutral": "Neutral",
  "regime.risk_on": "Risk-on",
  "rm.talking.portfolioStructure": "Mix {assetMix} holdings {topHoldings}",
  "rm.talking.portfolioHoldingsOnly": "Holdings {topHoldings}",
  "rm.talking.vsAnchorChanges": "Vs {anchor}: {changes}",
  "rm.talking.changeAdded": "added {ticker} ({pct}%)",
  "rm.talking.changeRemoved": "removed {ticker}",
  "rm.talking.changeIncreased": "increased {ticker} (+{delta} pp)",
  "rm.talking.changeDecreased": "decreased {ticker} (-{delta} pp)",
  "rm.talking.objective.max_sharpe": "Sharpe objective",
};

function t(key: string, params?: Record<string, string | number>): string {
  let s = STRINGS[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return s;
}

function makeCompare(
  base: BacktestResult,
  adjusted: BacktestResult,
): PersonalizationCompare {
  return {
    anchorPortfolioId: "spy-benchmark",
    anchorLabel: "SPY Anchor",
    customizedLabel: "Custom Path",
    baseResult: base,
    baseRequest: {
      start_date: "2019-01-01",
      end_date: "2025-12-31",
      objective: "max_sharpe",
      asset_classes: ["equity", "bond"],
    } as PersonalizationCompare["baseRequest"],
    adjustedResult: adjusted,
    adjustedRequest: {
      start_date: "2019-01-01",
      end_date: "2025-12-31",
      objective: "max_sharpe",
      asset_classes: ["equity", "bond"],
    } as PersonalizationCompare["adjustedRequest"],
  };
}

const stressBundle = {
  episodes: [
    {
      start: "2020-02-19",
      trough: "2020-03-23",
      end: "2020-08-01",
      depth: -0.32,
      days: 40,
    },
    {
      start: "2022-01-03",
      trough: "2022-10-12",
      end: "2023-01-01",
      depth: -0.22,
      days: 100,
    },
    {
      start: "2021-09-01",
      trough: "2021-10-01",
      end: "2021-11-01",
      depth: -0.08,
      days: 30,
    },
  ],
  scenarios: [
    {
      id: "2008",
      label: "2008",
      start: "2007-10-09",
      end: "2009-03-09",
      depth: null as number | null,
    },
    {
      id: "2020",
      label: "2020",
      start: "2020-02-19",
      end: "2020-03-23",
      depth: -0.33,
    },
    {
      id: "2022",
      label: "2022",
      start: "2022-01-03",
      end: "2022-10-12",
      depth: -0.25,
    },
  ],
};

describe("buildProposalSlideDeck", () => {
  const client = getDemoClientById("JB-HNWI-001")!;
  const anchor = getModelPortfolioById("spy-benchmark") ?? SPY_ANCHOR;

  it("U1: full client + dual-track with stress → 11 slides; S1 has name/AUM; S4 sums ~100%", () => {
    const base = stubResult(
      { SPY: 0.6, AGG: 0.4 },
      { jobId: "base", ...stressBundle },
    );
    const adj = stubResult(
      { SPY: 0.45, AGG: 0.55 },
      { jobId: "adj", ...stressBundle },
    );
    const slides = buildProposalSlideDeck({
      compare: makeCompare(base, adj),
      overlay: null,
      anchorPortfolio: anchor,
      client,
      lang: "zh",
      t,
    });
    expect(slides.map((s) => s.id)).toContain("stress-review");
    expect(slides).toHaveLength(11);
    const s1 = slides.find((s) => s.id === "basic-info");
    expect(s1?.kind).toBe("kv-grid");
    if (s1?.kind === "kv-grid") {
      const values = s1.rows.map((r) => r.value).join(" ");
      expect(values).toMatch(/王/);
      expect(values).toMatch(/\$|USD|12/);
    }
    const s4 = slides.find((s) => s.id === "allocation-compare");
    if (s4?.kind === "asset-class-compare") {
      const sum = s4.rows.reduce((acc, r) => acc + r.proposedPct, 0);
      expect(sum).toBeGreaterThan(95);
      expect(sum).toBeLessThan(105);
    }
  });

  it("U2: no client → fallback name; amounts TBD; no throw", () => {
    const base = stubResult({ SPY: 1 }, { jobId: "b" });
    const adj = stubResult({ SPY: 1 }, { jobId: "a" });
    const slides = buildProposalSlideDeck({
      compare: makeCompare(base, adj),
      overlay: null,
      anchorPortfolio: anchor,
      client: null,
      lang: "en",
      t,
    });
    const cover = slides.find((s) => s.id === "cover");
    expect(cover?.kind).toBe("cover");
    if (cover?.kind === "cover") {
      expect(cover.clientName).toBe("Valued client");
      expect(cover.investmentAmount).toBe("TBD");
    }
  });

  it("U3: no overlay → S3 stance null; S2 goal from request", () => {
    const base = stubResult({ SPY: 1 }, { jobId: "b" });
    const adj = stubResult({ SPY: 1 }, { jobId: "a" });
    const slides = buildProposalSlideDeck({
      compare: makeCompare(base, adj),
      overlay: null,
      anchorPortfolio: anchor,
      client,
      lang: "en",
      t,
    });
    const s3 = slides.find((s) => s.id === "market-strategy");
    expect(s3?.kind).toBe("market");
    if (s3?.kind === "market") {
      expect(s3.stanceLabel).toBeNull();
      expect(s3.narrative.length).toBeGreaterThan(0);
    }
    const s2 = slides.find((s) => s.id === "goals-diagnosis");
    if (s2?.kind === "goals") {
      expect(s2.goal).toMatch(/risk-adjusted|max_sharpe/i);
    }
  });

  it("U4: no stress data → 10 slides (no S6)", () => {
    const base = stubResult({ SPY: 1 }, { jobId: "b" });
    const adj = stubResult({ SPY: 1 }, { jobId: "a" });
    const slides = buildProposalSlideDeck({
      compare: makeCompare(base, adj),
      overlay: null,
      anchorPortfolio: anchor,
      client,
      lang: "zh",
      t,
    });
    expect(slides.map((s) => s.id)).not.toContain("stress-review");
    expect(slides).toHaveLength(10);
  });

  it("U5: single-track → no anchor columns on S4/S5", () => {
    const same = stubResult({ SPY: 0.5, AGG: 0.5 }, { jobId: "same" });
    const compare = makeCompare(same, same);
    compare.adjustedRequest = {
      ...compare.adjustedRequest,
      skip_anchor_compare: true,
    };
    const slides = buildProposalSlideDeck({
      compare,
      overlay: null,
      anchorPortfolio: anchor,
      client,
      lang: "en",
      t,
    });
    const s4 = slides.find((s) => s.id === "allocation-compare");
    if (s4?.kind === "asset-class-compare") {
      expect(s4.columns.current).toBeNull();
      expect(s4.rows.every((r) => r.currentPct == null)).toBe(true);
    }
    const s5 = slides.find((s) => s.id === "backtest-metrics");
    if (s5?.kind === "metrics") {
      expect(s5.singleTrack).toBe(true);
      expect(s5.metrics.every((m) => m.anchor == null)).toBe(true);
    }
  });

  it("U6: cash-heavy client uses cash notional; current mix cash", () => {
    const base = stubResult({ SPY: 0.6, AGG: 0.4 }, { jobId: "b" });
    const adj = stubResult({ SPY: 0.5, AGG: 0.5 }, { jobId: "a" });
    expect(client.cash_usd).toBeGreaterThanOrEqual(client.aum_usd * 0.5);
    const slides = buildProposalSlideDeck({
      compare: makeCompare(base, adj),
      overlay: null,
      anchorPortfolio: anchor,
      client,
      lang: "en",
      t,
    });
    const cover = slides.find((s) => s.id === "cover");
    if (cover?.kind === "cover") {
      expect(cover.investmentAmount).not.toBe("TBD");
    }
    const s4 = slides.find((s) => s.id === "allocation-compare");
    if (s4?.kind === "asset-class-compare") {
      const cash = s4.rows.find((r) => r.cls === "cash");
      expect(cash?.currentPct).toBeGreaterThan(90);
    }
  });

  it("U7: empty holdingsDiff → S7 emptyLabel", () => {
    const weights = { SPY: 0.6, AGG: 0.4 };
    const base = stubResult(weights, { jobId: "b" });
    const adj = stubResult(weights, { jobId: "a" });
    const slides = buildProposalSlideDeck({
      compare: makeCompare(base, adj),
      overlay: null,
      anchorPortfolio: {
        ...anchor,
        holdings: [
          { ticker: "SPY", weight: 0.6 },
          { ticker: "AGG", weight: 0.4 },
        ],
      },
      client,
      lang: "zh",
      t,
    });
    const s7 = slides.find((s) => s.id === "trade-list");
    expect(s7?.kind).toBe("trade-list");
    if (s7?.kind === "trade-list") {
      expect(s7.emptyLabel).toBe("No trades");
      expect(s7.sells).toHaveLength(0);
      expect(s7.buys).toHaveLength(0);
    }
  });

  it("U8: no turnover and empty diff → S8 cost placeholder still has assumption", () => {
    const weights = { SPY: 1 };
    const base = stubResult(weights, {
      jobId: "b",
      turnover: undefined,
    });
    // Force undefined turnover
    base.candidates![0].turnover_total = null;
    const adj = stubResult(weights, { jobId: "a" });
    adj.candidates![0].turnover_total = null;
    const slides = buildProposalSlideDeck({
      compare: makeCompare(base, adj),
      overlay: null,
      anchorPortfolio: anchor,
      client: null,
      lang: "en",
      t,
    });
    const s8 = slides.find((s) => s.id === "cost-estimate");
    if (s8?.kind === "cost") {
      expect(s8.assumptionNote).toMatch(/50/);
      expect(s8.totalCostLabel).toBe("—");
    }
  });

  it("U9: DEMO account + RM profile on S1", () => {
    const base = stubResult({ SPY: 1 }, { jobId: "b" });
    const adj = stubResult({ SPY: 1 }, { jobId: "a" });
    const slides = buildProposalSlideDeck({
      compare: makeCompare(base, adj),
      overlay: null,
      anchorPortfolio: anchor,
      client,
      lang: "zh",
      t,
    });
    const s1 = slides.find((s) => s.id === "basic-info");
    if (s1?.kind === "kv-grid") {
      const account = s1.rows.find((r) => r.label === "Account")?.value;
      expect(account).toMatch(/^88\d{6}$/);
      const rm = s1.rows.find((r) => r.label === "Prepared by")?.value;
      expect(rm).toContain(DEMO_RM_PROFILE.employee_id);
      const branch = s1.rows.find((r) => r.label === "Branch")?.value;
      expect(branch).toContain(DEMO_RM_PROFILE.branch);
    }
  });

  it("U11: partial stress scenarios still show S6 with — for missing window", () => {
    const base = stubResult(
      { SPY: 1 },
      { jobId: "b", scenarios: stressBundle.scenarios, episodes: [] },
    );
    const adj = stubResult(
      { SPY: 1 },
      { jobId: "a", scenarios: stressBundle.scenarios, episodes: [] },
    );
    const slides = buildProposalSlideDeck({
      compare: makeCompare(base, adj),
      overlay: null,
      anchorPortfolio: anchor,
      client,
      lang: "zh",
      t,
    });
    const s6 = slides.find((s) => s.id === "stress-review");
    expect(s6?.kind).toBe("stress");
    if (s6?.kind === "stress") {
      const gfc = s6.scenarios.find((s) => s.scenario === "2008");
      expect(gfc?.customizedDepth).toBe("—");
      const covid = s6.scenarios.find((s) => s.scenario === "2020");
      expect(covid?.customizedDepth).toMatch(/%/);
    }
  });

  it("includes Calmar in S5 metrics", () => {
    const base = stubResult({ SPY: 1 }, { jobId: "b", calmar: 0.5 });
    const adj = stubResult({ SPY: 1 }, { jobId: "a", calmar: 0.8 });
    const slides = buildProposalSlideDeck({
      compare: makeCompare(base, adj),
      overlay: null,
      anchorPortfolio: anchor,
      client,
      lang: "en",
      t,
    });
    const s5 = slides.find((s) => s.id === "backtest-metrics");
    if (s5?.kind === "metrics") {
      expect(s5.metrics.some((m) => m.label === "Calmar")).toBe(true);
    }
  });

  it("Q7: overlay target_annual_return preferred over anchor CAGR", () => {
    const base = stubResult({ SPY: 1 }, { jobId: "b" });
    const adj = stubResult({ SPY: 1 }, { jobId: "a" });
    const overlay = {
      client_profile: { target_annual_return: 0.07 },
      optimization: { objective: "max_sharpe" },
      market_view: {
        stance: "neutral",
        themes: ["income"],
        narrative_summary: "Balanced outlook for the year ahead.",
      },
    } as unknown as ClientOverlay;
    const slides = buildProposalSlideDeck({
      compare: makeCompare(base, adj),
      overlay,
      anchorPortfolio: anchor,
      client,
      lang: "en",
      t,
    });
    const s2 = slides.find((s) => s.id === "goals-diagnosis");
    if (s2?.kind === "goals") {
      expect(s2.targetReturnIsReference).toBe(false);
      expect(s2.targetReturn).toMatch(/7\.0%/);
    }
  });
});

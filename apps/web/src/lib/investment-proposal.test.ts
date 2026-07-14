import { describe, expect, it } from "vitest";
import { buildInvestmentProposalDocument } from "@/lib/investment-proposal";
import { getDemoClientById } from "@/lib/clients";
import { getModelPortfolioById, SPY_ANCHOR } from "@/lib/model-portfolios";
import type { BacktestResult, PersonalizationCompare } from "@/lib/types";

function stubResult(weights: Record<string, number>): BacktestResult {
  return {
    job_id: "test-job",
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
        equity_curve: [
          { date: "2020-01-01", value: 100 },
          { date: "2021-01-01", value: 110 },
          { date: "2022-01-01", value: 105 },
        ],
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
  "proposal.cover.docTitle": "Investment Proposal",
  "proposal.cover.firm": "PB",
  "proposal.cover.confidential": "Confidential",
  "proposal.cover.clientFallback": "Client",
  "proposal.cover.rmFallback": "RM",
  "proposal.cover.amountPending": "TBD",
  "proposal.cover.strategyLine": "Anchor: {am} · {theme}. Path: {customized}.",
  "proposal.letter.dear": "Dear {client},",
  "proposal.letter.thanks": "Thanks {amount} {strategy}.",
  "proposal.letter.recommend": "Recommend {customized} from {anchor}.",
  "proposal.letter.close": "Regards,",
  "proposal.field.client": "Client",
  "proposal.field.segment": "Segment",
  "proposal.field.age": "Age",
  "proposal.field.risk": "Risk",
  "proposal.field.horizon": "Horizon",
  "proposal.field.aum": "AUM",
  "proposal.field.cash": "Cash",
  "proposal.field.liquidity": "Liquidity",
  "proposal.field.esg": "ESG",
  "proposal.field.profile": "Profile",
  "proposal.field.preparedBy": "Prepared by",
  "proposal.field.date": "Date",
  "proposal.field.investment": "Amount",
  "proposal.field.horizonYears": "Horizon years",
  "proposal.field.years": "{n} years",
  "proposal.field.overlayLiquidity": "Overlay liquidity",
  "proposal.field.withinMonths": "Within {n} months",
  "proposal.field.objective": "Objective",
  "proposal.field.marketStance": "Stance",
  "proposal.section.executive": "Executive",
  "proposal.section.profile": "Profile",
  "proposal.section.current": "Current",
  "proposal.section.strategy": "Strategy",
  "proposal.section.allocation": "Allocation",
  "proposal.section.rationale": "Rationale",
  "proposal.section.performance": "Performance",
  "proposal.section.implementation": "Implementation",
  "proposal.section.disclaimers": "Disclaimers",
  "proposal.body.letterIntro": "Intro {client} {amount} {am} {theme}",
  "proposal.body.executive": "Exec {anchor} {customized}",
  "proposal.body.profileFallback": "Fallback profile",
  "proposal.body.currentAnchor": "Anchor {anchor}",
  "proposal.body.currentFootnote": "As of {asOf}",
  "proposal.body.strategyAnchor": "AM {am} {theme} {risk}",
  "proposal.body.strategyCustomize": "Custom {customized} {anchor}",
  "proposal.body.market": "Market {customized} {anchor}",
  "proposal.body.allocationFallback": "No weights",
  "proposal.body.allocationFootnote": "Footnote",
  "proposal.body.constructionFallback": "Window {start} {end} {objective}",
  "proposal.body.excludes": "Excludes {tickers}",
  "proposal.body.objectiveLine": "Objective {objective}",
  "proposal.body.validationNote": "Validation",
  "proposal.body.chartCaption": "Chart {start} {end}",
  "proposal.body.riskMdd": "MDD {customized} {anchor}",
  "proposal.body.riskFallback": "Risk fallback",
  "proposal.body.implDca": "DCA",
  "proposal.body.implRebalance": "Rebalance {start} {end}",
  "proposal.body.implLiquidity": "Liquidity buffer",
  "proposal.body.implClientLiquidity": "Note {note}",
  "proposal.body.impl1": "Impl1",
  "proposal.body.impl2": "Impl2",
  "proposal.body.impl3": "Impl3",
  "proposal.body.signOffNote": "Sign {note}",
  "proposal.body.disclaimer1": "D1",
  "proposal.body.disclaimer2": "D2",
  "proposal.body.disclaimerSuitability": "Suitability",
  "proposal.body.nextSteps": "Next",
  "proposal.warning.pastPerformance": "W1",
  "proposal.warning.valueFluctuation": "W2",
  "proposal.warning.currency": "W3",
  "proposal.warning.estimates": "W4",
  "proposal.warning.noAdvice": "W5",
  "proposal.table.total": "Total",
  "rm.report.metricsSummary": "CAGR {cagrDelta} MDD {mddDelta} vs {anchor}",
  "rm.report.disclaimerBody": "Disclaimer body",
  "rm.report.noOverlaySummary": "No overlay",
  "rm.holdings.added": "Added",
  "rm.holdings.removed": "Removed",
  "rm.holdings.increased": "Increased",
  "rm.holdings.decreased": "Decreased",
  "rm.holdings.unchanged": "Unchanged",
  "rm.talking.compliance": "Compliance reminder",
};

function t(key: string, params?: Record<string, string | number>): string {
  let s = STRINGS[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.replaceAll(`{${k}}`, String(v));
    }
  }
  return s;
}

describe("buildInvestmentProposalDocument", () => {
  it("builds cover, allocation, and performance sections from client + compare", () => {
    const client = getDemoClientById("JB-HNWI-001")!;
    const anchor =
      getModelPortfolioById("spy-benchmark") ?? SPY_ANCHOR;
    const compare: PersonalizationCompare = {
      anchorPortfolioId: "spy-benchmark",
      anchorLabel: "SPY Anchor",
      customizedLabel: "Customized",
      baseResult: stubResult({ SPY: 1 }),
      baseRequest: {
        start_date: "2020-01-01",
        end_date: "2022-01-01",
        objective: "max_sharpe",
      } as PersonalizationCompare["baseRequest"],
      adjustedResult: stubResult({ SPY: 0.6, AGG: 0.4 }),
      adjustedRequest: {
        start_date: "2020-01-01",
        end_date: "2022-01-01",
        objective: "max_sharpe",
      } as PersonalizationCompare["adjustedRequest"],
    };

    const doc = buildInvestmentProposalDocument({
      compare,
      overlay: null,
      anchorPortfolio: anchor,
      client,
      lang: "zh",
      t,
    });

    expect(doc.cover.clientName).toContain("王");
    expect(doc.cover.confidential).toBe("Confidential");
    expect(doc.sections.map((s) => s.id)).toEqual([
      "executive",
      "profile",
      "current",
      "strategy",
      "allocation",
      "rationale",
      "performance",
      "implementation",
      "disclaimers",
    ]);

    const allocation = doc.sections.find((s) => s.id === "allocation");
    expect(allocation?.kind).toBe("allocation");
    if (allocation?.kind === "allocation") {
      expect(allocation.rows.some((r) => r.ticker === "SPY")).toBe(true);
      expect(allocation.rows.some((r) => r.ticker === "AGG")).toBe(true);
      expect(allocation.rows.every((r) => r.name.length > 0)).toBe(true);
    }

    const perf = doc.sections.find((s) => s.id === "performance");
    expect(perf?.kind).toBe("performance");
    if (perf?.kind === "performance") {
      expect(perf.chartData?.length).toBeGreaterThan(1);
      expect(perf.metrics.length).toBeGreaterThan(0);
    }
  });
});

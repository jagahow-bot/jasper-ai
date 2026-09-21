/**
 * Investment proposal slide deck builder (Q5-B replaces document mode UI).
 * Pure functions — no React. Data sources align with RM report / prior document builder.
 */
import {
  demoAccountNumberForClient,
  demoRmBranchLabel,
  demoRmDisplayName,
  formatUsd,
  localizedText,
  type DemoClient,
} from "@/lib/clients";
import { ASSET_CLASSES } from "@/lib/constants";
import {
  riskProfileLabel,
  type Lang,
  type TFn,
} from "@/lib/i18n";
import {
  getAssetManagerLabel,
  getPortfolioLabel,
  type ModelPortfolio,
} from "@/lib/model-portfolios";
import type { ClientOverlay } from "@/lib/overlay-schema";
import { isSingleTrackPersonalizationCompare } from "@/lib/personalization-compare";
import { resolveChampionCandidateIndex } from "@/lib/performance-compare-chart";
import { resolveRunObjective } from "@/lib/resolve-run-objective";
import {
  buildBenchmarkCompareChartData,
  buildHoldingsDiff,
  buildMetricCompareRows,
  buildTalkingPoints,
  computeAssetMixFromWeights,
  resolveExposureMix,
  type BenchmarkCompareChartRow,
  type HoldingDiffRow,
  type MetricCompareRow,
  type RmCandidatePick,
} from "@/lib/rm-report-utils";
import { resolveTickerDisplayName } from "@/lib/ticker-display-name";
import type { PersonalizationCompare, PortfolioCandidate } from "@/lib/types";
import { getUniverseItems } from "@/lib/universe";

/** Illustrative subscription fee (bps) for cost slide — Q6-B. */
export const SUBSCRIPTION_FEE_BPS = 50;
/** Illustrative redemption fee (bps) for cost slide — Q6-B. */
export const REDEMPTION_FEE_BPS = 50;

export type ProposalMetricTableRow = {
  label: string;
  anchor: string | null;
  customized: string;
  delta: string | null;
};

export type TradeRow = {
  ticker: string;
  name: string;
  isin: string;
  rr: string;
  weightPct: number;
  amountLabel: string;
  reason: string;
};

export type ProposalSlide =
  | {
      id: "cover";
      kind: "cover";
      titleKey: string;
      brand: string;
      firm: string;
      clientName: string;
      preparedBy: string;
      dateLabel: string;
      investmentAmount: string;
      strategyLine: string;
      confidential: string;
    }
  | {
      id: "basic-info";
      kind: "kv-grid";
      titleKey: string;
      rows: { label: string; value: string }[];
    }
  | {
      id: "goals-diagnosis";
      kind: "goals";
      titleKey: string;
      goal: string;
      horizon: string;
      maxDrawdown: string;
      targetReturn: string;
      targetReturnIsReference: boolean;
      driftLabel: string;
      concentrationLabel: string;
      necessity: string;
    }
  | {
      id: "market-strategy";
      kind: "market";
      titleKey: string;
      stanceLabel: string | null;
      narrative: string;
      themes: string[];
      bullets: string[];
    }
  | {
      id: "allocation-compare";
      kind: "asset-class-compare";
      titleKey: string;
      columns: { current: string | null; proposed: string };
      rows: {
        cls: string;
        label: string;
        currentPct: number | null;
        proposedPct: number;
        deltaPp: number | null;
        amountLabel: string;
      }[];
      totalLabel: string;
      totalAmount: string;
      footnote?: string;
    }
  | {
      id: "backtest-metrics";
      kind: "metrics";
      titleKey: string;
      periodLabel: string;
      metrics: ProposalMetricTableRow[];
      chartData: BenchmarkCompareChartRow[] | null;
      anchorLabel: string | null;
      customizedLabel: string;
      singleTrack: boolean;
    }
  | {
      id: "stress-review";
      kind: "stress";
      titleKey: string;
      honestyNote: string;
      episodesTitle: string;
      episodes: {
        window: string;
        anchorDepth: string | null;
        customizedDepth: string;
        deltaLabel: string;
      }[];
      scenariosTitle: string;
      scenarios: {
        scenario: string;
        anchorDepth: string | null;
        customizedDepth: string;
        deltaLabel: string;
      }[];
      singleTrack: boolean;
    }
  | {
      id: "trade-list";
      kind: "trade-list";
      titleKey: string;
      sells: TradeRow[];
      buys: TradeRow[];
      emptyLabel?: string;
      pendingDataNote: string;
    }
  | {
      id: "cost-estimate";
      kind: "cost";
      titleKey: string;
      turnoverLabel: string;
      feeLabel: string;
      totalCostLabel: string;
      costPctLabel: string;
      assumptionNote: string;
      benefitNote: string;
    }
  | {
      id: "monitoring";
      kind: "bullets";
      titleKey: string;
      bullets: string[];
    }
  | {
      id: "compliance-signoff";
      kind: "signoff";
      titleKey: string;
      warnings: string[];
      signees: { role: string; name?: string }[];
      ackNote: string;
    };

function dash(t: TFn): string {
  return t("slides.placeholder.dash");
}

function formatProposalDate(iso: string | undefined, lang: Lang): string {
  const d = iso ? new Date(iso) : new Date();
  const valid = Number.isFinite(d.getTime()) ? d : new Date();
  const locale = lang === "zh" ? "zh-TW" : lang === "ko" ? "ko-KR" : "en-GB";
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(valid);
}

function investmentNotional(client: DemoClient | null): number | null {
  if (!client) return null;
  if (client.cash_usd > 0 && client.cash_usd >= client.aum_usd * 0.5) {
    return client.cash_usd;
  }
  return client.aum_usd > 0 ? client.aum_usd : null;
}

function fmtPctDisplay(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

function pickCandidate(
  result: PersonalizationCompare["adjustedResult"],
  modelCode?: string | null,
): PortfolioCandidate | undefined {
  const candidates = result.candidates ?? [];
  if (modelCode) {
    const match = candidates.find(
      (c) => (c.model_code ?? "").toUpperCase() === modelCode.toUpperCase(),
    );
    if (match) return match;
  }
  const idx = resolveChampionCandidateIndex(candidates, result.narrative_facts);
  return idx >= 0 ? candidates[idx] : candidates[0];
}

function resolveIsin(ticker: string): string {
  const upper = ticker.toUpperCase();
  if (upper === "CASH" || upper === "__CASH__") return "—";
  const item = getUniverseItems().find((u) => u.ticker.toUpperCase() === upper);
  const pt = (item?.product_type ?? "etf").toLowerCase();
  if (pt === "stock") return "-";
  if (item?.isin) return item.isin;
  if (pt === "etf" || pt === "fund") return "—";
  return "-";
}

function assetClassLabel(t: TFn, cls: string): string {
  const key = cls === "other" ? "institutional.other" : `institutional.${cls}`;
  const val = t(key);
  return val === key ? cls.replace(/_/g, " ") : val;
}

function driftFromHoldingsDiff(diff: HoldingDiffRow[]): number | null {
  if (!diff.length) return null;
  const sumAbs = diff.reduce((s, r) => s + Math.abs(r.deltaPct), 0);
  return sumAbs / 200; // Σ|Δ%|/2 → fraction
}

function turnoverFromDiff(diff: HoldingDiffRow[]): number | null {
  if (!diff.length) return null;
  const sumAbs = diff.reduce((s, r) => s + Math.abs(r.deltaPct), 0);
  return sumAbs / 200;
}

function depthDisplay(depth: number | null | undefined, t: TFn): string {
  if (depth == null || !Number.isFinite(depth)) return dash(t);
  return `${(depth * 100).toFixed(1)}%`;
}

function defenseDelta(
  anchor: number | null | undefined,
  customized: number | null | undefined,
  t: TFn,
): string {
  if (
    anchor == null ||
    customized == null ||
    !Number.isFinite(anchor) ||
    !Number.isFinite(customized)
  ) {
    return dash(t);
  }
  // Shallower drawdown (less negative) is better → positive defense.
  const delta = Math.abs(anchor) - Math.abs(customized);
  const prefix = delta > 0 ? "+" : "";
  return `${prefix}${(delta * 100).toFixed(1)}pp`;
}

function scenarioLabel(id: string, fallback: string, t: TFn): string {
  const key = `slides.s6.scenario.${id}`;
  const val = t(key);
  return val === key ? fallback : val;
}

export function buildProposalSlideDeck(input: {
  compare: PersonalizationCompare;
  overlay: ClientOverlay | null;
  anchorPortfolio: ModelPortfolio;
  client: DemoClient | null;
  lang: Lang;
  t: TFn;
  customizedModelCode?: string | null;
  talkingPoints?: string[];
}): ProposalSlide[] {
  const {
    compare,
    overlay,
    anchorPortfolio,
    client,
    lang,
    t,
    customizedModelCode,
    talkingPoints: talkingPointsOverride,
  } = input;

  const pick: RmCandidatePick | undefined = customizedModelCode
    ? { customizedModelCode }
    : undefined;
  const singleTrack = isSingleTrackPersonalizationCompare(compare);
  const notional = investmentNotional(client);
  const placeholder = dash(t);

  const metrics = buildMetricCompareRows(
    compare.baseResult,
    compare.adjustedResult,
    {
      cagr: t("compare.metric.cagr"),
      sharpe: t("compare.metric.sharpe"),
      mdd: t("compare.metric.mdd"),
      vol: t("compare.metric.vol"),
      calmar: t("common.calmar"),
    },
    pick,
  );
  const holdingsDiff = buildHoldingsDiff(
    compare.baseResult,
    compare.adjustedResult,
    singleTrack ? undefined : anchorPortfolio.holdings,
    pick,
  );
  const chartData = buildBenchmarkCompareChartData(
    compare.baseResult,
    compare.adjustedResult,
    pick,
  );
  const talkingPoints =
    talkingPointsOverride && talkingPointsOverride.length > 0
      ? talkingPointsOverride
      : buildTalkingPoints({
          metrics,
          holdingsDiff,
          overlay,
          adjustedResult: compare.adjustedResult,
          anchorLabel: compare.anchorLabel,
          objectiveKey: resolveRunObjective(
            compare.adjustedRequest,
            compare.adjustedResult.narrative_facts,
          ),
          lang,
          t,
          customizedModelCode,
        });

  const clientName = client
    ? localizedText(client.display_name, lang)
    : t("proposal.cover.clientFallback");
  const preparedBy = demoRmDisplayName(lang);
  const dateLabel = formatProposalDate(
    overlay?.audit?.rm_sign_off?.signed_at,
    lang,
  );
  const investmentAmount =
    notional != null ? formatUsd(notional, lang) : t("proposal.cover.amountPending");

  const amLabel = getAssetManagerLabel(anchorPortfolio, lang);
  const themeLabel = getPortfolioLabel(anchorPortfolio, lang);
  const strategyLine = singleTrack
    ? t("slides.cover.strategyLineSingle", {
        customized: compare.customizedLabel,
      })
    : t("proposal.cover.strategyLine", {
        am: amLabel,
        theme: themeLabel,
        customized: compare.customizedLabel,
      });

  const slides: ProposalSlide[] = [];

  // —— S0 cover ——
  slides.push({
    id: "cover",
    kind: "cover",
    titleKey: "proposal.cover.docTitle",
    brand: "JASPER",
    firm: t("proposal.cover.firm"),
    clientName,
    preparedBy,
    dateLabel,
    investmentAmount,
    strategyLine,
    confidential: t("proposal.cover.confidential"),
  });

  // —— S1 basic info ——
  const accountNumber =
    client?.account_number ??
    (client ? demoAccountNumberForClient(client.client_id) : placeholder);
  const riskLabel = client
    ? riskProfileLabel(t, client.risk_profile)
    : overlay?.client_profile.risk_tolerance
      ? riskProfileLabel(t, overlay.client_profile.risk_tolerance)
      : placeholder;
  const aumLabel =
    client && client.aum_usd > 0
      ? formatUsd(client.aum_usd, lang)
      : placeholder;

  slides.push({
    id: "basic-info",
    kind: "kv-grid",
    titleKey: "slides.s1.title",
    rows: [
      { label: t("proposal.field.client"), value: clientName },
      { label: t("slides.s1.account"), value: accountNumber },
      { label: t("proposal.field.risk"), value: riskLabel },
      { label: t("proposal.field.aum"), value: aumLabel },
      {
        label: t("proposal.field.preparedBy"),
        value: preparedBy,
      },
      {
        label: t("slides.s1.branch"),
        value: demoRmBranchLabel(lang),
      },
      { label: t("proposal.field.date"), value: dateLabel },
    ],
  });

  // —— S2 goals ——
  const objective =
    overlay?.optimization.objective ??
    resolveRunObjective(
      compare.adjustedRequest,
      compare.adjustedResult.narrative_facts,
    );
  const goalLabel = t(`objective.${objective}`);
  const goal =
    goalLabel === `objective.${objective}` ? String(objective) : goalLabel;

  const horizonYears = overlay?.client_profile.investment_horizon_years;
  const horizon =
    horizonYears != null
      ? t("proposal.field.years", { n: horizonYears })
      : client
        ? localizedText(client.investment_horizon, lang)
        : placeholder;

  const adjCand = pickCandidate(compare.adjustedResult, customizedModelCode);
  const needs = adjCand?.needs_attainment;
  const maxDd =
    needs?.max_drawdown_tolerance != null
      ? fmtPctDisplay(needs.max_drawdown_tolerance)
      : placeholder;

  const overlayTarget = overlay?.client_profile.target_annual_return;
  let targetReturn: string;
  let targetReturnIsReference = false;
  if (overlayTarget != null && Number.isFinite(overlayTarget)) {
    targetReturn = fmtPctDisplay(overlayTarget);
  } else {
    const cagrRow = metrics.find((m) => m.key === "cagr");
    if (cagrRow && Number.isFinite(cagrRow.anchorValue)) {
      targetReturn = fmtPctDisplay(cagrRow.anchorValue);
      targetReturnIsReference = true;
    } else if (cagrRow) {
      targetReturn = cagrRow.customizedDisplay;
      targetReturnIsReference = true;
    } else {
      targetReturn = placeholder;
    }
  }

  const driftFrac =
    needs?.customization_drift_l1 ?? driftFromHoldingsDiff(holdingsDiff);
  const driftLabel =
    driftFrac != null
      ? `${t("slides.s2.drift")}: ${fmtPctDisplay(driftFrac)}`
      : `${t("slides.s2.drift")}: ${placeholder}`;

  // Concentration: max asset_class % + max single ticker % (Q11-A)
  let currentMix: Record<string, number> = {};
  if (client?.holdings?.length) {
    const w: Record<string, number> = {};
    for (const h of client.holdings) {
      w[h.ticker.toUpperCase()] = h.weight;
    }
    currentMix = computeAssetMixFromWeights(w);
    // Cash holdings may map to "other"/cash via universe — also fold cash asset_class
    for (const h of client.holdings) {
      if (h.asset_class === "cash" || h.ticker.toUpperCase() === "CASH") {
        currentMix.cash = (currentMix.cash ?? 0) + h.weight;
      }
    }
  } else if (!singleTrack) {
    currentMix = resolveExposureMix(compare.baseResult);
  }

  const proposedMix = resolveExposureMix(
    compare.adjustedResult,
    customizedModelCode,
  );
  const mixForConcentration =
    Object.keys(currentMix).length > 0 ? currentMix : proposedMix;
  let maxClassPct = 0;
  let maxClassKey = "";
  for (const [cls, w] of Object.entries(mixForConcentration)) {
    if (w > maxClassPct) {
      maxClassPct = w;
      maxClassKey = cls;
    }
  }
  const maxSingle =
    needs?.max_single_name_actual ??
    Math.max(
      0,
      ...Object.values(adjCand?.weights ?? {}).map((w) => Number(w) || 0),
    );
  const concentrationLabel = `${t("slides.s2.concentration")}: ${assetClassLabel(t, maxClassKey || "other")} ${fmtPctDisplay(maxClassPct)} · ${t("slides.s2.singleName")} ${fmtPctDisplay(maxSingle)}`;

  slides.push({
    id: "goals-diagnosis",
    kind: "goals",
    titleKey: "slides.s2.title",
    goal,
    horizon,
    maxDrawdown: maxDd,
    targetReturn,
    targetReturnIsReference,
    driftLabel,
    concentrationLabel,
    necessity: t("slides.s2.necessity"),
  });

  // —— S3 market ——
  const stance = overlay?.market_view.stance;
  const stanceLabel = stance
    ? (() => {
        const key = `regime.${stance}`;
        const val = t(key);
        return val === key ? stance : val;
      })()
    : null;
  const narrative =
    overlay?.market_view.narrative_summary?.trim() ||
    t("proposal.body.market", {
      customized: compare.customizedLabel,
      anchor: compare.anchorLabel,
    });

  slides.push({
    id: "market-strategy",
    kind: "market",
    titleKey: "slides.s3.title",
    stanceLabel,
    narrative,
    themes: overlay?.market_view.themes ?? [],
    bullets: talkingPoints.slice(0, 3),
  });

  // —— S4 allocation compare ——
  const classKeys = new Set([
    ...Object.keys(currentMix),
    ...Object.keys(proposedMix),
    ...ASSET_CLASSES,
    "cash",
    "other",
  ]);
  const allocationRows = [...classKeys]
    .map((cls) => {
      const currentPct = singleTrack
        ? null
        : Object.keys(currentMix).length
          ? (currentMix[cls] ?? 0) * 100
          : null;
      const proposedPct = (proposedMix[cls] ?? 0) * 100;
      if (
        (currentPct == null || Math.abs(currentPct) < 0.05) &&
        Math.abs(proposedPct) < 0.05
      ) {
        return null;
      }
      const deltaPp =
        currentPct == null ? null : proposedPct - currentPct;
      const amountLabel =
        notional != null
          ? formatUsd((notional * proposedPct) / 100, lang)
          : placeholder;
      return {
        cls,
        label: assetClassLabel(t, cls),
        currentPct,
        proposedPct,
        deltaPp,
        amountLabel,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null)
    .sort((a, b) => b.proposedPct - a.proposedPct);

  // Pure cash book: show 100% cash current
  if (
    !singleTrack &&
    client?.holdings?.length &&
    client.holdings.every(
      (h) =>
        h.asset_class === "cash" || h.ticker.toUpperCase() === "CASH",
    ) &&
    !allocationRows.some((r) => r.cls === "cash" && (r.currentPct ?? 0) > 50)
  ) {
    allocationRows.unshift({
      cls: "cash",
      label: assetClassLabel(t, "cash"),
      currentPct: 100,
      proposedPct: (proposedMix.cash ?? 0) * 100,
      deltaPp: (proposedMix.cash ?? 0) * 100 - 100,
      amountLabel:
        notional != null
          ? formatUsd(notional * (proposedMix.cash ?? 0), lang)
          : placeholder,
    });
  }

  const totalProposed = allocationRows.reduce((s, r) => s + r.proposedPct, 0);
  const totalAmount =
    notional != null ? formatUsd(notional, lang) : placeholder;

  slides.push({
    id: "allocation-compare",
    kind: "asset-class-compare",
    titleKey: "slides.s4.title",
    columns: {
      current: singleTrack ? null : t("slides.s4.current"),
      proposed: t("slides.s4.proposed"),
    },
    rows: allocationRows,
    totalLabel: t("proposal.table.total"),
    totalAmount:
      Math.abs(totalProposed - 100) < 1.5
        ? totalAmount
        : notional != null
          ? formatUsd((notional * totalProposed) / 100, lang)
          : placeholder,
    footnote:
      !client?.holdings?.length && !singleTrack
        ? t("slides.s4.anchorFootnote")
        : undefined,
  });

  // —— S5 metrics ——
  const start = compare.adjustedRequest.start_date ?? "";
  const end = compare.adjustedRequest.end_date ?? "";
  const metricTable: ProposalMetricTableRow[] = metrics.map(
    (m: MetricCompareRow) => ({
      label: m.label,
      anchor: singleTrack ? null : m.anchorDisplay,
      customized: m.customizedDisplay,
      delta: singleTrack ? null : m.deltaDisplay,
    }),
  );

  slides.push({
    id: "backtest-metrics",
    kind: "metrics",
    titleKey: "slides.s5.title",
    periodLabel: t("slides.s5.period", { start, end }),
    metrics: metricTable,
    chartData: singleTrack ? null : chartData,
    anchorLabel: singleTrack ? null : compare.anchorLabel,
    customizedLabel: compare.customizedLabel,
    singleTrack,
  });

  // —— S6 stress (conditional) ——
  const baseChamp = pickCandidate(compare.baseResult);
  const adjEpisodes = [...(adjCand?.analytics?.drawdown_episodes ?? [])]
    .sort((a, b) => a.depth - b.depth)
    .slice(0, 3);
  const baseEpisodes = [...(baseChamp?.analytics?.drawdown_episodes ?? [])]
    .sort((a, b) => a.depth - b.depth)
    .slice(0, 3);
  const adjScenarios = adjCand?.analytics?.stress_scenarios ?? [];
  const baseScenarios = baseChamp?.analytics?.stress_scenarios ?? [];
  const hasEpisodes = adjEpisodes.length > 0;
  const hasScenarios = adjScenarios.some(
    (s) => s.depth != null && Number.isFinite(s.depth),
  );

  if (hasEpisodes || hasScenarios) {
    const episodes = adjEpisodes.map((ep, i) => {
      const anchorEp = singleTrack ? null : baseEpisodes[i];
      const window = `${ep.start}→${ep.trough || ep.end}`;
      return {
        window,
        anchorDepth: singleTrack
          ? null
          : depthDisplay(anchorEp?.depth, t),
        customizedDepth: depthDisplay(ep.depth, t),
        deltaLabel: singleTrack
          ? placeholder
          : defenseDelta(anchorEp?.depth, ep.depth, t),
      };
    });

    const scenarioIds = ["2008", "2020", "2022"] as const;
    const scenarios = scenarioIds.map((id) => {
      const adj = adjScenarios.find((s) => s.id === id);
      const base = baseScenarios.find((s) => s.id === id);
      const label = scenarioLabel(id, adj?.label ?? id, t);
      return {
        scenario: label,
        anchorDepth: singleTrack ? null : depthDisplay(base?.depth ?? null, t),
        customizedDepth: depthDisplay(adj?.depth ?? null, t),
        deltaLabel: singleTrack
          ? placeholder
          : defenseDelta(base?.depth ?? null, adj?.depth ?? null, t),
      };
    });

    slides.push({
      id: "stress-review",
      kind: "stress",
      titleKey: "slides.s6.title",
      honestyNote: t("slides.s6.honesty"),
      episodesTitle: t("slides.s6.blockA"),
      episodes: hasEpisodes ? episodes : [],
      scenariosTitle: t("slides.s6.blockB"),
      scenarios: hasScenarios || hasEpisodes ? scenarios : [],
      singleTrack,
    });
  }

  // —— S7 trades ——
  const sells: TradeRow[] = [];
  const buys: TradeRow[] = [];
  for (const row of holdingsDiff) {
    if (row.change !== "removed" && row.change !== "decreased") continue;
    const absPct = Math.abs(row.deltaPct);
    sells.push({
      ticker: row.ticker,
      name: resolveTickerDisplayName(row.ticker, lang),
      isin: resolveIsin(row.ticker),
      rr: placeholder,
      weightPct: absPct,
      amountLabel:
        notional != null
          ? formatUsd((notional * absPct) / 100, lang)
          : placeholder,
      reason: t("slides.s7.reason.sell"),
    });
  }
  for (const row of holdingsDiff) {
    if (row.change !== "added" && row.change !== "increased") continue;
    const absPct = Math.abs(row.deltaPct);
    buys.push({
      ticker: row.ticker,
      name: resolveTickerDisplayName(row.ticker, lang),
      isin: resolveIsin(row.ticker),
      rr: placeholder,
      weightPct: absPct,
      amountLabel:
        notional != null
          ? formatUsd((notional * absPct) / 100, lang)
          : placeholder,
      reason: t("slides.s7.reason.buy"),
    });
  }

  slides.push({
    id: "trade-list",
    kind: "trade-list",
    titleKey: "slides.s7.title",
    sells,
    buys,
    emptyLabel:
      sells.length === 0 && buys.length === 0
        ? t("slides.s7.none")
        : undefined,
    pendingDataNote: t("slides.s7.pendingData"),
  });

  // —— S8 cost ——
  const turnover =
    typeof adjCand?.turnover_total === "number" &&
    Number.isFinite(adjCand.turnover_total)
      ? adjCand.turnover_total
      : turnoverFromDiff(holdingsDiff);

  const sellNotionalFrac =
    sells.reduce((s, r) => s + r.weightPct, 0) / 100;
  const buyNotionalFrac = buys.reduce((s, r) => s + r.weightPct, 0) / 100;
  let totalCost: number | null = null;
  if (notional != null) {
    const redeemCost =
      notional * sellNotionalFrac * (REDEMPTION_FEE_BPS / 10_000);
    const subCost =
      notional * buyNotionalFrac * (SUBSCRIPTION_FEE_BPS / 10_000);
    // If no buy/sell split, fall back to turnover × average bps
    if (sells.length === 0 && buys.length === 0 && turnover != null) {
      const avgBps = (SUBSCRIPTION_FEE_BPS + REDEMPTION_FEE_BPS) / 2;
      totalCost = notional * turnover * (avgBps / 10_000);
    } else {
      totalCost = redeemCost + subCost;
    }
  }

  slides.push({
    id: "cost-estimate",
    kind: "cost",
    titleKey: "slides.s8.title",
    turnoverLabel:
      turnover != null
        ? `${fmtPctDisplay(turnover, 1)}`
        : placeholder,
    feeLabel: t("slides.s8.feeSplit", {
      subBps: SUBSCRIPTION_FEE_BPS,
      redBps: REDEMPTION_FEE_BPS,
    }),
    totalCostLabel:
      totalCost != null ? formatUsd(totalCost, lang) : placeholder,
    costPctLabel:
      totalCost != null && notional != null && notional > 0
        ? fmtPctDisplay(totalCost / notional, 2)
        : placeholder,
    assumptionNote: t("slides.s8.assumption", {
      subBps: SUBSCRIPTION_FEE_BPS,
      redBps: REDEMPTION_FEE_BPS,
    }),
    benefitNote: t("slides.s8.benefit"),
  });

  // —— S9 monitoring ——
  slides.push({
    id: "monitoring",
    kind: "bullets",
    titleKey: "slides.s9.title",
    bullets: [
      t("slides.s9.driftAlert"),
      t("slides.s9.review"),
      t("slides.s9.event"),
    ],
  });

  // —— S10 signoff ——
  slides.push({
    id: "compliance-signoff",
    kind: "signoff",
    titleKey: "slides.s10.title",
    warnings: [
      t("proposal.warning.pastPerformance"),
      t("proposal.warning.valueFluctuation"),
      t("proposal.warning.currency"),
      t("proposal.warning.estimates"),
      t("proposal.warning.noAdvice"),
    ],
    signees: [
      { role: t("slides.s10.rm"), name: preparedBy },
      { role: t("slides.s10.supervisor") },
      { role: t("slides.s10.client") },
    ],
    ackNote: t("slides.s10.ack"),
  });

  return slides;
}

import {
  formatUsd,
  localizedText,
  type DemoClient,
} from "@/lib/clients";
import {
  esgPreferenceLabel,
  riskProfileLabel,
  type Lang,
  type TFn,
} from "@/lib/i18n";
import {
  getAssetManagerLabel,
  getPortfolioLabel,
  type ModelPortfolio,
} from "@/lib/model-portfolios";
import { formatOverlaySummary } from "@/lib/overlay-schema";
import type { ClientOverlay } from "@/lib/overlay-schema";
import {
  buildBenchmarkCompareChartData,
  buildHoldingsDiff,
  buildMetricCompareRows,
  buildTalkingPoints,
  type BenchmarkCompareChartRow,
  type HoldingDiffRow,
  type MetricCompareRow,
} from "@/lib/rm-report-utils";
import { resolveRunObjective } from "@/lib/resolve-run-objective";
import { resolveChampionCandidateIndex } from "@/lib/performance-compare-chart";
import type { RmCandidatePick } from "@/lib/rm-report-utils";
import { resolveTickerDisplayName } from "@/lib/ticker-display-name";
import type { PersonalizationCompare } from "@/lib/types";

export type ProposalKvRow = { label: string; value: string };

export type ProposalAllocationRow = {
  ticker: string;
  name: string;
  weightPct: number;
  monetaryLabel: string;
};

export type ProposalMetricTableRow = {
  label: string;
  anchor: string;
  customized: string;
  delta: string;
};

export type ProposalHoldingDiffRow = {
  ticker: string;
  name: string;
  anchorPct: number;
  customizedPct: number;
  deltaPct: number;
  changeLabel: string;
};

export type ProposalSection =
  | {
      id: string;
      titleKey: string;
      kind: "narrative";
      paragraphs: string[];
      bullets?: string[];
    }
  | {
      id: string;
      titleKey: string;
      kind: "profile";
      rows: ProposalKvRow[];
      notes?: string[];
    }
  | {
      id: string;
      titleKey: string;
      kind: "holdings";
      rows: ProposalAllocationRow[];
      footnote?: string;
    }
  | {
      id: string;
      titleKey: string;
      kind: "allocation";
      rows: ProposalAllocationRow[];
      totalLabel: string;
      totalMonetary: string;
      footnote?: string;
    }
  | {
      id: string;
      titleKey: string;
      kind: "talking";
      bullets: string[];
    }
  | {
      id: string;
      titleKey: string;
      kind: "performance";
      metrics: ProposalMetricTableRow[];
      riskNote: string;
      validationNote: string;
      chartCaption: string;
      chartData: BenchmarkCompareChartRow[] | null;
      holdingChanges: ProposalHoldingDiffRow[];
    }
  | {
      id: string;
      titleKey: string;
      kind: "implementation";
      bullets: string[];
    }
  | {
      id: string;
      titleKey: string;
      kind: "disclaimers";
      warnings: string[];
      bullets: string[];
    };

export type ProposalDocument = {
  cover: {
    brand: string;
    docTitle: string;
    clientName: string;
    preparedBy: string;
    firmName: string;
    dateLabel: string;
    confidential: string;
    investmentAmount: string;
    strategyLine: string;
  };
  letter: string[];
  toc: { id: string; titleKey: string }[];
  sections: ProposalSection[];
};

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

function changeLabel(
  change: HoldingDiffRow["change"],
  t: TFn,
): string {
  const keys: Record<HoldingDiffRow["change"], string> = {
    added: "rm.holdings.added",
    removed: "rm.holdings.removed",
    increased: "rm.holdings.increased",
    decreased: "rm.holdings.decreased",
    unchanged: "rm.holdings.unchanged",
  };
  return t(keys[change]);
}

function investmentNotional(client: DemoClient | null): number | null {
  if (!client) return null;
  if (client.cash_usd > 0 && client.cash_usd >= client.aum_usd * 0.5) {
    return client.cash_usd;
  }
  return client.aum_usd > 0 ? client.aum_usd : null;
}

function customizedWeightMap(
  compare: PersonalizationCompare,
  holdingsDiff: HoldingDiffRow[],
  customizedModelCode?: string | null,
): Record<string, number> {
  const candidates = compare.adjustedResult.candidates;
  const picked = customizedModelCode
    ? candidates.find(
        (c) =>
          (c.model_code ?? "").toUpperCase() ===
          customizedModelCode.toUpperCase(),
      )
    : null;
  const idx = resolveChampionCandidateIndex(
    candidates,
    compare.adjustedResult.narrative_facts,
  );
  const champ =
    picked ?? (idx >= 0 ? candidates[idx] : candidates[0]);
  const fromChamp = champ?.weights;
  if (fromChamp && Object.keys(fromChamp).length) {
    const out: Record<string, number> = {};
    for (const [ticker, w] of Object.entries(fromChamp)) {
      if (w > 0.0005) out[ticker.toUpperCase()] = w * 100;
    }
    return out;
  }
  const out: Record<string, number> = {};
  for (const h of holdingsDiff) {
    if (h.customizedPct > 0.05) out[h.ticker] = h.customizedPct;
  }
  return out;
}

function buildAllocationRows(
  compare: PersonalizationCompare,
  holdingsDiff: HoldingDiffRow[],
  notional: number | null,
  lang: Lang,
  customizedModelCode?: string | null,
): ProposalAllocationRow[] {
  const weights = customizedWeightMap(
    compare,
    holdingsDiff,
    customizedModelCode,
  );
  return Object.entries(weights)
    .filter(([, pct]) => pct > 0.05)
    .sort((a, b) => b[1] - a[1])
    .map(([ticker, weightPct]) => {
      const name = resolveTickerDisplayName(ticker);
      const monetaryLabel =
        notional != null
          ? formatUsd((notional * weightPct) / 100, lang)
          : "—";
      return { ticker, name, weightPct, monetaryLabel };
    });
}

function clientHoldingRows(
  client: DemoClient | null,
  lang: Lang,
): ProposalAllocationRow[] {
  if (!client?.holdings?.length) return [];
  const notional = investmentNotional(client);
  return client.holdings.map((h) => ({
    ticker: h.ticker,
    name: h.name || resolveTickerDisplayName(h.ticker),
    weightPct: h.weight * 100,
    monetaryLabel:
      notional != null
        ? formatUsd(notional * h.weight, lang)
        : "—",
  }));
}

function profileRows(input: {
  client: DemoClient | null;
  overlay: ClientOverlay | null;
  lang: Lang;
  t: TFn;
}): ProposalKvRow[] {
  const { client, overlay, lang, t } = input;
  const rows: ProposalKvRow[] = [];

  if (client) {
    rows.push({
      label: t("proposal.field.client"),
      value: localizedText(client.display_name, lang),
    });
    rows.push({
      label: t("proposal.field.segment"),
      value: client.segment,
    });
    rows.push({
      label: t("proposal.field.age"),
      value: String(client.age),
    });
    rows.push({
      label: t("proposal.field.risk"),
      value: riskProfileLabel(t, client.risk_profile),
    });
    rows.push({
      label: t("proposal.field.horizon"),
      value: localizedText(client.investment_horizon, lang),
    });
    rows.push({
      label: t("proposal.field.aum"),
      value: formatUsd(client.aum_usd, lang),
    });
    rows.push({
      label: t("proposal.field.cash"),
      value: formatUsd(client.cash_usd, lang),
    });
    rows.push({
      label: t("proposal.field.liquidity"),
      value: localizedText(client.liquidity_notes, lang),
    });
    if (client.preferences.esg) {
      rows.push({
        label: t("proposal.field.esg"),
        value: esgPreferenceLabel(t, client.preferences.esg),
      });
    }
  }

  const cp = overlay?.client_profile;
  if (cp?.risk_tolerance && !client) {
    rows.push({
      label: t("proposal.field.risk"),
      value: riskProfileLabel(t, cp.risk_tolerance),
    });
  }
  if (cp?.investment_horizon_years) {
    rows.push({
      label: t("proposal.field.horizonYears"),
      value: t("proposal.field.years", {
        n: cp.investment_horizon_years,
      }),
    });
  }
  if (cp?.liquidity_need?.within_months || cp?.liquidity_need?.amount_usd) {
    const parts: string[] = [];
    if (cp.liquidity_need.within_months) {
      parts.push(
        t("proposal.field.withinMonths", {
          n: cp.liquidity_need.within_months,
        }),
      );
    }
    if (cp.liquidity_need.amount_usd) {
      parts.push(formatUsd(cp.liquidity_need.amount_usd, lang));
    }
    rows.push({
      label: t("proposal.field.overlayLiquidity"),
      value: parts.join(" · "),
    });
  }
  if (overlay?.optimization.objective) {
    rows.push({
      label: t("proposal.field.objective"),
      value: String(overlay.optimization.objective),
    });
  }
  if (overlay?.market_view.stance) {
    rows.push({
      label: t("proposal.field.marketStance"),
      value: `${overlay.market_view.stance} — ${overlay.market_view.narrative_summary}`,
    });
  }

  if (!rows.length) {
    rows.push({
      label: t("proposal.field.profile"),
      value: t("proposal.body.profileFallback"),
    });
  }
  return rows;
}

/** Build a private-bank style Investment Proposal document from JASPER run data. */
export function buildInvestmentProposalDocument(input: {
  compare: PersonalizationCompare;
  overlay: ClientOverlay | null;
  anchorPortfolio: ModelPortfolio;
  client: DemoClient | null;
  lang: Lang;
  t: TFn;
  customizedModelCode?: string | null;
}): ProposalDocument {
  const {
    compare,
    overlay,
    anchorPortfolio,
    client,
    lang,
    t,
    customizedModelCode,
  } = input;
  const pick: RmCandidatePick | undefined = customizedModelCode
    ? { customizedModelCode }
    : undefined;

  const metrics = buildMetricCompareRows(
    compare.baseResult,
    compare.adjustedResult,
    {
      cagr: t("compare.metric.cagr"),
      sharpe: t("compare.metric.sharpe"),
      mdd: t("compare.metric.mdd"),
      vol: t("compare.metric.vol"),
    },
    pick,
  );
  const holdingsDiff = buildHoldingsDiff(
    compare.baseResult,
    compare.adjustedResult,
    anchorPortfolio.holdings,
    pick,
  );
  const chartData = buildBenchmarkCompareChartData(
    compare.baseResult,
    compare.adjustedResult,
    pick,
  );
  const talkingPoints = buildTalkingPoints({
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

  const amLabel = getAssetManagerLabel(anchorPortfolio, lang);
  const themeLabel = getPortfolioLabel(anchorPortfolio, lang);
  const strategyLine = t("proposal.cover.strategyLine", {
    am: amLabel,
    theme: themeLabel,
    customized: compare.customizedLabel,
  });

  const clientName = client
    ? localizedText(client.display_name, lang)
    : t("proposal.cover.clientFallback");
  const preparedBy =
    overlay?.audit.rm_sign_off?.rm_id ||
    client?.rm_owner ||
    t("proposal.cover.rmFallback");
  const dateLabel = formatProposalDate(
    overlay?.audit.rm_sign_off?.signed_at,
    lang,
  );
  const notional = investmentNotional(client);
  const investmentAmount =
    notional != null
      ? formatUsd(notional, lang)
      : t("proposal.cover.amountPending");

  const allocationRows = buildAllocationRows(
    compare,
    holdingsDiff,
    notional,
    lang,
    customizedModelCode,
  );
  const currentRows = clientHoldingRows(client, lang);
  const metricTable: ProposalMetricTableRow[] = metrics.map((m: MetricCompareRow) => ({
    label: m.label,
    anchor: m.anchorDisplay,
    customized: m.customizedDisplay,
    delta: m.deltaDisplay,
  }));

  const cagr = metrics.find((m) => m.key === "cagr");
  const mdd = metrics.find((m) => m.key === "mdd");

  const overlayLines = overlay
    ? formatOverlaySummary(overlay, lang).split("\n").filter(Boolean)
    : [];

  const execParagraphs = [
    t("proposal.body.letterIntro", {
      client: clientName,
      amount: investmentAmount,
      am: amLabel,
      theme: themeLabel,
    }),
    t("proposal.body.executive", {
      anchor: compare.anchorLabel,
      customized: compare.customizedLabel,
    }),
  ];
  if (cagr && mdd) {
    execParagraphs.push(
      t("rm.report.metricsSummary", {
        cagrDelta: cagr.deltaDisplay,
        mddDelta: mdd.deltaDisplay,
        anchor: compare.anchorLabel,
      }),
    );
  }
  if (overlayLines[0]) execParagraphs.push(overlayLines[0]);

  const letter = [
    t("proposal.letter.dear", { client: clientName }),
    t("proposal.letter.thanks", {
      amount: investmentAmount,
      strategy: `${amLabel} · ${themeLabel}`,
    }),
    t("proposal.letter.recommend", {
      customized: compare.customizedLabel,
      anchor: compare.anchorLabel,
    }),
    t("proposal.letter.close"),
    preparedBy,
  ];

  const totalWeight = allocationRows.reduce((s, r) => s + r.weightPct, 0);
  const totalMonetary =
    notional != null
      ? formatUsd(notional * (totalWeight / 100), lang)
      : "—";

  const holdingChanges: ProposalHoldingDiffRow[] = holdingsDiff
    .filter((h) => h.change === "added" || Math.abs(h.deltaPct) >= 3)
    .slice(0, 8)
    .map((h) => ({
      ticker: h.ticker,
      name: resolveTickerDisplayName(h.ticker),
      anchorPct: h.anchorPct,
      customizedPct: h.customizedPct,
      deltaPct: h.deltaPct,
      changeLabel: changeLabel(h.change, t),
    }));

  const implBullets = [
    t("proposal.body.implDca"),
    t("proposal.body.implRebalance", {
      start: compare.adjustedRequest.start_date,
      end: compare.adjustedRequest.end_date,
    }),
    t("proposal.body.implLiquidity"),
    t("proposal.body.impl1"),
    t("proposal.body.impl2"),
    t("proposal.body.impl3"),
  ];
  if (client) {
    implBullets.unshift(
      t("proposal.body.implClientLiquidity", {
        note: localizedText(client.liquidity_notes, lang),
      }),
    );
  }

  const profileNotes: string[] = [];
  if (client) {
    profileNotes.push(localizedText(client.notes, lang));
  }
  if (overlay?.rationale) profileNotes.push(overlay.rationale);
  if (overlay?.audit.rm_sign_off?.note) {
    profileNotes.push(
      t("proposal.body.signOffNote", {
        note: overlay.audit.rm_sign_off.note,
      }),
    );
  }

  const sections: ProposalSection[] = [
    {
      id: "executive",
      titleKey: "proposal.section.executive",
      kind: "narrative",
      paragraphs: execParagraphs,
      bullets: talkingPoints.slice(0, 3),
    },
    {
      id: "profile",
      titleKey: "proposal.section.profile",
      kind: "profile",
      rows: profileRows({ client, overlay, lang, t }),
      notes: profileNotes.filter(Boolean),
    },
    {
      id: "current",
      titleKey: "proposal.section.current",
      kind: "holdings",
      rows: currentRows.length
        ? currentRows
        : [
            {
              ticker: "—",
              name: t("proposal.body.currentAnchor", {
                anchor: `${amLabel} · ${themeLabel}`,
              }),
              weightPct: 100,
              monetaryLabel: investmentAmount,
            },
          ],
      footnote: t("proposal.body.currentFootnote", {
        asOf: client?.as_of_date ?? dateLabel,
      }),
    },
    {
      id: "strategy",
      titleKey: "proposal.section.strategy",
      kind: "narrative",
      paragraphs: [
        t("proposal.body.strategyAnchor", {
          am: amLabel,
          theme: themeLabel,
          risk: anchorPortfolio.risk_level,
        }),
        t("proposal.body.strategyCustomize", {
          customized: compare.customizedLabel,
          anchor: compare.anchorLabel,
        }),
        ...(overlayLines.slice(0, 2)),
      ],
      bullets: [
        ...(overlay?.universe.prompts?.length
          ? overlay.universe.prompts
          : []),
        ...(overlay?.universe.exclude_tickers?.length
          ? [
              t("proposal.body.excludes", {
                tickers: overlay.universe.exclude_tickers.join(", "),
              }),
            ]
          : []),
        overlay?.optimization.objective
          ? t("proposal.body.objectiveLine", {
              objective: overlay.optimization.objective,
            })
          : t("proposal.body.constructionFallback", {
              start: compare.adjustedRequest.start_date,
              end: compare.adjustedRequest.end_date,
              objective: String(compare.adjustedRequest.objective ?? "—"),
            }),
      ],
    },
    {
      id: "allocation",
      titleKey: "proposal.section.allocation",
      kind: "allocation",
      rows: allocationRows.length
        ? allocationRows
        : [
            {
              ticker: "—",
              name: t("proposal.body.allocationFallback"),
              weightPct: 0,
              monetaryLabel: "—",
            },
          ],
      totalLabel: t("proposal.table.total"),
      totalMonetary,
      footnote: t("proposal.body.allocationFootnote"),
    },
    {
      id: "rationale",
      titleKey: "proposal.section.rationale",
      kind: "talking",
      bullets: talkingPoints.length
        ? talkingPoints
        : [
            t("proposal.body.market", {
              customized: compare.customizedLabel,
              anchor: compare.anchorLabel,
            }),
          ],
    },
    {
      id: "performance",
      titleKey: "proposal.section.performance",
      kind: "performance",
      metrics: metricTable,
      riskNote: mdd
        ? t("proposal.body.riskMdd", {
            customized: mdd.customizedDisplay,
            anchor: mdd.anchorDisplay,
          })
        : t("proposal.body.riskFallback"),
      validationNote: t("proposal.body.validationNote"),
      chartCaption: t("proposal.body.chartCaption", {
        start: compare.adjustedRequest.start_date,
        end: compare.adjustedRequest.end_date,
      }),
      chartData,
      holdingChanges,
    },
    {
      id: "implementation",
      titleKey: "proposal.section.implementation",
      kind: "implementation",
      bullets: implBullets,
    },
    {
      id: "disclaimers",
      titleKey: "proposal.section.disclaimers",
      kind: "disclaimers",
      warnings: [
        t("proposal.warning.pastPerformance"),
        t("proposal.warning.valueFluctuation"),
        t("proposal.warning.currency"),
        t("proposal.warning.estimates"),
        t("proposal.warning.noAdvice"),
      ],
      bullets: [
        t("proposal.body.disclaimer1"),
        t("proposal.body.disclaimer2"),
        t("proposal.body.disclaimerSuitability"),
        t("rm.report.disclaimerBody"),
        t("proposal.body.nextSteps"),
      ],
    },
  ];

  return {
    cover: {
      brand: "JASPER",
      docTitle: t("proposal.cover.docTitle"),
      clientName,
      preparedBy,
      firmName: t("proposal.cover.firm"),
      dateLabel,
      confidential: t("proposal.cover.confidential"),
      investmentAmount,
      strategyLine,
    },
    letter,
    toc: sections.map((s) => ({ id: s.id, titleKey: s.titleKey })),
    sections,
  };
}

/** @deprecated Prefer buildInvestmentProposalDocument for rich layout. */
export type ProposalSectionLegacy = {
  id: string;
  titleKey: string;
  body: string[];
};

/** @deprecated Prefer buildInvestmentProposalDocument. */
export function buildInvestmentProposalSections(input: {
  compare: PersonalizationCompare;
  overlay: ClientOverlay | null;
  anchorPortfolio: ModelPortfolio;
  lang: Lang;
  t: TFn;
  client?: DemoClient | null;
}): ProposalSectionLegacy[] {
  const doc = buildInvestmentProposalDocument({
    ...input,
    client: input.client ?? null,
  });
  return doc.sections.map((section, index) => {
    const body: string[] = [];
    switch (section.kind) {
      case "narrative":
        body.push(...section.paragraphs, ...(section.bullets ?? []));
        break;
      case "profile":
        body.push(
          ...section.rows.map((r) => `${r.label}: ${r.value}`),
          ...(section.notes ?? []),
        );
        break;
      case "holdings":
      case "allocation":
        body.push(
          ...section.rows.map(
            (r) =>
              `${r.ticker} (${r.name}): ${r.weightPct.toFixed(1)}% · ${r.monetaryLabel}`,
          ),
        );
        break;
      case "talking":
      case "implementation":
        body.push(...section.bullets);
        break;
      case "performance":
        body.push(
          ...section.metrics.map(
            (m) =>
              `${m.label}: ${m.anchor} → ${m.customized} (${m.delta})`,
          ),
          section.riskNote,
          section.validationNote,
        );
        break;
      case "disclaimers":
        body.push(...section.warnings, ...section.bullets);
        break;
    }
    return {
      id: String(index + 1),
      titleKey: section.titleKey,
      body,
    };
  });
}

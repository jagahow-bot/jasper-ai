import { formatOverlaySummary } from "@/lib/overlay-schema";
import type { ClientOverlay } from "@/lib/overlay-schema";
import {
  getPortfolioLabel,
  type ModelPortfolio,
} from "@/lib/model-portfolios";
import type { Lang } from "@/lib/i18n";
import {
  buildHoldingsDiff,
  buildMetricCompareRows,
} from "@/lib/rm-report-utils";
import { resolveTickerDisplayName } from "@/lib/ticker-display-name";
import type { PersonalizationCompare } from "@/lib/types";

export type ProposalSection = {
  id: string;
  titleKey: string;
  body: string[];
};

type TranslateFn = (key: string, params?: Record<string, string | number>) => string;

export function buildInvestmentProposalSections(input: {
  compare: PersonalizationCompare;
  overlay: ClientOverlay | null;
  anchorPortfolio: ModelPortfolio;
  lang: Lang;
  t: TranslateFn;
}): ProposalSection[] {
  const { compare, overlay, anchorPortfolio, lang, t } = input;
  const metrics = buildMetricCompareRows(
    compare.baseResult,
    compare.adjustedResult,
    {
      cagr: t("compare.metric.cagr"),
      sharpe: t("compare.metric.sharpe"),
      mdd: t("compare.metric.mdd"),
      vol: t("compare.metric.vol"),
    },
  );
  const holdings = buildHoldingsDiff(
    compare.baseResult,
    compare.adjustedResult,
    anchorPortfolio.holdings,
  );
  const overlayLines = overlay
    ? formatOverlaySummary(overlay, lang).split("\n").filter(Boolean)
    : [t("rm.report.noOverlaySummary")];
  const anchorName = getPortfolioLabel(anchorPortfolio, lang);
  const cagr = metrics.find((m) => m.key === "cagr");
  const mdd = metrics.find((m) => m.key === "mdd");
  const sharpe = metrics.find((m) => m.key === "sharpe");

  const topHoldings = holdings
    .filter((h) => h.customizedPct > 0.1)
    .slice(0, 8)
    .map(
      (h) =>
        `${h.ticker} (${resolveTickerDisplayName(h.ticker)}): ${h.customizedPct.toFixed(1)}%`,
    );

  const constraints: string[] = [];
  if (overlay?.universe.prompts?.length) {
    constraints.push(...overlay.universe.prompts);
  }
  if (overlay?.universe.exclude_tickers?.length) {
    constraints.push(
      t("proposal.body.excludes", {
        tickers: overlay.universe.exclude_tickers.join(", "),
      }),
    );
  }
  if (overlay?.optimization.objective) {
    constraints.push(
      t("proposal.body.objectiveLine", {
        objective: overlay.optimization.objective,
      }),
    );
  }
  if (overlay?.rationale) {
    constraints.push(overlay.rationale);
  }
  if (overlay?.audit.rm_sign_off?.note) {
    constraints.push(overlay.audit.rm_sign_off.note);
  }

  return [
    {
      id: "1",
      titleKey: "proposal.section.executive",
      body: [
        t("proposal.body.executive", {
          anchor: compare.anchorLabel,
          customized: compare.customizedLabel,
        }),
        cagr && mdd
          ? t("rm.report.metricsSummary", {
              cagrDelta: cagr.deltaDisplay,
              mddDelta: mdd.deltaDisplay,
              anchor: compare.anchorLabel,
            })
          : t("proposal.body.metricsPending"),
        ...overlayLines.slice(0, 3),
      ],
    },
    {
      id: "2",
      titleKey: "proposal.section.profile",
      body: overlayLines.length
        ? overlayLines
        : [t("proposal.body.profileFallback")],
    },
    {
      id: "3",
      titleKey: "proposal.section.current",
      body: [
        t("proposal.body.currentAnchor", { anchor: anchorName }),
        ...anchorPortfolio.holdings.map(
          (h) =>
            `${h.ticker} (${h.name || resolveTickerDisplayName(h.ticker)}): ${(
              h.weight * 100
            ).toFixed(1)}%`,
        ),
      ],
    },
    {
      id: "4",
      titleKey: "proposal.section.market",
      body: [
        t("proposal.body.market", {
          customized: compare.customizedLabel,
          anchor: compare.anchorLabel,
        }),
        ...overlayLines.slice(0, 2),
      ],
    },
    {
      id: "5",
      titleKey: "proposal.section.allocation",
      body: topHoldings.length
        ? topHoldings
        : [t("proposal.body.allocationFallback")],
    },
    {
      id: "6",
      titleKey: "proposal.section.construction",
      body: constraints.length
        ? constraints
        : [
            t("proposal.body.constructionFallback", {
              start: compare.adjustedRequest.start_date,
              end: compare.adjustedRequest.end_date,
              objective: String(compare.adjustedRequest.objective ?? "—"),
            }),
          ],
    },
    {
      id: "7",
      titleKey: "proposal.section.validation",
      body: [
        cagr
          ? `${t("compare.metric.cagr")}: ${cagr.anchorDisplay} → ${cagr.customizedDisplay} (${cagr.deltaDisplay})`
          : "",
        sharpe
          ? `${t("compare.metric.sharpe")}: ${sharpe.anchorDisplay} → ${sharpe.customizedDisplay} (${sharpe.deltaDisplay})`
          : "",
        mdd
          ? `${t("compare.metric.mdd")}: ${mdd.anchorDisplay} → ${mdd.customizedDisplay} (${mdd.deltaDisplay})`
          : "",
        t("proposal.body.validationNote"),
      ].filter(Boolean),
    },
    {
      id: "8",
      titleKey: "proposal.section.risk",
      body: [
        mdd
          ? t("proposal.body.riskMdd", {
              customized: mdd.customizedDisplay,
              anchor: mdd.anchorDisplay,
            })
          : t("proposal.body.riskFallback"),
        ...holdings
          .filter((h) => h.change === "added" || Math.abs(h.deltaPct) >= 5)
          .slice(0, 5)
          .map(
            (h) =>
              `${h.ticker}: ${h.anchorPct.toFixed(1)}% → ${h.customizedPct.toFixed(1)}% (${h.deltaPct > 0 ? "+" : ""}${h.deltaPct.toFixed(1)}%)`,
          ),
      ],
    },
    {
      id: "9",
      titleKey: "proposal.section.implementation",
      body: [
        t("proposal.body.impl1"),
        t("proposal.body.impl2"),
        t("proposal.body.impl3"),
      ],
    },
    {
      id: "10",
      titleKey: "proposal.section.disclaimers",
      body: [
        t("proposal.body.disclaimer1"),
        t("proposal.body.disclaimer2"),
        t("rm.report.disclaimerBody"),
      ],
    },
  ];
}

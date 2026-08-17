import {
  anchorHoldingsFromRequest,
  buildLockedCustomUniverse,
  isLockedModelUniverse,
  uniqueTickers,
} from "@/lib/locked-universe";
import {
  detectDirectIndexing,
  filterTickersForDirectIndex,
  pickDirectIndexStocks,
  proposedTickersForDirectIndex,
} from "@/lib/direct-indexing";
import {
  overlayToBacktestRequest,
  resolveLockedAddsForOverlay,
  type ClientOverlay,
  type OverlayProposedTicker,
  type OverlayToBacktestOptions,
} from "@/lib/overlay-schema";
import { pushLlmAuditLog, type LlmAuditEntry } from "@/lib/llm-audit";
import type { AssetClass } from "@/lib/constants";
import type { BacktestRequest } from "@/lib/types";
import { getUniverseItems } from "@/lib/universe";

type UniverseFilterResponse = {
  supplement_tickers?: string[];
  per_rule_llm_logs?: LlmAuditEntry[];
  error?: string;
};

export type ResolveOverlayUniverseResult = {
  request: BacktestRequest;
  /** AI filter matches for locked models — RM must confirm via proposed_tickers. */
  filterProposedTickers?: OverlayProposedTicker[];
};

async function fetchUniverseSupplements(
  prompts: string[],
  assetClasses: AssetClass[],
  reportLanguage: string,
): Promise<string[]> {
  const res = await fetch("/api/universe/filter", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      texts: prompts,
      asset_classes: assetClasses,
      search_full_universe: true,
      report_language: reportLanguage,
    }),
  });
  const data = (await res.json()) as UniverseFilterResponse;
  pushLlmAuditLog(data.per_rule_llm_logs);
  if (!res.ok) {
    throw new Error(data.error ?? "Universe filter failed");
  }
  return (data.supplement_tickers ?? []).filter(Boolean);
}

function mapTickersToProposed(
  tickers: readonly string[],
  rationale?: string,
): OverlayProposedTicker[] {
  const metaByTicker = new Map(
    getUniverseItems().map((u) => [u.ticker.toUpperCase(), u]),
  );
  return uniqueTickers(tickers).map((ticker) => {
    const meta = metaByTicker.get(ticker);
    return {
      ticker,
      name: meta?.name,
      category: meta?.category,
      rationale,
    };
  });
}

/**
 * Map overlay → BacktestRequest and resolve universe filter prompts via
 * /api/universe/filter so RM sign-off does not require manual RUN SEARCH.
 *
 * When the base is an anchor/model portfolio, the usable universe is strictly
 * (model holdings − excludes) ∪ explicit adds (supplement_tickers + tickers
 * literally named in prompts). NL filter matches are surfaced as
 * `filterProposedTickers` for RM confirmation — they are NOT auto-merged.
 */
export async function resolveOverlayUniverse(
  base: BacktestRequest,
  overlay: ClientOverlay,
  opts?: OverlayToBacktestOptions & {
    reportLanguage?: string;
    /**
     * When true, skip `/api/universe/filter` proposal surfacing (locked path still
     * builds the strict universe). Use when suggestions were already shown or the
     * prompts-key gate already fired once for this session.
     */
    skipFilterProposals?: boolean;
  },
): Promise<ResolveOverlayUniverseResult> {
  const reportLanguage = opts?.reportLanguage ?? "en";
  const skipFilterProposals = Boolean(opts?.skipFilterProposals);
  let req = overlayToBacktestRequest(base, overlay, opts);
  const prompts = overlay.universe.prompts.filter(Boolean);
  const lockedMode = isLockedModelUniverse(base);

  if (lockedMode) {
    const adds = resolveLockedAddsForOverlay(overlay);
    const locked = buildLockedCustomUniverse(base, {
      addTickers: adds,
      excludeTickers: overlay.universe.exclude_tickers,
    });
    const diHaystack = [
      ...prompts,
      overlay.market_view.narrative_summary,
      ...(overlay.market_view.themes ?? []),
    ].join("\n");
    const isDi =
      overlay.universe.construction === "direct_index" || detectDirectIndexing(diHaystack);

    let filterProposedTickers: OverlayProposedTicker[] | undefined;
    if (prompts.length && !skipFilterProposals) {
      try {
        const filterSupplements = await fetchUniverseSupplements(
          prompts,
          req.asset_classes,
          reportLanguage,
        );
        if (filterSupplements.length) {
          const lockedSet = new Set(locked.map((t) => t.toUpperCase()));
          const explicitAdds = new Set(
            uniqueTickers([
              ...anchorHoldingsFromRequest(base),
              ...(overlay.universe.supplement_tickers ?? []),
              ...adds,
            ]).map((t) => t.toUpperCase()),
          );
          const novel = filterSupplements.filter((t) => {
            const key = t.toUpperCase();
            return !lockedSet.has(key) && !explicitAdds.has(key);
          });
          if (isDi) {
            const lang = reportLanguage.startsWith("zh")
              ? "zh"
              : reportLanguage.startsWith("ko")
                ? "ko"
                : "en";
            const stockProposed = proposedTickersForDirectIndex(diHaystack, lang).filter(
              (p) => !lockedSet.has(p.ticker.toUpperCase()),
            );
            filterProposedTickers = stockProposed.length ? stockProposed : undefined;
          } else if (novel.length) {
            filterProposedTickers = mapTickersToProposed(novel, prompts.join("; "));
          }
        }
      } catch {
        // Keep strict locked universe when filter fails.
      }
    }

    return {
      request: {
        ...req,
        universe_tickers: locked,
        universe_supplement_tickers: locked,
        max_holdings: Math.max(locked.length, 1),
        universe_filter_prompts: prompts.length ? prompts : req.universe_filter_prompts,
        universe_filter_text: prompts.length ? prompts.join("; ") : req.universe_filter_text,
      },
      filterProposedTickers,
    };
  }

  if (!prompts.length) {
    return { request: req };
  }

  try {
    const filterSupplements = await fetchUniverseSupplements(
      prompts,
      req.asset_classes,
      reportLanguage,
    );
    if (!filterSupplements.length) {
      return { request: req };
    }

    let extras = filterSupplements;
    const diHaystack = [
      ...prompts,
      overlay.market_view.narrative_summary,
      ...(overlay.market_view.themes ?? []),
    ].join("\n");
    if (
      overlay.universe.construction === "direct_index" ||
      detectDirectIndexing(diHaystack)
    ) {
      extras = uniqueTickers([
        ...filterTickersForDirectIndex(filterSupplements),
        ...pickDirectIndexStocks(diHaystack, 8),
      ]);
    }

    req = {
      ...req,
      universe_supplement_tickers: uniqueTickers([
        ...extras,
        ...(overlay.universe.supplement_tickers ?? []),
        ...(base.universe_supplement_tickers ?? []),
      ]),
      universe_filter_prompts: prompts,
      universe_filter_text: prompts.join("; "),
    };
  } catch {
    // Keep overlayToBacktestRequest defaults (open-pool path).
  }

  return { request: req };
}

import {
  buildLockedCustomUniverse,
  isLockedModelUniverse,
  resolveStrictLockedAdds,
  uniqueTickers,
} from "@/lib/locked-universe";
import {
  overlayToBacktestRequest,
  type ClientOverlay,
  type OverlayToBacktestOptions,
} from "@/lib/overlay-schema";
import type { AssetClass } from "@/lib/constants";
import type { BacktestRequest } from "@/lib/types";

type UniverseFilterResponse = {
  supplement_tickers?: string[];
  error?: string;
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
  if (!res.ok) {
    throw new Error(data.error ?? "Universe filter failed");
  }
  return (data.supplement_tickers ?? []).filter(Boolean);
}

/**
 * Map overlay → BacktestRequest and resolve universe filter prompts via
 * /api/universe/filter so RM sign-off does not require manual RUN SEARCH.
 *
 * When the base is an anchor/model portfolio, the usable universe is strictly
 * (model holdings − excludes) ∪ explicit adds (supplement_tickers + tickers
 * literally named in prompts). NL filter / fund-pool matching is NOT used to
 * expand the locked set.
 */
export async function resolveOverlayUniverse(
  base: BacktestRequest,
  overlay: ClientOverlay,
  opts?: OverlayToBacktestOptions & { reportLanguage?: string },
): Promise<BacktestRequest> {
  const reportLanguage = opts?.reportLanguage ?? "en";
  let req = overlayToBacktestRequest(base, overlay, opts);
  const prompts = overlay.universe.prompts.filter(Boolean);
  const lockedMode = isLockedModelUniverse(base);

  if (lockedMode) {
    // Rebuild from base so prompt-named tickers are included without AI expand.
    const adds = resolveStrictLockedAdds({
      explicitSupplements: overlay.universe.supplement_tickers,
      prompts,
    });
    const locked = buildLockedCustomUniverse(base, {
      addTickers: adds,
      excludeTickers: overlay.universe.exclude_tickers,
    });
    return {
      ...req,
      universe_tickers: locked,
      universe_supplement_tickers: locked,
      max_holdings: Math.max(locked.length, 1),
      universe_filter_prompts: prompts.length ? prompts : req.universe_filter_prompts,
      universe_filter_text: prompts.length ? prompts.join("; ") : req.universe_filter_text,
    };
  }

  if (!prompts.length) {
    return req;
  }

  try {
    const filterSupplements = await fetchUniverseSupplements(
      prompts,
      req.asset_classes,
      reportLanguage,
    );
    if (!filterSupplements.length) {
      return req;
    }

    req = {
      ...req,
      universe_supplement_tickers: uniqueTickers([
        ...filterSupplements,
        ...(overlay.universe.supplement_tickers ?? []),
        ...(base.universe_supplement_tickers ?? []),
      ]),
      universe_filter_prompts: prompts,
      universe_filter_text: prompts.join("; "),
    };
  } catch {
    // Keep overlayToBacktestRequest defaults (open-pool path).
  }

  return req;
}

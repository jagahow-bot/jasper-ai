import { MAINSTREAM_DEMO_TICKERS } from "@/lib/model-portfolios";
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

function uniqueTickers(tickers: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tickers) {
    const key = t.toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function mergeSupplements(
  fromAnchorReplay: boolean,
  filterSupplements: string[],
  overlay: ClientOverlay,
  base: BacktestRequest,
): string[] {
  if (fromAnchorReplay) {
    return uniqueTickers([
      ...MAINSTREAM_DEMO_TICKERS,
      ...filterSupplements,
      ...(overlay.universe.supplement_tickers ?? []),
      ...(base.universe_supplement_tickers ?? []),
    ]);
  }
  return uniqueTickers([
    ...filterSupplements,
    ...(overlay.universe.supplement_tickers ?? []),
    ...(base.universe_supplement_tickers ?? []),
  ]);
}

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
 */
export async function resolveOverlayUniverse(
  base: BacktestRequest,
  overlay: ClientOverlay,
  opts?: OverlayToBacktestOptions & { reportLanguage?: string },
): Promise<BacktestRequest> {
  const reportLanguage = opts?.reportLanguage ?? "en";
  let req = overlayToBacktestRequest(base, overlay, opts);
  const prompts = overlay.universe.prompts.filter(Boolean);
  const fromAnchorReplay = Boolean(base.static_replay_holdings);

  if (!prompts.length) {
    return req;
  }

  try {
    const filterSupplements = await fetchUniverseSupplements(
      prompts,
      req.asset_classes,
      reportLanguage,
    );
    if (filterSupplements.length) {
      req = {
        ...req,
        universe_supplement_tickers: mergeSupplements(
          fromAnchorReplay,
          filterSupplements,
          overlay,
          base,
        ),
        universe_filter_prompts: prompts,
        universe_filter_text: prompts.join("; "),
      };
    }
  } catch {
    // Keep overlayToBacktestRequest defaults (demo pool + overlay supplements).
  }

  return req;
}

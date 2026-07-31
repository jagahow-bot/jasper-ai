import { uniqueTickers } from "@/lib/locked-universe";
import type { ClientOverlay, OverlayProposedTicker } from "@/lib/overlay-schema";

/** Fingerprint of universe prompts used to gate one-shot filter interrupts. */
export function overlayPromptsKey(overlay: ClientOverlay): string {
  return overlay.universe.prompts.filter(Boolean).join("\0");
}

/** True when the RM summary already lists suggestions (「建議參考標的」/ panel). */
export function overlayAlreadyShowsProposedTickers(overlay: ClientOverlay): boolean {
  return (overlay.universe.proposed_tickers?.length ?? 0) > 0;
}

/**
 * Filter matches not already in supplements or pending proposed_tickers.
 * These are the only candidates that should force the suggestions panel open.
 */
export function novelFilterProposedTickers(
  overlay: ClientOverlay,
  filterProposedTickers: readonly OverlayProposedTicker[] | undefined,
): OverlayProposedTicker[] {
  if (!filterProposedTickers?.length) return [];
  const existing = new Set(
    uniqueTickers([
      ...(overlay.universe.supplement_tickers ?? []),
      ...(overlay.universe.proposed_tickers?.map((p) => p.ticker) ?? []),
    ]).map((t) => t.toUpperCase()),
  );
  return filterProposedTickers.filter(
    (p) => !existing.has(p.ticker.toUpperCase()),
  );
}

export function mergeFilterProposedIntoOverlay(
  overlay: ClientOverlay,
  novel: readonly OverlayProposedTicker[],
): ClientOverlay {
  if (!novel.length) return overlay;
  return {
    ...overlay,
    universe: {
      ...overlay.universe,
      proposed_tickers: [
        ...(overlay.universe.proposed_tickers ?? []),
        ...novel,
      ].slice(0, 12),
    },
  };
}

/** Drop unconfirmed suggestions once the RM proceeds past the gate. */
export function clearProposedTickers(overlay: ClientOverlay): ClientOverlay {
  if (!overlay.universe.proposed_tickers?.length) return overlay;
  return {
    ...overlay,
    universe: {
      ...overlay.universe,
      proposed_tickers: undefined,
    },
  };
}

export type FilterProposalDecision =
  | { action: "interrupt"; overlay: ClientOverlay; promptsKey: string }
  | { action: "proceed"; overlay: ClientOverlay };

/**
 * Decide whether sign-off should pause so the RM can review filter proposals.
 *
 * Rules:
 * - Chat/AI already populated `proposed_tickers` (visible as「建議參考標的」) →
 *   confirm proceeds; do not open another filter pass for additional novels.
 * - Once we interrupted for a prompts fingerprint (`surfacedKey`), re-confirm
 *   always proceeds — even if the LLM invents new tickers.
 * - Otherwise interrupt once when the filter returns truly novel tickers.
 */
export function decideFilterProposalInterrupt(opts: {
  overlay: ClientOverlay;
  filterProposedTickers?: readonly OverlayProposedTicker[];
  /** Prompts key from a prior interrupt in this confirm session, or null. */
  surfacedKey: string | null;
}): FilterProposalDecision {
  const { overlay, filterProposedTickers, surfacedKey } = opts;
  const promptsKey = overlayPromptsKey(overlay);
  const novel = novelFilterProposedTickers(overlay, filterProposedTickers);

  // Already-shown suggestions count as the review gate being satisfied.
  if (overlayAlreadyShowsProposedTickers(overlay)) {
    return { action: "proceed", overlay: clearProposedTickers(overlay) };
  }

  if (!novel.length) {
    return { action: "proceed", overlay: clearProposedTickers(overlay) };
  }

  if (surfacedKey !== null && surfacedKey === promptsKey) {
    return { action: "proceed", overlay: clearProposedTickers(overlay) };
  }

  return {
    action: "interrupt",
    promptsKey,
    overlay: mergeFilterProposedIntoOverlay(overlay, novel),
  };
}

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
 * Finalize overlay on「確認 Overlay 並簽核」.
 *
 * Sign-off always proceeds: the chat-time ProposedTickersPanel is the only
 * suggestion-review UI. Confirm must not open another filter/propose pass
 * (even when `/api/universe/filter` returns novel tickers), or suggestions
 * reappear after the RM already clicked confirm.
 *
 * `filterProposedTickers` / `surfacedKey` are accepted for call-site
 * compatibility but never trigger an interrupt.
 */
export function decideFilterProposalInterrupt(opts: {
  overlay: ClientOverlay;
  filterProposedTickers?: readonly OverlayProposedTicker[];
  /** Prompts key from a prior interrupt in this confirm session, or null. */
  surfacedKey: string | null;
}): FilterProposalDecision {
  void opts.filterProposedTickers;
  void opts.surfacedKey;
  return { action: "proceed", overlay: clearProposedTickers(opts.overlay) };
}

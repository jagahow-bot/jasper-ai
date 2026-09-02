import {
  extractExplicitTickersFromTexts,
  uniqueTickers,
} from "@/lib/locked-universe";
import type {
  ClientOverlay,
  OverlayClarification,
  OverlayProposedTicker,
} from "@/lib/overlay-schema";

/** Known catalog tickers named in clarification questions or option chips. */
export function tickersNamedInClarifications(
  clarifications: readonly OverlayClarification[],
  proposed?: readonly OverlayProposedTicker[],
): Set<string> {
  if (!clarifications.length) return new Set();
  const texts = clarifications.flatMap((c) => [
    c.question,
    ...c.options.flatMap((o) => [o.label, o.id]),
  ]);
  const haystack = texts.join("\n").toUpperCase();
  const covered = new Set(
    extractExplicitTickersFromTexts(texts).map((t) => t.toUpperCase()),
  );
  // Symbols in proposed_tickers but absent from catalog (e.g. AIQ) still count
  // when literally named in clarification chips.
  for (const p of proposed ?? []) {
    const sym = p.ticker.toUpperCase();
    if (sym && haystack.includes(sym)) covered.add(sym);
  }
  return covered;
}

/**
 * During clarify stage, hide proposed_tickers already offered as clarification
 * choices (e.g. AIQ/BOTZ/SMH chips) so RM is not asked twice.
 */
export function proposedTickersAfterClarificationDedup(
  proposed: readonly OverlayProposedTicker[] | undefined,
  clarifications: readonly OverlayClarification[],
): OverlayProposedTicker[] {
  if (!proposed?.length) return [];
  if (!clarifications.length) return [...proposed];
  const covered = tickersNamedInClarifications(clarifications, proposed);
  if (!covered.size) return [...proposed];
  return proposed.filter((p) => !covered.has(p.ticker.toUpperCase()));
}

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

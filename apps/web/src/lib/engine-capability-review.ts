/**
 * When to surface engine capability / gap notes on the RM results audit tab.
 * Engine docs + gaps backlog stay out of primary nav; only show on a job when
 * something non-default or gap-related was actually involved.
 */

import stageCards from "@/data/stage-cards.json";
import type { ClientOverlay } from "@/lib/overlay-schema";
import type { BacktestResult } from "@/lib/types";

export const LEGACY_CATALOG_VERSION = "v0-legacy";
export const LEGACY_IMPLEMENTATIONS_MARKER = "legacy-monolith";

const DEFAULT_STAGE_IMPLEMENTATIONS = stageCards.stage_implementations as Record<
  string,
  string
>;

export function isLegacyEnginePin(result: BacktestResult): boolean {
  return (
    result.stage_catalog_version === LEGACY_CATALOG_VERSION ||
    result.stage_implementations === LEGACY_IMPLEMENTATIONS_MARKER
  );
}

export function stageImplementationsDifferFromDefault(
  impls: BacktestResult["stage_implementations"],
): boolean {
  if (impls == null) return false;
  if (typeof impls === "string") {
    return impls === LEGACY_IMPLEMENTATIONS_MARKER;
  }
  const keys = new Set([
    ...Object.keys(DEFAULT_STAGE_IMPLEMENTATIONS),
    ...Object.keys(impls),
  ]);
  for (const key of keys) {
    if ((impls[key] ?? "") !== (DEFAULT_STAGE_IMPLEMENTATIONS[key] ?? "")) {
      return true;
    }
  }
  return false;
}

export function hasEngineCapabilityReviewContent(
  result: BacktestResult,
  overlay?: ClientOverlay | null,
): boolean {
  if ((result.capabilities_used?.length ?? 0) > 0) return true;
  if (isLegacyEnginePin(result)) return true;
  if (stageImplementationsDifferFromDefault(result.stage_implementations)) {
    return true;
  }
  if ((overlay?.capability_gaps?.length ?? 0) > 0) return true;
  return false;
}

export function formatStageImplementations(
  impls: BacktestResult["stage_implementations"],
): Array<{ stage: string; label: string }> {
  if (impls == null) return [];
  if (typeof impls === "string") {
    return [{ stage: "engine", label: impls }];
  }
  return Object.entries(impls)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([stage, label]) => ({ stage, label }));
}

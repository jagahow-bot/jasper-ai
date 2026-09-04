/**
 * Overlay ↔ customization_drift slider sync (design: overlay-drift-sync.md).
 * Pure / deterministic — no React, no LLM.
 */

import {
  anchorWeightsFromPositions,
  driftOverrideApproval,
  minL1DriftForTarget,
  themeSleevePlanFromOverlay,
  type AnchorPositionLike,
} from "@/lib/overlay-feasibility";
import {
  groupWeightBandsFromOverlay,
  type ClientOverlay,
} from "@/lib/overlay-schema";

/** RmRunPanel / ConstraintsPanel slider step (5%). */
export const DRIFT_SLIDER_STEP = 0.05;

/** Conservative per-ticker drift estimate when must_include asks omit pct. */
export const MUST_INCLUDE_DRIFT_ESTIMATE = 0.01;

export type OverlayDriftSourceKind =
  | "sleeve_targets"
  | "group_weight_band"
  | "must_include"
  | "narrative";

export type OverlayDriftSource = {
  kind: OverlayDriftSourceKind;
  /** Sleeve key, ask id, or ticker (display). */
  ref: string;
  /** One-way L1 drift required by this source alone (0..1). */
  requiredDrift: number;
};

export type OverlayDriftHints = {
  minRequiredDrift: number;
  suggestedDrift: number;
  headroomDrift: number;
  feasible: boolean;
  sources: OverlayDriftSource[];
  requiresSupervisor: boolean;
  /** Normalized current slider value used for the feasible check. */
  currentDrift: number;
};

export type DriftSyncAction =
  | { kind: "none" }
  | {
      kind: "raise";
      from: number;
      to: number;
      requiresSupervisor: boolean;
    };

const ZERO_HINTS: OverlayDriftHints = {
  minRequiredDrift: 0,
  suggestedDrift: 0,
  headroomDrift: DRIFT_SLIDER_STEP,
  feasible: true,
  sources: [],
  requiresSupervisor: false,
  currentDrift: 0.5,
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function finalizeHints(
  rawMin: number,
  sources: OverlayDriftSource[],
  current: number,
): OverlayDriftHints {
  const minRequired = clamp01(rawMin);
  const suggestedDrift =
    minRequired <= 0
      ? 0
      : Math.min(
          1,
          Math.round(
            Math.ceil((minRequired - 1e-9) / DRIFT_SLIDER_STEP) *
              DRIFT_SLIDER_STEP *
              100,
          ) / 100,
        );
  const headroomDrift = Math.min(1, Math.round((suggestedDrift + DRIFT_SLIDER_STEP) * 100) / 100);
  const feasible = current + 1e-9 >= minRequired;
  const { requiresSupervisor } = driftOverrideApproval(suggestedDrift);
  const sorted = [...sources].sort((a, b) => b.requiredDrift - a.requiredDrift);
  return {
    minRequiredDrift: minRequired,
    suggestedDrift,
    headroomDrift,
    feasible,
    sources: sorted,
    requiresSupervisor,
    currentDrift: current,
  };
}

function hintsFromSleevePlan(
  anchor: Record<string, number>,
  targetSleeves: Record<string, number>,
  membership: Record<string, string[]>,
  current: number,
  kind: "sleeve_targets" | "group_weight_band",
  refForKey: (key: string) => string,
): OverlayDriftHints {
  const check = minL1DriftForTarget(
    anchor,
    targetSleeves,
    membership,
    current,
  );
  const sources: OverlayDriftSource[] = Object.keys(targetSleeves).map((key) => {
    const single = minL1DriftForTarget(
      anchor,
      { [key]: targetSleeves[key]! },
      { [key]: membership[key] ?? [] },
      current,
    );
    return {
      kind,
      ref: refForKey(key),
      requiredDrift: single.oneWayTurnover,
    };
  });
  return finalizeHints(check.oneWayTurnover, sources, current);
}

function computeMustIncludeHints(
  overlay: ClientOverlay,
  anchor: Record<string, number>,
  current: number,
): OverlayDriftHints | null {
  const anchorKeys = new Set(Object.keys(anchor));
  const sources: OverlayDriftSource[] = [];
  let total = 0;
  for (const ask of overlay.asks ?? []) {
    if (ask.kind !== "ticker_min" && ask.kind !== "direct_index") continue;
    const tickers = ask.tickers ?? [];
    if (!tickers.length) continue;
    for (const raw of tickers) {
      const ticker = String(raw || "")
        .trim()
        .toUpperCase();
      if (!ticker || anchorKeys.has(ticker)) continue;
      const w =
        ask.min_pct ?? ask.target_pct ?? MUST_INCLUDE_DRIFT_ESTIMATE;
      const clamped = clamp01(Number.isFinite(w) ? Number(w) : MUST_INCLUDE_DRIFT_ESTIMATE);
      if (clamped <= 0) continue;
      total += clamped;
      sources.push({
        kind: "must_include",
        ref: ticker,
        requiredDrift: clamped,
      });
    }
  }
  if (sources.length === 0) return null;
  return finalizeHints(Math.min(1, total), sources, current);
}

/**
 * Four-layer waterfall: sleeve_targets → group_weight_band → must_include → narrative.
 * First layer with positive demand wins (no cross-layer sum).
 */
export function computeOverlayDriftHints(
  overlay: ClientOverlay | null | undefined,
  opts: {
    anchorWeights?: Record<string, number> | null;
    anchorPositions?: AnchorPositionLike[] | null;
    currentDrift?: number;
  } = {},
): OverlayDriftHints {
  if (!overlay) {
    const current = clamp01(
      typeof opts.currentDrift === "number" && Number.isFinite(opts.currentDrift)
        ? opts.currentDrift
        : 0.5,
    );
    return { ...ZERO_HINTS, currentDrift: current };
  }

  const anchor =
    opts.anchorWeights && Object.keys(opts.anchorWeights).length > 0
      ? opts.anchorWeights
      : anchorWeightsFromPositions(opts.anchorPositions);
  if (Object.keys(anchor).length === 0) {
    const current = clamp01(
      typeof opts.currentDrift === "number" && Number.isFinite(opts.currentDrift)
        ? opts.currentDrift
        : 0.5,
    );
    return { ...ZERO_HINTS, currentDrift: current };
  }

  const current = clamp01(
    typeof opts.currentDrift === "number" && Number.isFinite(opts.currentDrift)
      ? opts.currentDrift
      : 0.5,
  );

  // Layer 1: theme sleeve_targets
  const sleevePlan = themeSleevePlanFromOverlay(overlay, anchor);
  if (sleevePlan) {
    const check = minL1DriftForTarget(
      anchor,
      sleevePlan.targetSleeves,
      sleevePlan.membership,
      current,
    );
    if (check.oneWayTurnover > 0) {
      return hintsFromSleevePlan(
        anchor,
        sleevePlan.targetSleeves,
        sleevePlan.membership,
        current,
        "sleeve_targets",
        (key) => key,
      );
    }
  }

  // Layer 2: group_weight_band (include unsigned for live conversation)
  const bands = groupWeightBandsFromOverlay(overlay, { includeUnsigned: true });
  if (bands.length > 0) {
    const targetSleeves: Record<string, number> = {};
    const membership: Record<string, string[]> = {};
    const refByKey: Record<string, string> = {};
    bands.forEach((band, i) => {
      const key = band.group_id ?? `band-${i}`;
      const target =
        band.target_pct ??
        (band.min_pct != null && band.max_pct != null
          ? (band.min_pct + band.max_pct) / 2
          : null) ??
        band.min_pct ??
        band.max_pct;
      if (target == null || !Number.isFinite(target) || target <= 0) return;
      if (!band.tickers?.length) return;
      targetSleeves[key] = target;
      membership[key] = band.tickers.map((t) => t.toUpperCase());
      refByKey[key] = band.group_id ?? key;
    });
    if (Object.keys(targetSleeves).length > 0) {
      const check = minL1DriftForTarget(
        anchor,
        targetSleeves,
        membership,
        current,
      );
      if (check.oneWayTurnover > 0) {
        return hintsFromSleevePlan(
          anchor,
          targetSleeves,
          membership,
          current,
          "group_weight_band",
          (key) => refByKey[key] ?? key,
        );
      }
    }
  }

  // Layer 3: must_include estimate
  const mustHints = computeMustIncludeHints(overlay, anchor, current);
  if (mustHints && mustHints.minRequiredDrift > 0) return mustHints;

  // Layer 4: narrative-only — no mechanical signal
  return finalizeHints(0, [], current);
}

/** Confirm-time sync: raise only, never lower. */
export function driftSyncActionForConfirm(
  hints: OverlayDriftHints,
  currentDrift: number,
): DriftSyncAction {
  const current = clamp01(
    Number.isFinite(currentDrift) ? currentDrift : 0.5,
  );
  if (hints.suggestedDrift > current + 1e-9) {
    return {
      kind: "raise",
      from: current,
      to: hints.suggestedDrift,
      requiresSupervisor: hints.requiresSupervisor,
    };
  }
  return { kind: "none" };
}

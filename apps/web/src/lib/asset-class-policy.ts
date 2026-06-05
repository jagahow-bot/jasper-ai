import type { ParamControl } from "@/lib/types";
import {
  type AssetClass,
  SUB_ASSET_CLASS_KEYS,
  SUB_ASSET_PARAM_KEYS,
} from "@/lib/constants";

const CLASS_ALLOC_KEYS: Record<AssetClass, string> = {
  equity: "w_equity",
  bond: "w_bond",
  commodity: "w_commodity",
  real_estate: "w_real_estate",
  alternative: "w_alternative",
};

const SUB_KEYS_BY_PARENT: Record<AssetClass, string[]> = {
  equity: SUB_ASSET_CLASS_KEYS.filter((k) => k.startsWith("equity:")).map(
    (k) => SUB_ASSET_PARAM_KEYS[k],
  ),
  bond: SUB_ASSET_CLASS_KEYS.filter((k) => k.startsWith("bond:")).map(
    (k) => SUB_ASSET_PARAM_KEYS[k],
  ),
  commodity: SUB_ASSET_CLASS_KEYS.filter((k) => k.startsWith("commodity:")).map(
    (k) => SUB_ASSET_PARAM_KEYS[k],
  ),
  real_estate: SUB_ASSET_CLASS_KEYS.filter((k) => k.startsWith("real_estate:")).map(
    (k) => SUB_ASSET_PARAM_KEYS[k],
  ),
  alternative: [],
};

/** Zero allocation search for asset classes not in the universe filter. */
export function enforceAllocControlsForClasses(
  controls: Record<string, ParamControl> | undefined,
  assetClasses: AssetClass[],
): Record<string, ParamControl> {
  const base = { ...(controls ?? {}) };
  const allowed = new Set(assetClasses);
  const zero = { mode: "fixed" as const, fixed: 0, min: 0, max: 0 };
  (Object.entries(CLASS_ALLOC_KEYS) as [AssetClass, string][]).forEach(([ac, key]) => {
    if (allowed.has(ac)) return;
    base[key] = zero;
    for (const subKey of SUB_KEYS_BY_PARENT[ac]) {
      base[subKey] = zero;
    }
  });
  return base;
}

export const REGIME_QUOTA_KEYS = ["risk_off", "neutral", "risk_on"] as const;

export type RegimeQuotaKey = (typeof REGIME_QUOTA_KEYS)[number];

function paramKeyToAssetClass(key: string): string {
  const hit = (Object.entries(CLASS_ALLOC_KEYS) as [AssetClass, string][]).find(
    ([, param]) => param === key,
  );
  return hit?.[0] ?? key.replace(/^w_/, "");
}

/** Normalized per-regime class budgets (asset class → 0–1, sum≈1). */
export function normalizeRegimeClassQuotas(
  raw: Record<string, Record<string, number>> | null | undefined,
): Record<RegimeQuotaKey, Record<string, number>> | null {
  if (!raw || !Object.keys(raw).length) return null;
  const out: Partial<Record<RegimeQuotaKey, Record<string, number>>> = {};
  for (const regime of REGIME_QUOTA_KEYS) {
    const slice = raw[regime];
    if (!slice || !Object.keys(slice).length) continue;
    const budget: Record<string, number> = {};
    let sum = 0;
    for (const [key, val] of Object.entries(slice)) {
      const v = Math.max(0, Number(val) || 0);
      if (v <= 0) continue;
      const ac = key.startsWith("w_") ? paramKeyToAssetClass(key) : key;
      budget[ac] = (budget[ac] ?? 0) + v;
      sum += v;
    }
    if (sum > 1e-12) {
      out[regime] = Object.fromEntries(
        Object.entries(budget).map(([k, v]) => [k, v / sum]),
      );
    }
  }
  return Object.keys(out).length ? (out as Record<RegimeQuotaKey, Record<string, number>>) : null;
}

export function quotaKeysForClasses(assetClasses: string[] | null | undefined): string[] {
  if (!assetClasses?.length) {
    return [
      ...Object.values(CLASS_ALLOC_KEYS),
      ...SUB_ASSET_CLASS_KEYS.map((k) => SUB_ASSET_PARAM_KEYS[k]),
    ];
  }
  const keys: string[] = [];
  for (const ac of assetClasses) {
    if (!(ac in CLASS_ALLOC_KEYS)) continue;
    const sleeve = ac as AssetClass;
    keys.push(CLASS_ALLOC_KEYS[sleeve]);
    keys.push(...SUB_KEYS_BY_PARENT[sleeve]);
  }
  return keys;
}

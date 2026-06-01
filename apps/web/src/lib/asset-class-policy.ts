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

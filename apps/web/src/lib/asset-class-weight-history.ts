import { parseDateTs } from "@/lib/benchmark-chart-scale";
import { ASSET_CLASSES } from "@/lib/constants";

export const ASSET_CLASS_CHART_ORDER = [...ASSET_CLASSES, "other"] as const;

export type AssetClassChartKey = (typeof ASSET_CLASS_CHART_ORDER)[number];

export const ASSET_CLASS_CHART_COLORS: Record<AssetClassChartKey, string> = {
  equity: "#39ff14",
  bond: "#00f5ff",
  commodity: "#ffb000",
  real_estate: "#a78bfa",
  alternative: "#ff2bd6",
  other: "#64748b",
};

export function buildTickerAssetClassMap(
  items: { ticker: string; asset_class: string }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of items) {
    map.set(item.ticker.toUpperCase(), item.asset_class);
  }
  return map;
}

type WeightRow = { date: string } & Record<string, number | string>;

export function aggregateWeightHistoryByAssetClass(
  weightHistory: WeightRow[],
  weightTickers: string[],
  tickerToClass: Map<string, string>,
): {
  data: ({ date: string; ts: number } & Record<string, number>)[];
  classKeys: AssetClassChartKey[];
} {
  const presentClasses = new Set<AssetClassChartKey>();
  const tickerSet = new Set(weightTickers.map((t) => t.toUpperCase()));

  const data = weightHistory.map((row) => {
    const out = {
      date: String(row.date),
      ts: parseDateTs(String(row.date)),
    } as { date: string; ts: number } & Record<string, number>;

    for (const cls of ASSET_CLASS_CHART_ORDER) {
      out[cls] = 0;
    }

    const rowRecord = row as Record<string, unknown>;
    for (const [key, raw] of Object.entries(rowRecord)) {
      if (key === "date" || key === "ts" || key === "OTHER") continue;
      const w = Number(raw ?? 0);
      if (!Number.isFinite(w) || w <= 0) continue;
      if (tickerSet.size > 0 && !tickerSet.has(key.toUpperCase())) continue;
      const rawClass = tickerToClass.get(key.toUpperCase()) ?? "other";
      const ac = (ASSET_CLASS_CHART_ORDER as readonly string[]).includes(rawClass)
        ? (rawClass as AssetClassChartKey)
        : "other";
      out[ac] += w;
      presentClasses.add(ac);
    }

    const otherFromCap = Number(rowRecord.OTHER ?? 0);
    if (Number.isFinite(otherFromCap) && otherFromCap > 0) {
      out.other += otherFromCap;
      presentClasses.add("other");
    }

    return out;
  });

  const classKeys = ASSET_CLASS_CHART_ORDER.filter((cls) => presentClasses.has(cls));
  return { data, classKeys };
}

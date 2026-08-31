"use client";

import { useMemo, useState } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { ChartTooltip } from "@/components/ChartTooltip";
import {
  COMPOSITION_COLORS,
  capSlicesForChart,
  defaultUniverseMap,
  groupHoldings,
  labelHoldingsWithSector,
  normalizeSliceWeights,
  shouldHideRegionView,
  type HoldingView,
} from "@/lib/holding-groups";
import { sectorLabel } from "@/lib/etf-category-i18n";
import { etfDisplayName } from "@/lib/etf-display-name";
import { assetClassLabel, regionLabel, useI18n } from "@/lib/i18n";
import { formatWeightPct } from "@/lib/candidate-weights";

type Props = {
  holdings: { ticker: string; weight: number }[];
  /** Card preview: smaller chart, fewer bars, no detail table. */
  compact?: boolean;
  defaultView?: HoldingView;
  /** Show collapsible full holdings table (default: !compact). */
  showDetails?: boolean;
};

function ViewToggle({
  value,
  onChange,
  options,
}: {
  value: HoldingView;
  onChange: (v: HoldingView) => void;
  options: { value: HoldingView; label: string }[];
}) {
  return (
    <div
      className="inline-flex flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5"
      role="tablist"
      aria-label="Composition view"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          onClick={(e) => {
            e.stopPropagation();
            onChange(opt.value);
          }}
          className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
            value === opt.value
              ? "bg-[var(--primary)] text-white"
              : "text-[var(--text-dim)] hover:text-[var(--foreground)]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function PortfolioComposition({
  holdings,
  compact = false,
  defaultView = "assetClass",
  showDetails,
}: Props) {
  const { t, lang } = useI18n();
  const [view, setView] = useState<HoldingView>(defaultView);
  const universe = useMemo(() => defaultUniverseMap(), []);

  const labelCtx = useMemo(
    () => ({
      lang,
      assetClassLabel: (key: string) => assetClassLabel(t, key),
      regionLabel: (key: string) => regionLabel(t, key),
    }),
    [t, lang],
  );

  const positiveHoldings = useMemo(
    () =>
      holdings.filter((h) => h.weight > 0 && String(h.ticker || "").trim()),
    [holdings],
  );

  const hideRegion = useMemo(
    () => shouldHideRegionView(positiveHoldings, universe),
    [positiveHoldings, universe],
  );

  const viewOptions = useMemo(() => {
    const opts: { value: HoldingView; label: string }[] = [
      { value: "assetClass", label: t("composition.view.assetClass") },
      { value: "sector", label: t("composition.view.sector") },
    ];
    if (!hideRegion) {
      opts.push({ value: "region", label: t("composition.view.region") });
    }
    return opts;
  }, [hideRegion, t]);

  const activeView =
    view === "region" && hideRegion ? "assetClass" : view;

  const slices = useMemo(() => {
    const raw = groupHoldings(positiveHoldings, activeView, universe, labelCtx);
    const topN = compact ? 5 : 8;
    return capSlicesForChart(raw, topN, t("composition.other"));
  }, [positiveHoldings, activeView, universe, labelCtx, compact, t]);

  const pieData = useMemo(() => normalizeSliceWeights(slices), [slices]);
  const maxBar = slices[0]?.weight ?? 1;
  const showDetailTable = showDetails ?? !compact;
  const chartHeight = compact ? 88 : 140;

  const detailRows = useMemo(
    () => labelHoldingsWithSector(positiveHoldings, universe),
    [positiveHoldings, universe],
  );

  const detailBySector = useMemo(() => {
    const map = new Map<string, typeof detailRows>();
    for (const row of detailRows) {
      const list = map.get(row.sectorKey) ?? [];
      list.push(row);
      map.set(row.sectorKey, list);
    }
    const sectorOrder = [
      ...new Set(slices.map((s) => s.key).filter((k) => k !== "other")),
      "other",
    ];
    return sectorOrder
      .filter((k) => map.has(k))
      .map((key) => ({
        key,
        label: sectorLabel(lang, key),
        rows: map.get(key) ?? [],
      }));
  }, [detailRows, slices, lang]);

  if (!positiveHoldings.length) {
    return (
      <p className="ui-hint text-dim">{t("composition.empty")}</p>
    );
  }

  const useBarsOnly = positiveHoldings.length <= 3;

  return (
    <div
      className="space-y-2"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="ui-hint text-dim">{t("composition.title")}</span>
        <ViewToggle value={activeView} onChange={setView} options={viewOptions} />
      </div>

      <div
        className={`grid gap-2 ${useBarsOnly ? "grid-cols-1" : "grid-cols-[minmax(5.5rem,7rem)_1fr]"}`}
      >
        {!useBarsOnly ? (
          <div
            className="min-w-0"
            style={{ height: chartHeight }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={compact ? 22 : 36}
                  outerRadius={compact ? 38 : 56}
                  cx="50%"
                  cy="50%"
                >
                  {pieData.map((_, i) => (
                    <Cell
                      key={`${pieData[i].key}-${i}`}
                      fill={COMPOSITION_COLORS[i % COMPOSITION_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  content={
                    <ChartTooltip valueDecimals={1} valueIsPct sortByValue />
                  }
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        ) : null}

        <ul className="min-w-0 space-y-1 self-center">
          {slices.map((slice, i) => (
            <li key={slice.key} className="flex items-center gap-1.5 text-[11px]">
              <span
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{
                  backgroundColor:
                    COMPOSITION_COLORS[i % COMPOSITION_COLORS.length],
                }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-[var(--ui-color-body)]">
                {slice.label}
              </span>
              <span className="shrink-0 tabular-nums text-[var(--text-dim)]">
                {(slice.weight * 100).toFixed(1)}%
              </span>
              <span
                className="hidden h-1.5 max-w-[4rem] shrink-0 rounded bg-[var(--primary-muted)] sm:inline-block"
                style={{
                  width: `${Math.max(8, (slice.weight / maxBar) * 64)}px`,
                  backgroundColor: COMPOSITION_COLORS[i % COMPOSITION_COLORS.length],
                  opacity: 0.85,
                }}
                aria-hidden
              />
            </li>
          ))}
        </ul>
      </div>

      {showDetailTable ? (
        <details className="group rounded-lg border border-[var(--border)]/70 bg-[var(--surface)]/50">
          <summary className="cursor-pointer list-none px-2 py-1.5 text-[11px] font-medium text-[var(--primary)] marker:content-none [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">{t("composition.detailsExpand")}</span>
            <span className="hidden group-open:inline">{t("composition.detailsCollapse")}</span>
            <span className="ml-1 text-[var(--text-dim)]">
              ({positiveHoldings.length} {t("composition.holdingsUnit")})
            </span>
          </summary>
          <div className="max-h-56 overflow-y-auto border-t border-[var(--border)]/60 px-2 py-2">
            {detailBySector.map((group) => (
              <div key={group.key} className="mb-3 last:mb-0">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-dim)]">
                  {group.label}
                </p>
                <table className="w-full text-left text-[11px]">
                  <tbody>
                    {group.rows.map((row) => (
                      <tr
                        key={row.ticker}
                        className="border-t border-[var(--border)]/40 first:border-0"
                      >
                        <td className="py-0.5 pr-2 font-medium">{row.ticker}</td>
                        <td className="py-0.5 pr-2 text-dim">
                          {etfDisplayName(row.ticker, lang)}
                        </td>
                        <td className="py-0.5 text-right tabular-nums">
                          {formatWeightPct(row.weight * 100)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

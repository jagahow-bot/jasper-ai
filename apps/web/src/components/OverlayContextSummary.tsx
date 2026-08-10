"use client";

import { useMemo } from "react";
import {
  countSelectedModelGroups,
  effectiveScopeGroupIds,
  holdingCumulativeReturnDecimal,
  holdingDisplayName,
  holdingsGroupLabel,
  holdingsGroupWeight,
  toggleScopeGroupId,
  type ClientHoldingsGroup,
} from "@/lib/clients";
import {
  realCumulativePctForHolding,
  weightedHoldingReturnPct,
} from "@/lib/client-daily-nav";
import { useClientDailyNav } from "@/lib/use-client-daily-nav";
import { useI18n } from "@/lib/i18n";

export type OverlayAnchorOption = {
  id: string;
  label: string;
};

export type OverlayContextHolding = {
  id: string;
  ticker: string;
  label: string;
  weightLabel: string;
};

type Props = {
  groups: ClientHoldingsGroup[];
  selectedGroupIds: string[];
  onSelectedGroupIdsChange: (ids: string[]) => void;
  anchorId: string;
  anchorLabel: string;
  anchorHoldings: OverlayContextHolding[];
  anchorOptions: OverlayAnchorOption[];
  onAnchorChange: (id: string) => void;
  /** Client book date — used for reported-return fallback when prices are unavailable. */
  asOfDate?: string | null;
};

const SECTION_LABEL_CLASS =
  "text-xs font-semibold uppercase tracking-[0.18em] text-dim";
const CARD_CLASS =
  "rounded-md border border-[var(--border)] bg-white px-2 py-1.5";
const NAME_CLASS = "text-xs font-semibold text-[var(--ui-color-body)]";
const CHIP_CLASS =
  "rounded border border-[var(--border)]/70 bg-[var(--surface-2)] px-1.5 py-0.5 text-xs leading-4";

function HoldingChips({ holdings }: { holdings: OverlayContextHolding[] }) {
  if (holdings.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {holdings.map((holding) => (
        <div key={holding.id} className={CHIP_CLASS}>
          <span className="font-semibold text-[var(--ui-color-body)]">
            {holding.ticker}
          </span>
          <span className="ml-1 text-dim">{holding.label}</span>
          <span className="ml-2 tabular-nums text-dim">
            {holding.weightLabel}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Interactive confirmed-scope panel: pick sleeves + baseline before Overlay chat. */
export function OverlayContextSummary({
  groups,
  selectedGroupIds,
  onSelectedGroupIdsChange,
  anchorId,
  anchorLabel,
  anchorHoldings,
  anchorOptions,
  onAnchorChange,
  asOfDate,
}: Props) {
  const { t, lang } = useI18n();
  const allIds = useMemo(() => groups.map((g) => g.id), [groups]);
  const allHoldings = useMemo(
    () => groups.flatMap((g) => g.holdings),
    [groups],
  );
  const { perTicker } = useClientDailyNav(allHoldings, asOfDate);
  /** Group cumulative return (percent points): real prices first, reported fallback. */
  const groupReturn = (group: ClientHoldingsGroup) =>
    weightedHoldingReturnPct(group.holdings, (h) => {
      const real = realCumulativePctForHolding(h, perTicker);
      if (typeof real === "number") return { pct: real, real: true };
      const reported = holdingCumulativeReturnDecimal(h, asOfDate);
      return {
        pct: typeof reported === "number" ? reported * 100 : undefined,
        real: false,
      };
    });
  const effectiveIds = useMemo(
    () => effectiveScopeGroupIds(groups, selectedGroupIds),
    [groups, selectedGroupIds],
  );
  const selectedSet = useMemo(() => new Set(effectiveIds), [effectiveIds]);
  const multiModel = countSelectedModelGroups(groups, effectiveIds) > 1;

  const groupCards = useMemo(
    () =>
      groups.map((group) => {
        const groupTotal = holdingsGroupWeight(group);
        const holdings = group.holdings
          .filter((holding) => holding.weight > 0)
          .sort((a, b) => b.weight - a.weight)
          .map((holding) => ({
            id: `${group.id}-${holding.ticker}`,
            ticker: holding.ticker.toUpperCase(),
            label: holdingDisplayName(holding, t, lang),
            weightLabel:
              groupTotal > 0
                ? `${((holding.weight / groupTotal) * 100).toFixed(1)}%`
                : "0.0%",
          }));
        return {
          id: group.id,
          name: holdingsGroupLabel(group, lang, t),
          holdings,
        };
      }),
    [groups, t, lang],
  );

  const toggle = (id: string) => {
    onSelectedGroupIdsChange(toggleScopeGroupId(selectedGroupIds, id, allIds));
  };

  return (
    <div className="saas-inset space-y-3 p-3 text-sm">
      <div>
        <p className="ui-section-title text-[var(--cyan)]">
          {t("overlay.contextSummaryTitle")}
        </p>
      </div>

      {multiModel ? (
        <p className="rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-2 text-sm text-[var(--ui-color-body)]">
          {t("customization.multiModelNotice")}
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="min-w-0">
          <p className={SECTION_LABEL_CLASS}>{t("overlay.contextGroups")}</p>
          {groupCards.length > 0 ? (
            <div className="mt-2 space-y-2">
              {groupCards.map((group) => {
                const checked = selectedSet.has(group.id);
                const disabled = checked && selectedSet.size <= 1;
                const source = groups.find((g) => g.id === group.id);
                const bookShare = source ? holdingsGroupWeight(source) : 0;
                const ret = source
                  ? groupReturn(source)
                  : { pct: undefined, allReal: false };
                const retLabel =
                  typeof ret.pct === "number"
                    ? `${ret.pct >= 0 ? "+" : ""}${ret.pct.toFixed(1)}%`
                    : "—";
                const retClass =
                  typeof ret.pct !== "number"
                    ? "text-dim"
                    : ret.pct >= 0
                      ? "text-emerald-600"
                      : "text-[var(--magenta)]";
                return (
                  <label
                    key={group.id}
                    className={`block cursor-pointer transition ${
                      checked ? "" : "opacity-55"
                    } ${disabled ? "cursor-not-allowed" : ""}`}
                  >
                    <div
                      className={`${CARD_CLASS} ${
                        checked
                          ? "border-[var(--primary)]/40 bg-[var(--primary)]/5"
                          : ""
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 accent-[var(--primary)]"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggle(group.id)}
                        />
                        <span className={NAME_CLASS}>{group.name}</span>
                        <span className="ml-auto flex items-center gap-2 text-xs tabular-nums">
                          <span className="text-dim">
                            {(bookShare * 100).toFixed(1)}%
                          </span>
                          <span
                            className={`font-medium ${retClass} ${
                              ret.allReal ? "" : "opacity-60"
                            }`}
                            title={
                              ret.allReal
                                ? undefined
                                : t("clients.return.reportedFallback")
                            }
                          >
                            {retLabel}
                          </span>
                        </span>
                      </div>
                      <HoldingChips holdings={group.holdings} />
                    </div>
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="mt-2 text-sm text-[var(--ui-color-body)]">
              {t("overlay.contextGroupsFallback")}
            </p>
          )}
        </div>

        <div className="min-w-0">
          <p className={SECTION_LABEL_CLASS}>{t("overlay.contextAnchor")}</p>
          {anchorOptions.length > 1 ? (
            <label className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-[var(--text-dim)]">
              <span className="sr-only">{t("overlay.contextAnchor")}</span>
              <select
                value={
                  anchorOptions.some((o) => o.id === anchorId)
                    ? anchorId
                    : (anchorOptions[0]?.id ?? "")
                }
                onChange={(e) => onAnchorChange(e.target.value)}
                className="w-full rounded-md border border-[var(--border)] bg-white px-1.5 py-1 text-xs text-[var(--ui-color-body)]"
              >
                {anchorOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="mt-2">
            <div className={CARD_CLASS}>
              <p className={NAME_CLASS}>{anchorLabel}</p>
              <HoldingChips holdings={anchorHoldings} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

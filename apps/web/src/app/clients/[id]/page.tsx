"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppNav } from "@/components/AppNav";
import { ChartTooltip } from "@/components/ChartTooltip";
import { ClientCustomizedHistoryPanel } from "@/components/ClientCustomizedHistoryPanel";
import { FinancialGoalSimulator } from "@/components/FinancialGoalSimulator";
import {
  defaultCustomizationPortfolioName,
  formatUpcomingEvent,
  formatUsd,
  getClientHoldingsGroups,
  getDemoClientById,
  getUpcomingEvents,
  holdingDisplayName,
  holdingCagr,
  holdingCumulativeReturnDecimal,
  holdingsFromSelectedGroups,
  holdingsGroupInvestedAt,
  holdingsGroupLabel,
  holdingsGroupWeight,
  isCashHolding,
  localizedText,
  resolveAnchorIdFromScope,
  resolveHoldingProductType,
  selectedGroupsWeightScale,
  type ClientHolding,
  type ClientHoldingsGroup,
  type ClientUpcomingEvent,
} from "@/lib/clients";
import {
  buildClientHoldingsGroupPie,
  buildClientHoldingsPie,
  buildClientPerformanceSeries,
  CLIENT_PERF_TIMEFRAMES,
  toClientPerformanceReturnSeries,
  type ClientPerfTimeframe,
} from "@/lib/clients-charts";
import { useClientDailyNav } from "@/lib/use-client-daily-nav";
import {
  realCagrPctForHolding,
  realCumulativePctForHolding,
  weightedHoldingReturnPct,
  type ResolvedHoldingReturn,
  type WeightedHoldingReturn,
} from "@/lib/client-daily-nav";
import {
  addClientEvent,
  addClientNote,
  getExtraEvents,
  getExtraNotes,
  type ClientExtraNote,
} from "@/lib/demo-clients-store";
import { CURRENT_HOLDINGS_ANCHOR_ID } from "@/lib/model-portfolios";
import {
  esgPreferenceLabel,
  productTypeLabel,
  riskProfileLabel,
  useI18n,
  type Lang,
  type TFn,
} from "@/lib/i18n";

const HOLDING_COLORS = [
  "#2563eb",
  "#0ea5e9",
  "#14b8a6",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#64748b",
  "#ec4899",
  "#84cc16",
  "#f97316",
];

type AllocationView = "individual" | "portfolio";

function ChartSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-0.5"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            className={`rounded px-1.5 py-0.5 text-[11px] leading-tight transition-colors ${
              active
                ? "bg-white font-medium text-[var(--foreground)] shadow-sm"
                : "text-[var(--text-dim)] hover:text-[var(--foreground)]"
            }`}
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/** Format return / cagr percent points with sign + emerald/red coloring. Cash → —. */
function percentFromDecimal(d: number | undefined): number | undefined {
  return typeof d === "number" ? d * 100 : undefined;
}

function formatReturnYtd(
  pct: number | null | undefined,
  opts?: { isCash?: boolean },
): {
  text: string;
  className: string;
} {
  if (opts?.isCash || pct == null || Number.isNaN(pct)) {
    return { text: "—", className: "text-[var(--text-dim)]" };
  }
  const sign = pct > 0 ? "+" : "";
  const text = `${sign}${pct.toFixed(1)}%`;
  const className =
    pct > 0
      ? "text-emerald-600"
      : pct < 0
        ? "text-red-600"
        : "text-[var(--text-dim)]";
  return { text, className };
}

function formatInvestedAt(iso: string | null | undefined): string {
  if (!iso) return "—";
  return iso;
}

/**
 * Illustrative holding amount from client AUM × weight (no per-row amount_usd in demo data).
 * Group subtotals use the same base × group weight sum.
 */
function formatHoldingAmount(
  aumUsd: number,
  weight: number,
  lang: Lang,
): string {
  if (!(aumUsd > 0) || !(weight >= 0)) return "—";
  return formatUsd(aumUsd * weight, lang);
}

export default function ClientDashboardPage() {
  const { t, lang } = useI18n();
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";
  const client = useMemo(() => getDemoClientById(id), [id]);

  const holdingsGroups = useMemo(
    () => (client ? getClientHoldingsGroups(client) : []),
    [client],
  );
  const hasGroupedHoldings = Boolean(client?.holdings_groups?.length);
  /** Group-row checkboxes when multiple sleeves can be filtered. */
  const canFilterGroups = hasGroupedHoldings && holdingsGroups.length > 1;

  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [perfTimeframe, setPerfTimeframe] =
    useState<ClientPerfTimeframe>("MAX");
  const [allocationView, setAllocationView] =
    useState<AllocationView>("individual");
  const [extraNotes, setExtraNotes] = useState<ClientExtraNote[]>([]);
  const [extraEvents, setExtraEvents] = useState<ClientUpcomingEvent[]>([]);
  const [addingNote, setAddingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [addingEvent, setAddingEvent] = useState(false);
  const [eventDateDraft, setEventDateDraft] = useState("");
  const [eventLabelDraft, setEventLabelDraft] = useState("");
  const [goalSimOpen, setGoalSimOpen] = useState(false);

  useEffect(() => {
    if (!client) {
      setSelectedGroupIds([]);
      return;
    }
    setSelectedGroupIds(getClientHoldingsGroups(client).map((g) => g.id));
  }, [client]);

  useEffect(() => {
    if (!id) {
      setExtraNotes([]);
      setExtraEvents([]);
      setAddingNote(false);
      setAddingEvent(false);
      setNoteDraft("");
      setEventDateDraft("");
      setEventLabelDraft("");
      return;
    }
    setExtraNotes(getExtraNotes(id));
    setExtraEvents(getExtraEvents(id));
    setAddingNote(false);
    setAddingEvent(false);
    setNoteDraft("");
    setEventDateDraft("");
    setEventLabelDraft("");
    setGoalSimOpen(false);
  }, [id]);

  const launchHref = useMemo(() => {
    if (!client) return "/";
    const groups = getClientHoldingsGroups(client);
    const ids =
      selectedGroupIds.length > 0
        ? selectedGroupIds
        : groups.map((g) => g.id);
    const fallback = CURRENT_HOLDINGS_ANCHOR_ID;
    const anchor = resolveAnchorIdFromScope(groups, ids, fallback);
    const name = defaultCustomizationPortfolioName(client, lang);
    const q = new URLSearchParams({
      client: client.client_id,
      anchor,
      groups: ids.join(","),
      portfolioName: name,
    });
    return `/?${q.toString()}`;
  }, [client, selectedGroupIds, lang]);

  const chartHoldings = useMemo(
    () => holdingsFromSelectedGroups(holdingsGroups, selectedGroupIds),
    [holdingsGroups, selectedGroupIds],
  );

  const weightScale = useMemo(
    () =>
      canFilterGroups
        ? selectedGroupsWeightScale(holdingsGroups, selectedGroupIds)
        : 1,
    [canFilterGroups, holdingsGroups, selectedGroupIds],
  );

  // Real daily NAV + per-ticker returns from price history; reported values
  // are the immediate placeholder while loading and the fallback on failure.
  const dailyNav = useClientDailyNav(chartHoldings, client?.as_of_date);
  const perTicker = dailyNav.perTicker;
  /** True once real data has loaded or failed — gates the dimmed-fallback styling. */
  const realReturnsSettled = dailyNav.failed || perTicker != null;

  /** 累積報酬 per holding: real close-to-close return, else reported (fallback). */
  const resolveCumulative = useMemo(
    () =>
      (h: ClientHolding): ResolvedHoldingReturn => {
        if (isCashHolding(h)) return { pct: undefined, real: false };
        const real = realCumulativePctForHolding(h, perTicker);
        if (typeof real === "number") return { pct: real, real: true };
        return {
          pct: percentFromDecimal(
            holdingCumulativeReturnDecimal(h, client?.as_of_date),
          ),
          real: false,
        };
      },
    [perTicker, client?.as_of_date],
  );

  /** CAGR per holding: same real return over first priced day → as_of. */
  const resolveCagr = useMemo(
    () =>
      (h: ClientHolding): ResolvedHoldingReturn => {
        if (isCashHolding(h)) return { pct: undefined, real: false };
        const real = realCagrPctForHolding(h, perTicker, client?.as_of_date);
        if (typeof real === "number") return { pct: real, real: true };
        return { pct: holdingCagr(h, client?.as_of_date), real: false };
      },
    [perTicker, client?.as_of_date],
  );

  /** Footer totals for selected groups (same scope as charts). */
  const holdingsTotals = useMemo(() => {
    if (hasGroupedHoldings) {
      const selected = new Set(selectedGroupIds);
      const rawWeight = holdingsGroups
        .filter((g) => selected.has(g.id))
        .reduce((acc, g) => acc + holdingsGroupWeight(g), 0);
      const displayWeight = rawWeight * weightScale;
      const totalGroup =
        chartHoldings.length > 0
          ? {
              id: "_total",
              type: "individual" as const,
              holdings: chartHoldings,
            }
          : null;
      const cumulative = totalGroup
        ? weightedHoldingReturnPct(totalGroup.holdings, resolveCumulative)
        : undefined;
      const cagr = totalGroup
        ? weightedHoldingReturnPct(totalGroup.holdings, resolveCagr)
        : undefined;
      const investedAt = totalGroup
        ? holdingsGroupInvestedAt(totalGroup)
        : undefined;
      return {
        rawWeight,
        displayWeight,
        cumulative: cumulative?.pct,
        cumulativeAllReal: cumulative?.allReal ?? false,
        cagr: cagr?.pct,
        cagrAllReal: cagr?.allReal ?? false,
        investedAt,
      };
    }
    const rawWeight = client
      ? client.holdings.reduce((acc, h) => acc + h.weight, 0)
      : 0;
    const flatGroup = client
      ? {
          id: "_total",
          type: "individual" as const,
          holdings: client.holdings,
        }
      : null;
    const cumulative = flatGroup
      ? weightedHoldingReturnPct(flatGroup.holdings, resolveCumulative)
      : undefined;
    const cagr = flatGroup
      ? weightedHoldingReturnPct(flatGroup.holdings, resolveCagr)
      : undefined;
    const investedAt = flatGroup
      ? holdingsGroupInvestedAt(flatGroup)
      : undefined;
    return {
      rawWeight,
      displayWeight: rawWeight,
      cumulative: cumulative?.pct,
      cumulativeAllReal: cumulative?.allReal ?? false,
      cagr: cagr?.pct,
      cagrAllReal: cagr?.allReal ?? false,
      investedAt,
    };
  }, [
    hasGroupedHoldings,
    holdingsGroups,
    selectedGroupIds,
    weightScale,
    chartHoldings,
    client,
    resolveCumulative,
    resolveCagr,
  ]);

  const pieData = useMemo(() => {
    if (allocationView === "portfolio" && hasGroupedHoldings) {
      return buildClientHoldingsGroupPie(holdingsGroups, {
        selectedIds: selectedGroupIds,
        labelOf: (g) =>
          holdingsGroupLabel(g as ClientHoldingsGroup, lang, t),
        renormalize: canFilterGroups,
      });
    }
    return buildClientHoldingsPie(chartHoldings, {
      renormalize: canFilterGroups,
    });
  }, [
    allocationView,
    hasGroupedHoldings,
    holdingsGroups,
    selectedGroupIds,
    lang,
    t,
    chartHoldings,
    canFilterGroups,
  ]);
  // Chart: real daily NAV once loaded; calibrated reported series meanwhile.
  const navSeries = useMemo(() => {
    if (!client) return [];
    const nav = dailyNav.points?.length
      ? dailyNav.points
      : buildClientPerformanceSeries({
          client_id: client.client_id,
          as_of_date: client.as_of_date,
          risk_profile: client.risk_profile,
          holdings: chartHoldings,
        });
    return toClientPerformanceReturnSeries(
      nav,
      perfTimeframe,
      client.as_of_date,
    );
  }, [client, chartHoldings, perfTimeframe, dailyNav.points]);

  useEffect(() => {
    if (!hasGroupedHoldings && allocationView === "portfolio") {
      setAllocationView("individual");
    }
  }, [hasGroupedHoldings, allocationView]);

  /** Keep at least one group selected so charts stay meaningful. */
  const toggleGroup = (groupId: string) => {
    setSelectedGroupIds((prev) => {
      if (prev.includes(groupId)) {
        if (prev.length <= 1) return prev;
        return prev.filter((x) => x !== groupId);
      }
      return [...prev, groupId];
    });
  };

  if (!client) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <AppNav subtitle={t("clients.detailSubtitle")} />
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <p className="text-[var(--magenta)]">{t("clients.notFound")}</p>
          <Link href="/clients" className="mt-4 inline-block text-[var(--primary)]">
            {t("clients.backToList")}
          </Link>
        </main>
      </div>
    );
  }

  const totalRet = formatReturnYtd(holdingsTotals.cumulative);
  const totalCagr = formatReturnYtd(holdingsTotals.cagr);
  // Fallback (reported) aggregates are dimmed once real data has settled.
  const totalRetDim =
    realReturnsSettled &&
    holdingsTotals.cumulative != null &&
    !holdingsTotals.cumulativeAllReal;
  const totalCagrDim =
    realReturnsSettled &&
    holdingsTotals.cagr != null &&
    !holdingsTotals.cagrAllReal;
  const hasHoldingsSelection = holdingsTotals.rawWeight > 0;

  const name = localizedText(client.display_name, lang);
  const upcomingEvents = getUpcomingEvents({
    upcoming_events: [
      ...(client.upcoming_events ?? []),
      ...extraEvents,
    ],
  });

  const saveNote = () => {
    const created = addClientNote(client.client_id, noteDraft);
    if (!created) return;
    setExtraNotes((prev) => [...prev, created]);
    setNoteDraft("");
    setAddingNote(false);
  };

  const cancelNote = () => {
    setNoteDraft("");
    setAddingNote(false);
  };

  const saveEvent = () => {
    const created = addClientEvent(
      client.client_id,
      eventDateDraft,
      eventLabelDraft,
    );
    if (!created) return;
    setExtraEvents((prev) => [...prev, created]);
    setEventDateDraft("");
    setEventLabelDraft("");
    setAddingEvent(false);
  };

  const cancelEvent = () => {
    setEventDateDraft("");
    setEventLabelDraft("");
    setAddingEvent(false);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppNav subtitle={t("clients.detailSubtitle")} />
      <main className="mx-auto max-w-7xl space-y-3 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <Link
            href="/clients"
            className="text-sm text-[var(--primary)] hover:underline"
          >
            ← {t("clients.backToList")}
          </Link>
          <p className="ui-hint text-right">
            {t("clients.asOf")} {client.as_of_date}
          </p>
        </div>

        <div className="space-y-2">
          <div className="grid gap-4 lg:grid-cols-[minmax(220px,280px)_1fr]">
          <section className="pixel-panel space-y-2.5">
            <h2 className="ui-section-title">{t("clients.profile")}</h2>
            <div className="min-w-0">
              <h1 className="ui-panel-title">{name}</h1>
              <p className="mt-0.5 text-xs text-[var(--text-dim)]">
                {t("clients.clientId")}: {client.client_id}
              </p>
            </div>
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="shrink-0 ui-hint">{t("clients.segment")}</dt>
                <dd className="min-w-0 truncate font-medium text-right">{client.segment}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="shrink-0 ui-hint">{t("clients.age")}</dt>
                <dd className="font-medium text-right">
                  {client.age}
                  {t("clients.ageUnit")}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="shrink-0 ui-hint">{t("clients.risk")}</dt>
                <dd className="min-w-0 font-medium text-right">
                  {riskProfileLabel(t, client.risk_profile)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="shrink-0 ui-hint">{t("clients.aum")}</dt>
                <dd className="font-medium text-right tabular-nums">{formatUsd(client.aum_usd, lang)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="shrink-0 ui-hint">{t("clients.cash")}</dt>
                <dd className="font-medium text-right tabular-nums">{formatUsd(client.cash_usd, lang)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="shrink-0 ui-hint">{t("clients.horizon")}</dt>
                <dd className="min-w-0 font-medium text-right">
                  {localizedText(client.investment_horizon, lang)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="shrink-0 ui-hint">{t("clients.esg")}</dt>
                <dd className="min-w-0 font-medium text-right">
                  {client.preferences.esg
                    ? esgPreferenceLabel(t, client.preferences.esg)
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="shrink-0 ui-hint">{t("clients.rm")}</dt>
                <dd className="min-w-0 truncate font-medium text-right">{client.rm_owner}</dd>
              </div>
            </dl>
            <div className="saas-inset text-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="ui-hint">{t("clients.liquidity")}</p>
                {!addingNote ? (
                  <button
                    type="button"
                    className="shrink-0 text-xs font-medium text-[var(--primary)] hover:underline"
                    onClick={() => setAddingNote(true)}
                  >
                    {t("clients.add")}
                  </button>
                ) : null}
              </div>
              <p className="mt-1 text-[var(--ui-color-body)]">
                {localizedText(client.liquidity_notes, lang)}
              </p>
              {extraNotes.length > 0 ? (
                <ul className="mt-1.5 space-y-1 text-[var(--ui-color-body)]">
                  {extraNotes.map((note) => (
                    <li key={note.id}>
                      <span className="text-[var(--text-dim)]">• </span>
                      {note.text}
                    </li>
                  ))}
                </ul>
              ) : null}
              {addingNote ? (
                <div className="mt-2 space-y-2">
                  <label className="block">
                    <span className="ui-hint">{t("clients.add.content")}</span>
                    <textarea
                      className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-2.5 py-1.5 text-sm text-[var(--ui-color-body)] outline-none focus:border-[var(--primary)]"
                      rows={3}
                      value={noteDraft}
                      placeholder={t("clients.add.notePlaceholder")}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      autoFocus
                    />
                  </label>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--border)] bg-white px-2.5 py-1 text-xs font-medium text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
                      onClick={cancelNote}
                    >
                      {t("clients.add.cancel")}
                    </button>
                    <button
                      type="button"
                      className="pixel-btn px-2.5 py-1 text-xs disabled:opacity-40"
                      disabled={!noteDraft.trim()}
                      onClick={saveNote}
                    >
                      {t("clients.add.save")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="saas-inset text-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="ui-hint">{t("clients.upcomingEvents")}</p>
                {!addingEvent ? (
                  <button
                    type="button"
                    className="shrink-0 text-xs font-medium text-[var(--primary)] hover:underline"
                    onClick={() => setAddingEvent(true)}
                  >
                    {t("clients.add")}
                  </button>
                ) : null}
              </div>
              {upcomingEvents.length > 0 ? (
                <ul className="mt-1.5 space-y-1 text-[var(--ui-color-body)]">
                  {upcomingEvents.map((ev) => (
                    <li key={ev.id}>
                      <span className="text-[var(--text-dim)]">• </span>
                      {formatUpcomingEvent(ev, lang)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-[var(--text-dim)]">
                  {t("clients.add.noEvents")}
                </p>
              )}
              {addingEvent ? (
                <div className="mt-2 space-y-2">
                  <label className="block">
                    <span className="ui-hint">{t("clients.add.date")}</span>
                    <input
                      type="date"
                      className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-2.5 py-1.5 text-sm text-[var(--ui-color-body)] outline-none focus:border-[var(--primary)]"
                      value={eventDateDraft}
                      onChange={(e) => setEventDateDraft(e.target.value)}
                      autoFocus
                    />
                  </label>
                  <label className="block">
                    <span className="ui-hint">{t("clients.add.label")}</span>
                    <input
                      type="text"
                      className="mt-1 w-full rounded-lg border border-[var(--border)] bg-white px-2.5 py-1.5 text-sm text-[var(--ui-color-body)] outline-none focus:border-[var(--primary)]"
                      value={eventLabelDraft}
                      placeholder={t("clients.add.eventPlaceholder")}
                      onChange={(e) => setEventLabelDraft(e.target.value)}
                    />
                  </label>
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--border)] bg-white px-2.5 py-1 text-xs font-medium text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
                      onClick={cancelEvent}
                    >
                      {t("clients.add.cancel")}
                    </button>
                    <button
                      type="button"
                      className="pixel-btn px-2.5 py-1 text-xs disabled:opacity-40"
                      disabled={
                        !eventDateDraft.trim() || !eventLabelDraft.trim()
                      }
                      onClick={saveEvent}
                    >
                      {t("clients.add.save")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="pixel-panel min-w-0">
            <div
              className="flex flex-wrap items-center justify-between gap-3"
              data-holdings-launch
            >
              <div className="min-w-0">
                <h2 className="ui-section-title">{t("clients.holdings")}</h2>
                {canFilterGroups && selectedGroupIds.length > 0 ? (
                  <p className="mt-1 ui-hint">
                    {t("clients.launchScopeSummary", {
                      count: selectedGroupIds.length,
                      pct: (holdingsTotals.displayWeight * 100).toFixed(0),
                    })}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] bg-white px-3 py-1.5 text-sm font-medium text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
                  onClick={() => setGoalSimOpen((v) => !v)}
                >
                  {t("clients.goalSimCta")}
                </button>
                <Link href={launchHref} className="pixel-btn px-3 py-1.5">
                  {t("clients.launchCta")}
                </Link>
              </div>
            </div>
            {goalSimOpen ? (
              <div className="mt-4">
                <FinancialGoalSimulator
                  client={client}
                  open={goalSimOpen}
                  onOpenChange={setGoalSimOpen}
                />
              </div>
            ) : null}

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium text-[var(--foreground)]">
                    {t("clients.chart.performance")}
                  </h3>
                  <ChartSegmentedControl
                    ariaLabel={t("clients.chart.performance")}
                    value={perfTimeframe}
                    onChange={setPerfTimeframe}
                    options={CLIENT_PERF_TIMEFRAMES.map((tf) => ({
                      value: tf,
                      label: t(`clients.chart.tf.${tf}`),
                    }))}
                  />
                </div>
                <div className="mt-2 h-56 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
                  {chartHoldings.length === 0 ? (
                    <p className="flex h-full items-center justify-center px-4 text-center text-sm text-[var(--text-dim)]">
                      {t("clients.chart.noGroupsSelected")}
                    </p>
                  ) : navSeries.length === 0 && dailyNav.loading ? (
                    <p className="flex h-full items-center justify-center px-4 text-center text-sm text-[var(--text-dim)]">
                      {t("clients.chart.loadingPerformance")}
                    </p>
                  ) : navSeries.length === 0 ? (
                    <p className="flex h-full items-center justify-center px-4 text-center text-sm text-[var(--text-dim)]">
                      {t("clients.chart.noPerformanceData")}
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={navSeries}
                        margin={{ top: 8, right: 12, left: 0, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis
                          dataKey="date"
                          tick={{ fontSize: 10, fill: "#64748b" }}
                          minTickGap={40}
                        />
                        <YAxis
                          tick={{ fontSize: 10, fill: "#64748b" }}
                          domain={["auto", "auto"]}
                          width={48}
                          tickFormatter={(v) => {
                            const n = Number(v) * 100;
                            const sign = n > 0 ? "+" : "";
                            return `${sign}${n.toFixed(0)}%`;
                          }}
                        />
                        <Tooltip
                          position={{ y: 0 }}
                          content={
                            <ChartTooltip valueIsPct valueDecimals={1} />
                          }
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line
                          type="linear"
                          dataKey="ret"
                          name={t("clients.chart.return")}
                          stroke="#2563eb"
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium text-[var(--foreground)]">
                    {t("clients.chart.allocation")}
                  </h3>
                  {hasGroupedHoldings ? (
                    <ChartSegmentedControl
                      ariaLabel={t("clients.chart.allocation")}
                      value={allocationView}
                      onChange={setAllocationView}
                      options={[
                        {
                          value: "individual",
                          label: t("clients.chart.alloc.individual"),
                        },
                        {
                          value: "portfolio",
                          label: t("clients.chart.alloc.portfolio"),
                        },
                      ]}
                    />
                  ) : null}
                </div>
                <div className="mt-2 h-56 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
                  {pieData.length === 0 ? (
                    <p className="flex h-full items-center justify-center px-4 text-center text-sm text-[var(--text-dim)]">
                      {t("clients.chart.noGroupsSelected")}
                    </p>
                  ) : (
                    <div className="flex h-full min-h-0 gap-2">
                      <div className="min-w-0 flex-1">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={pieData}
                              dataKey="value"
                              nameKey="name"
                              innerRadius={40}
                              outerRadius={68}
                              cx="50%"
                              cy="50%"
                            >
                              {pieData.map((_, i) => (
                                <Cell
                                  key={`${pieData[i].name}-${i}`}
                                  fill={
                                    HOLDING_COLORS[i % HOLDING_COLORS.length]
                                  }
                                />
                              ))}
                            </Pie>
                            <Tooltip
                              content={
                                <ChartTooltip
                                  valueDecimals={1}
                                  valueIsPct
                                  sortByValue
                                />
                              }
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <ul className="max-h-full w-[42%] shrink-0 space-y-1 self-center overflow-y-auto pr-0.5 text-[11px] leading-tight">
                        {pieData.map((slice, i) => (
                          <li
                            key={`${slice.name}-${i}`}
                            className="flex items-center gap-1.5 text-[var(--ui-color-body)]"
                          >
                            <span
                              className="h-2 w-2 shrink-0 rounded-sm"
                              style={{
                                backgroundColor:
                                  HOLDING_COLORS[i % HOLDING_COLORS.length],
                              }}
                              aria-hidden
                            />
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {slice.name}
                            </span>
                            <span className="shrink-0 tabular-nums text-[var(--text-dim)]">
                              {(slice.value * 100).toFixed(1)}%
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--text-dim)]">
                    <th className="py-2 pr-3 font-medium">{t("pool.col.ticker")}</th>
                    <th className="py-2 pr-3 font-medium">{t("pool.col.name")}</th>
                    <th className="py-2 pr-3 font-medium">{t("pool.col.productType")}</th>
                    <th className="py-2 pr-3 font-medium text-right">
                      {t("clients.amount")}
                    </th>
                    <th className="py-2 pr-3 font-medium text-right">
                      {t("clients.weight")}
                    </th>
                    <th className="py-2 pr-3 font-medium text-right">
                      {t("clients.return")}
                      <span className="mt-0.5 block text-[10px] font-normal normal-case tracking-normal text-[var(--text-dim)]">
                        {t("clients.return.cumulativeSub")}
                      </span>
                    </th>
                    <th className="py-2 pr-3 font-medium text-right">
                      {t("clients.investedAt")}
                    </th>
                    <th className="py-2 pr-3 font-medium text-right">
                      {t("clients.cagr")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {hasGroupedHoldings
                    ? holdingsGroups.map((group) => {
                        const groupLabel = holdingsGroupLabel(group, lang, t);
                        const selected = selectedGroupIds.includes(group.id);
                        const rawSubtotal = holdingsGroupWeight(group);
                        return (
                          <HoldingsGroupRows
                            key={group.id}
                            group={group}
                            groupLabel={groupLabel}
                            rawSubtotal={rawSubtotal}
                            groupReturn={
                              selected
                                ? weightedHoldingReturnPct(
                                    group.holdings,
                                    resolveCumulative,
                                  )
                                : undefined
                            }
                            groupCagr={
                              selected
                                ? weightedHoldingReturnPct(
                                    group.holdings,
                                    resolveCagr,
                                  )
                                : undefined
                            }
                            groupInvestedAt={
                              selected
                                ? holdingsGroupInvestedAt(group)
                                : undefined
                            }
                            aumUsd={client.aum_usd}
                            selected={selected}
                            showCheckbox={canFilterGroups}
                            checkboxDisabled={
                              selected && selectedGroupIds.length <= 1
                            }
                            weightScale={selected ? weightScale : 1}
                            onToggle={() => toggleGroup(group.id)}
                            resolveCumulative={resolveCumulative}
                            resolveCagr={resolveCagr}
                            realReturnsSettled={realReturnsSettled}
                            t={t}
                            lang={lang}
                          />
                        );
                      })
                    : client.holdings.map((h) => {
                        const cum = resolveCumulative(h);
                        const ret = formatReturnYtd(cum.pct, {
                          isCash: isCashHolding(h),
                        });
                        const cagrR = resolveCagr(h);
                        const cagr = formatReturnYtd(cagrR.pct, {
                          isCash: isCashHolding(h),
                        });
                        const retDim =
                          realReturnsSettled && cum.pct != null && !cum.real;
                        const cagrDim =
                          realReturnsSettled && cagrR.pct != null && !cagrR.real;
                        return (
                          <tr
                            key={`${h.ticker}-${h.weight}`}
                            className="border-b border-[var(--border)]/60"
                          >
                            <td className="py-2.5 pr-3 font-medium">{h.ticker}</td>
                            <td className="py-2.5 pr-3 text-[var(--ui-color-body)]">
                              {holdingDisplayName(h, t, lang)}
                            </td>
                            <td className="py-2.5 pr-3">
                              {productTypeLabel(t, resolveHoldingProductType(h))}
                            </td>
                            <td className="py-2.5 pr-3 text-right tabular-nums">
                              {formatHoldingAmount(
                                client.aum_usd,
                                h.weight,
                                lang,
                              )}
                            </td>
                            <td className="py-2.5 pr-3 text-right tabular-nums">
                              {(h.weight * 100).toFixed(1)}%
                            </td>
                            <td
                              className={`py-2.5 pr-3 text-right tabular-nums ${ret.className}${retDim ? " opacity-60" : ""}`}
                              title={
                                retDim
                                  ? t("clients.return.reportedFallback")
                                  : undefined
                              }
                            >
                              {ret.text}
                            </td>
                            <td className="py-2.5 pr-3 text-right tabular-nums text-[var(--text-dim)]">
                              {formatInvestedAt(h.invested_at)}
                            </td>
                            <td
                              className={`py-2.5 pr-3 text-right tabular-nums ${cagr.className}${cagrDim ? " opacity-60" : ""}`}
                              title={
                                cagrDim
                                  ? t("clients.return.reportedFallback")
                                  : undefined
                              }
                            >
                              {cagr.text}
                            </td>
                          </tr>
                        );
                      })}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--border)] bg-[var(--surface)] font-semibold">
                    <td
                      colSpan={3}
                      className="py-2.5 pr-3 text-xs uppercase tracking-wide text-[var(--foreground)]"
                    >
                      {t("clients.holdings.total")}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {hasHoldingsSelection
                        ? formatHoldingAmount(
                            client.aum_usd,
                            holdingsTotals.rawWeight,
                            lang,
                          )
                        : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {hasHoldingsSelection
                        ? `${(holdingsTotals.displayWeight * 100).toFixed(1)}%`
                        : "—"}
                    </td>
                    <td
                      className={`py-2.5 pr-3 text-right tabular-nums ${
                        hasHoldingsSelection
                          ? totalRet.className
                          : "text-[var(--text-dim)]"
                      }${totalRetDim ? " opacity-60" : ""}`}
                      title={
                        totalRetDim
                          ? t("clients.return.reportedFallback")
                          : undefined
                      }
                    >
                      {hasHoldingsSelection ? totalRet.text : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-[var(--text-dim)]">
                      {hasHoldingsSelection
                        ? formatInvestedAt(holdingsTotals.investedAt)
                        : "—"}
                    </td>
                    <td
                      className={`py-2.5 pr-3 text-right tabular-nums ${
                        hasHoldingsSelection
                          ? totalCagr.className
                          : "text-[var(--text-dim)]"
                      }${totalCagrDim ? " opacity-60" : ""}`}
                      title={
                        totalCagrDim
                          ? t("clients.return.reportedFallback")
                          : undefined
                      }
                    >
                      {hasHoldingsSelection ? totalCagr.text : "—"}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
          </div>

          <ClientCustomizedHistoryPanel clientId={client.client_id} />
        </div>
      </main>
    </div>
  );
}

function HoldingsGroupRows({
  group,
  groupLabel,
  rawSubtotal,
  groupReturn,
  groupCagr,
  groupInvestedAt,
  aumUsd,
  selected,
  showCheckbox,
  checkboxDisabled,
  weightScale,
  onToggle,
  resolveCumulative,
  resolveCagr,
  realReturnsSettled,
  t,
  lang,
}: {
  group: ClientHoldingsGroup;
  groupLabel: string;
  /** Portfolio weight sum before selection renormalization. */
  rawSubtotal: number;
  /** Weighted aggregate return/CAGR + whether every value is real-priced. */
  groupReturn: WeightedHoldingReturn | undefined;
  groupCagr: WeightedHoldingReturn | undefined;
  groupInvestedAt: string | undefined;
  aumUsd: number;
  selected: boolean;
  showCheckbox: boolean;
  checkboxDisabled: boolean;
  /** Applied to displayed weights when selected (1 when unselected / no filter). */
  weightScale: number;
  onToggle: () => void;
  resolveCumulative: (h: ClientHolding) => ResolvedHoldingReturn;
  resolveCagr: (h: ClientHolding) => ResolvedHoldingReturn;
  realReturnsSettled: boolean;
  t: TFn;
  lang: Lang;
}) {
  const groupRet = formatReturnYtd(groupReturn?.pct, {
    isCash: group.type === "cash",
  });
  const groupCagrFmt = formatReturnYtd(groupCagr?.pct, {
    isCash: group.type === "cash",
  });
  const groupRetDim =
    realReturnsSettled && groupReturn?.pct != null && !groupReturn.allReal;
  const groupCagrDim =
    realReturnsSettled && groupCagr?.pct != null && !groupCagr.allReal;
  const muted = !selected;
  const blank = "—";
  const displaySubtotal = rawSubtotal * weightScale;
  const headerText = muted
    ? "text-[var(--text-dim)]"
    : "text-[var(--foreground)]";
  const rowMuted = muted ? "text-[var(--text-dim)] opacity-60" : "";

  return (
    <>
      <tr
        className={`border-b border-[var(--border)] bg-[var(--surface)] ${
          muted ? "opacity-60" : ""
        }`}
      >
        <td
          colSpan={3}
          className={`py-2 pr-3 text-xs font-semibold uppercase tracking-wide ${headerText}`}
        >
          {showCheckbox ? (
            <label className="inline-flex cursor-pointer items-center gap-2 normal-case tracking-normal">
              <input
                type="checkbox"
                className="rounded border-[var(--border)] text-[var(--primary)] disabled:cursor-not-allowed"
                checked={selected}
                disabled={checkboxDisabled}
                onChange={onToggle}
                aria-label={groupLabel}
              />
              <span className="uppercase tracking-wide">{groupLabel}</span>
            </label>
          ) : (
            groupLabel
          )}
        </td>
        <td className="py-2 pr-3 text-right text-xs tabular-nums text-[var(--text-dim)]">
          {muted ? blank : formatHoldingAmount(aumUsd, rawSubtotal, lang)}
        </td>
        <td className="py-2 pr-3 text-right text-xs tabular-nums text-[var(--text-dim)]">
          {muted ? blank : `${(displaySubtotal * 100).toFixed(1)}%`}
        </td>
        <td
          className={`py-2 pr-3 text-right text-xs tabular-nums ${
            muted ? "text-[var(--text-dim)]" : groupRet.className
          }${!muted && groupRetDim ? " opacity-60" : ""}`}
          title={
            !muted && groupRetDim
              ? t("clients.return.reportedFallback")
              : undefined
          }
        >
          {muted ? blank : groupRet.text}
        </td>
        <td className="py-2 pr-3 text-right text-xs tabular-nums text-[var(--text-dim)]">
          {muted ? blank : formatInvestedAt(groupInvestedAt)}
        </td>
        <td
          className={`py-2 pr-3 text-right text-xs tabular-nums ${
            muted ? "text-[var(--text-dim)]" : groupCagrFmt.className
          }${!muted && groupCagrDim ? " opacity-60" : ""}`}
          title={
            !muted && groupCagrDim
              ? t("clients.return.reportedFallback")
              : undefined
          }
        >
          {muted ? blank : groupCagrFmt.text}
        </td>
      </tr>
      {group.holdings.map((h) => {
        const cum = resolveCumulative(h);
        const ret = formatReturnYtd(cum.pct, {
          isCash: isCashHolding(h),
        });
        const cagrR = resolveCagr(h);
        const cagr = formatReturnYtd(cagrR.pct, {
          isCash: isCashHolding(h),
        });
        const retDim = realReturnsSettled && cum.pct != null && !cum.real;
        const cagrDim = realReturnsSettled && cagrR.pct != null && !cagrR.real;
        const displayWeight = h.weight * weightScale;
        return (
          <tr
            key={`${group.id}-${h.ticker}-${h.weight}`}
            className={`border-b border-[var(--border)]/60 ${rowMuted}`}
          >
            <td className="py-2.5 pr-3 pl-3 font-medium">{h.ticker}</td>
            <td
              className={`py-2.5 pr-3 ${
                muted ? "" : "text-[var(--ui-color-body)]"
              }`}
            >
              {holdingDisplayName(h, t, lang)}
            </td>
            <td className="py-2.5 pr-3">
              {productTypeLabel(t, resolveHoldingProductType(h))}
            </td>
            <td className="py-2.5 pr-3 text-right tabular-nums">
              {muted ? blank : formatHoldingAmount(aumUsd, h.weight, lang)}
            </td>
            <td className="py-2.5 pr-3 text-right tabular-nums">
              {muted ? blank : `${(displayWeight * 100).toFixed(1)}%`}
            </td>
            <td
              className={`py-2.5 pr-3 text-right tabular-nums ${
                muted ? "text-[var(--text-dim)]" : ret.className
              }${!muted && retDim ? " opacity-60" : ""}`}
              title={
                !muted && retDim
                  ? t("clients.return.reportedFallback")
                  : undefined
              }
            >
              {muted ? blank : ret.text}
            </td>
            <td className="py-2.5 pr-3 text-right tabular-nums text-[var(--text-dim)]">
              {muted ? blank : formatInvestedAt(h.invested_at)}
            </td>
            <td
              className={`py-2.5 pr-3 text-right tabular-nums ${
                muted ? "text-[var(--text-dim)]" : cagr.className
              }${!muted && cagrDim ? " opacity-60" : ""}`}
              title={
                !muted && cagrDim
                  ? t("clients.return.reportedFallback")
                  : undefined
              }
            >
              {muted ? blank : cagr.text}
            </td>
          </tr>
        );
      })}
    </>
  );
}

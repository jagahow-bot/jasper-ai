"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Cell,
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
import {
  buildClientHoldingsPie,
  buildClientPerformanceSeries,
  defaultCustomizationPortfolioName,
  formatUpcomingEvent,
  formatUsd,
  getClientHoldingsGroups,
  getDemoClientById,
  getUpcomingEvents,
  holdingDisplayName,
  holdingCagr,
  holdingsFromSelectedGroups,
  holdingsGroupCagr,
  holdingsGroupInvestedAt,
  holdingsGroupLabel,
  holdingsGroupReturnYtd,
  holdingsGroupWeight,
  isCashHolding,
  localizedText,
  resolveAnchorIdFromScope,
  resolveHoldingProductType,
  selectedGroupsWeightScale,
  type ClientHoldingsGroup,
  type ClientUpcomingEvent,
} from "@/lib/clients";
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

/** Format return_ytd / cagr percent points with sign + emerald/red coloring. Cash → —. */
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
  const [extraNotes, setExtraNotes] = useState<ClientExtraNote[]>([]);
  const [extraEvents, setExtraEvents] = useState<ClientUpcomingEvent[]>([]);
  const [addingNote, setAddingNote] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [addingEvent, setAddingEvent] = useState(false);
  const [eventDateDraft, setEventDateDraft] = useState("");
  const [eventLabelDraft, setEventLabelDraft] = useState("");

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
      const returnYtd = totalGroup
        ? holdingsGroupReturnYtd(totalGroup)
        : undefined;
      const cagr = totalGroup
        ? holdingsGroupCagr(totalGroup, client?.as_of_date)
        : undefined;
      const investedAt = totalGroup
        ? holdingsGroupInvestedAt(totalGroup)
        : undefined;
      return { rawWeight, displayWeight, returnYtd, cagr, investedAt };
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
    const returnYtd = flatGroup
      ? holdingsGroupReturnYtd(flatGroup)
      : undefined;
    const cagr = flatGroup
      ? holdingsGroupCagr(flatGroup, client?.as_of_date)
      : undefined;
    const investedAt = flatGroup
      ? holdingsGroupInvestedAt(flatGroup)
      : undefined;
    return { rawWeight, displayWeight: rawWeight, returnYtd, cagr, investedAt };
  }, [
    hasGroupedHoldings,
    holdingsGroups,
    selectedGroupIds,
    weightScale,
    chartHoldings,
    client,
  ]);

  const pieData = useMemo(
    () =>
      buildClientHoldingsPie(chartHoldings, {
        renormalize: canFilterGroups,
      }),
    [chartHoldings, canFilterGroups],
  );
  const navSeries = useMemo(
    () =>
      client
        ? buildClientPerformanceSeries({
            client_id: client.client_id,
            as_of_date: client.as_of_date,
            risk_profile: client.risk_profile,
            holdings: chartHoldings,
          })
        : [],
    [client, chartHoldings],
  );

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

  const totalRet = formatReturnYtd(holdingsTotals.returnYtd);
  const totalCagr = formatReturnYtd(holdingsTotals.cagr);
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
        <div>
          <Link
            href="/clients"
            className="text-sm text-[var(--primary)] hover:underline"
          >
            ← {t("clients.backToList")}
          </Link>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="ui-panel-title">{name}</h1>
            <span className="shrink-0 text-xs text-[var(--text-dim)]">
              {t("clients.clientId")}: {client.client_id}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <p className="ui-hint text-right">
            {t("clients.asOf")} {client.as_of_date}
          </p>

          <div className="grid gap-4 lg:grid-cols-[minmax(220px,280px)_1fr]">
          <section className="pixel-panel space-y-2.5">
            <h2 className="ui-section-title">{t("clients.profile")}</h2>
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="ui-section-title">{t("clients.holdings")}</h2>
              <Link href={launchHref} className="pixel-btn shrink-0 px-3 py-1.5">
                {t("clients.launchCta")}
              </Link>
            </div>
            <div className="mt-4 overflow-x-auto">
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
                                ? holdingsGroupReturnYtd(group)
                                : undefined
                            }
                            groupCagr={
                              selected
                                ? holdingsGroupCagr(group, client.as_of_date)
                                : undefined
                            }
                            groupInvestedAt={
                              selected
                                ? holdingsGroupInvestedAt(group)
                                : undefined
                            }
                            asOfDate={client.as_of_date}
                            aumUsd={client.aum_usd}
                            selected={selected}
                            showCheckbox={canFilterGroups}
                            checkboxDisabled={
                              selected && selectedGroupIds.length <= 1
                            }
                            weightScale={selected ? weightScale : 1}
                            onToggle={() => toggleGroup(group.id)}
                            t={t}
                            lang={lang}
                          />
                        );
                      })
                    : client.holdings.map((h) => {
                        const ret = formatReturnYtd(h.return_ytd, {
                          isCash: isCashHolding(h),
                        });
                        const cagr = formatReturnYtd(
                          holdingCagr(h, client.as_of_date),
                          {
                            isCash: isCashHolding(h),
                          },
                        );
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
                              className={`py-2.5 pr-3 text-right tabular-nums ${ret.className}`}
                            >
                              {ret.text}
                            </td>
                            <td className="py-2.5 pr-3 text-right tabular-nums text-[var(--text-dim)]">
                              {formatInvestedAt(h.invested_at)}
                            </td>
                            <td
                              className={`py-2.5 pr-3 text-right tabular-nums ${cagr.className}`}
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
                      }`}
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
                      }`}
                    >
                      {hasHoldingsSelection ? totalCagr.text : "—"}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div>
                <h3 className="text-sm font-medium text-[var(--foreground)]">
                  {t("clients.chart.performance")}
                </h3>
                <div className="mt-2 h-56 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
                  {chartHoldings.length === 0 ? (
                    <p className="flex h-full items-center justify-center px-4 text-center text-sm text-[var(--text-dim)]">
                      {t("clients.chart.noGroupsSelected")}
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
                          width={42}
                        />
                        <Tooltip
                          content={
                            <ChartTooltip valueIsPct={false} valueDecimals={1} />
                          }
                        />
                        <Line
                          type="monotone"
                          dataKey="nav"
                          name={t("clients.chart.nav")}
                          stroke="#2563eb"
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-medium text-[var(--foreground)]">
                  {t("clients.chart.allocation")}
                </h3>
                <div className="mt-2 h-56 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
                  {pieData.length === 0 ? (
                    <p className="flex h-full items-center justify-center px-4 text-center text-sm text-[var(--text-dim)]">
                      {t("clients.chart.noGroupsSelected")}
                    </p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={pieData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={48}
                          outerRadius={80}
                        >
                          {pieData.map((_, i) => (
                            <Cell
                              key={pieData[i].name}
                              fill={HOLDING_COLORS[i % HOLDING_COLORS.length]}
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
                  )}
                </div>
              </div>
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
  asOfDate,
  aumUsd,
  selected,
  showCheckbox,
  checkboxDisabled,
  weightScale,
  onToggle,
  t,
  lang,
}: {
  group: ClientHoldingsGroup;
  groupLabel: string;
  /** Portfolio weight sum before selection renormalization. */
  rawSubtotal: number;
  groupReturn: number | undefined;
  groupCagr: number | undefined;
  groupInvestedAt: string | undefined;
  asOfDate: string;
  aumUsd: number;
  selected: boolean;
  showCheckbox: boolean;
  checkboxDisabled: boolean;
  /** Applied to displayed weights when selected (1 when unselected / no filter). */
  weightScale: number;
  onToggle: () => void;
  t: TFn;
  lang: Lang;
}) {
  const groupRet = formatReturnYtd(groupReturn, {
    isCash: group.type === "cash",
  });
  const groupCagrFmt = formatReturnYtd(groupCagr, {
    isCash: group.type === "cash",
  });
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
          }`}
        >
          {muted ? blank : groupRet.text}
        </td>
        <td className="py-2 pr-3 text-right text-xs tabular-nums text-[var(--text-dim)]">
          {muted ? blank : formatInvestedAt(groupInvestedAt)}
        </td>
        <td
          className={`py-2 pr-3 text-right text-xs tabular-nums ${
            muted ? "text-[var(--text-dim)]" : groupCagrFmt.className
          }`}
        >
          {muted ? blank : groupCagrFmt.text}
        </td>
      </tr>
      {group.holdings.map((h) => {
        const ret = formatReturnYtd(h.return_ytd, {
          isCash: isCashHolding(h),
        });
        const cagr = formatReturnYtd(holdingCagr(h, asOfDate), {
          isCash: isCashHolding(h),
        });
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
              }`}
            >
              {muted ? blank : ret.text}
            </td>
            <td className="py-2.5 pr-3 text-right tabular-nums text-[var(--text-dim)]">
              {muted ? blank : formatInvestedAt(h.invested_at)}
            </td>
            <td
              className={`py-2.5 pr-3 text-right tabular-nums ${
                muted ? "text-[var(--text-dim)]" : cagr.className
              }`}
            >
              {muted ? blank : cagr.text}
            </td>
          </tr>
        );
      })}
    </>
  );
}

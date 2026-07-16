"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { AppNav } from "@/components/AppNav";
import {
  formatUpcomingEvent,
  formatUsd,
  getDemoClientById,
  getUpcomingEvents,
  holdingDisplayName,
  localizedText,
} from "@/lib/clients";
import { getPortfolioLabel } from "@/lib/model-portfolios";
import {
  getManagedPortfolioById,
  resolveSuggestedAnchorId,
} from "@/lib/model-portfolios-store";
import {
  assetClassLabel,
  esgPreferenceLabel,
  riskProfileLabel,
  useI18n,
} from "@/lib/i18n";

export default function ClientDashboardPage() {
  const { t, lang } = useI18n();
  const params = useParams();
  const id = typeof params?.id === "string" ? params.id : "";
  const client = useMemo(() => getDemoClientById(id), [id]);

  const launchHref = useMemo(() => {
    if (!client) return "/";
    const anchor = resolveSuggestedAnchorId(
      client.suggested_model_portfolio_id,
      client.risk_profile,
    );
    const q = new URLSearchParams({
      client: client.client_id,
      anchor,
    });
    return `/?${q.toString()}`;
  }, [client]);

  const suggested = client?.suggested_model_portfolio_id
    ? getManagedPortfolioById(client.suggested_model_portfolio_id)
    : undefined;

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

  const name = localizedText(client.display_name, lang);
  const upcomingEvents = getUpcomingEvents(client);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppNav subtitle={t("clients.detailSubtitle")} />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              href="/clients"
              className="text-sm text-[var(--primary)] hover:underline"
            >
              ← {t("clients.backToList")}
            </Link>
            <h1 className="mt-2 ui-panel-title">{name}</h1>
            <p className="mt-1 ui-hint">
              {client.client_id} · {client.segment} · {t("clients.asOf")}{" "}
              {client.as_of_date}
            </p>
          </div>
          <Link href={launchHref} className="pixel-btn shrink-0">
            {t("clients.launchCta")}
          </Link>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <section className="pixel-panel lg:col-span-1 space-y-3">
            <h2 className="ui-section-title">{t("clients.profile")}</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="ui-hint">{t("clients.age")}</dt>
                <dd className="font-medium">
                  {client.age}
                  {t("clients.ageUnit")}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="ui-hint">{t("clients.risk")}</dt>
                <dd className="font-medium">
                  {riskProfileLabel(t, client.risk_profile)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="ui-hint">{t("clients.aum")}</dt>
                <dd className="font-medium">{formatUsd(client.aum_usd, lang)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="ui-hint">{t("clients.cash")}</dt>
                <dd className="font-medium">{formatUsd(client.cash_usd, lang)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="ui-hint">{t("clients.horizon")}</dt>
                <dd className="font-medium text-right">
                  {localizedText(client.investment_horizon, lang)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="ui-hint">{t("clients.esg")}</dt>
                <dd className="font-medium">
                  {client.preferences.esg
                    ? esgPreferenceLabel(t, client.preferences.esg)
                    : "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="ui-hint">{t("clients.rm")}</dt>
                <dd className="font-medium">{client.rm_owner}</dd>
              </div>
            </dl>
            <div className="saas-inset text-sm">
              <p className="ui-hint">{t("clients.liquidity")}</p>
              <p className="mt-1 text-[var(--ui-color-body)]">
                <span className="text-[var(--text-dim)]">{t("clients.notePrefix")}</span>{" "}
                {localizedText(client.liquidity_notes, lang)}
              </p>
            </div>
            {suggested ? (
              <div className="saas-inset text-sm">
                <p className="ui-hint">{t("clients.suggestedAnchor")}</p>
                <p className="mt-1 font-medium text-[var(--foreground)]">
                  {getPortfolioLabel(suggested, lang)}
                </p>
              </div>
            ) : null}
            <div className="text-sm">
              <p className="ui-hint">{t("clients.notes")}</p>
              <p className="mt-1 text-[var(--ui-color-body)]">
                <span className="text-[var(--text-dim)]">{t("clients.notePrefix")}</span>{" "}
                {localizedText(client.notes, lang)}
              </p>
            </div>
            {upcomingEvents.length > 0 ? (
              <div className="saas-inset text-sm">
                <p className="ui-hint">{t("clients.upcomingEvents")}</p>
                <ul className="mt-1.5 space-y-1 text-[var(--ui-color-body)]">
                  {upcomingEvents.map((ev) => (
                    <li key={ev.id}>
                      <span className="text-[var(--text-dim)]">• </span>
                      {formatUpcomingEvent(ev, lang)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="pixel-panel lg:col-span-2">
            <h2 className="ui-section-title">{t("clients.holdings")}</h2>
            <p className="mt-1 ui-hint">{t("clients.holdingsHint")}</p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-[var(--text-dim)]">
                    <th className="py-2 pr-3 font-medium">{t("pool.col.ticker")}</th>
                    <th className="py-2 pr-3 font-medium">{t("pool.col.name")}</th>
                    <th className="py-2 pr-3 font-medium">{t("pool.col.assetClass")}</th>
                    <th className="py-2 pr-3 font-medium text-right">
                      {t("clients.weight")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {client.holdings.map((h) => (
                    <tr
                      key={`${h.ticker}-${h.weight}`}
                      className="border-b border-[var(--border)]/60"
                    >
                      <td className="py-2.5 pr-3 font-medium">{h.ticker}</td>
                      <td className="py-2.5 pr-3 text-[var(--ui-color-body)]">
                        {holdingDisplayName(h, t, lang)}
                      </td>
                      <td className="py-2.5 pr-3">
                        {assetClassLabel(t, h.asset_class)}
                      </td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">
                        {(h.weight * 100).toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="pixel-panel flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--ui-color-body)]">
            {t("clients.launchHint")}
          </p>
          <Link href={launchHref} className="pixel-btn">
            {t("clients.launchCta")}
          </Link>
        </div>
      </main>
    </div>
  );
}

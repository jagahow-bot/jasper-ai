"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AppNav } from "@/components/AppNav";
import {
  formatUpcomingEvent,
  formatUsd,
  getDemoClients,
  getUpcomingEvents,
  localizedText,
} from "@/lib/clients";
import { riskProfileLabel, useI18n } from "@/lib/i18n";

export default function ClientsPage() {
  const { t, lang } = useI18n();
  const clients = useMemo(() => getDemoClients(), []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppNav subtitle={t("clients.listSubtitle")} />
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        <div>
          <h1 className="ui-panel-title">{t("clients.listTitle")}</h1>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {clients.map((c) => {
            const name = localizedText(c.display_name, lang);
            const events = getUpcomingEvents(c);
            return (
              <Link
                key={c.client_id}
                href={`/clients/${c.client_id}`}
                className="pixel-panel block transition hover:border-[var(--primary)]/40 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-base font-semibold text-[var(--foreground)]">
                    {name}
                  </h2>
                  <p className="shrink-0 text-xs text-[var(--text-dim)]">
                    {t("clients.clientId")}: {c.client_id}
                  </p>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="pixel-badge">
                    {riskProfileLabel(t, c.risk_profile)}
                  </span>
                  <span className="pixel-badge">{c.segment}</span>
                  <span className="pixel-badge">
                    {c.age}
                    {t("clients.ageUnit")}
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="ui-hint">{t("clients.aum")}</dt>
                    <dd className="font-medium">{formatUsd(c.aum_usd, lang)}</dd>
                  </div>
                  <div>
                    <dt className="ui-hint">{t("clients.cash")}</dt>
                    <dd className="font-medium">{formatUsd(c.cash_usd, lang)}</dd>
                  </div>
                </dl>
                <p className="mt-3 line-clamp-2 text-sm text-[var(--ui-color-body)]">
                  <span className="text-[var(--text-dim)]">{t("clients.notePrefix")}</span>{" "}
                  {localizedText(c.liquidity_notes, lang)}
                </p>
                {events.length > 0 ? (
                  <div className="mt-2.5 border-t border-[var(--border)]/70 pt-2.5">
                    <p className="text-xs font-medium text-[var(--text-dim)]">
                      {t("clients.upcomingEvents")}
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs text-[var(--ui-color-body)]">
                      {events.map((ev) => (
                        <li key={ev.id} className="truncate">
                          <span className="text-[var(--text-dim)]">• </span>
                          {formatUpcomingEvent(ev, lang)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}

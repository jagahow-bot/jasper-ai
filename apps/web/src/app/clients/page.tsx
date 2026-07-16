"use client";

import Link from "next/link";
import { useMemo } from "react";
import { AppNav } from "@/components/AppNav";
import {
  formatUsd,
  getDemoClients,
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
          <p className="mt-2 ui-hint">{t("clients.listHint")}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {clients.map((c) => {
            const name = localizedText(c.display_name, lang);
            return (
              <Link
                key={c.client_id}
                href={`/clients/${c.client_id}`}
                className="pixel-panel block transition hover:border-[var(--primary)]/40 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-[var(--foreground)]">
                      {name}
                    </h2>
                    <p className="mt-1 text-sm text-[var(--text-dim)]">
                      {c.client_id} · {c.segment} · {c.age}
                      {t("clients.ageUnit")}
                    </p>
                  </div>
                  <span className="pixel-badge">
                    {riskProfileLabel(t, c.risk_profile)}
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
                  {localizedText(c.liquidity_notes, lang)}
                </p>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}

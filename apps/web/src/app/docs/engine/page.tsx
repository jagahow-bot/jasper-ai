"use client";

import { useEffect, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { useI18n } from "@/lib/i18n";
import stageCards from "@/data/stage-cards.json";

type StageCard = {
  stage: string;
  implementation_id: string;
  version: string;
  summary: Record<string, string>;
  inputs: Array<{ name: string; type: string; meaning: string }>;
  outputs: Array<{ name: string; type: string; meaning: string }>;
  invariants: string[];
};

type StageCardsDoc = {
  catalog_version: string;
  stage_implementations: Record<string, string>;
  cards: StageCard[];
};

export default function EngineCapabilitiesDocsPage() {
  const { t, lang } = useI18n();
  const [doc, setDoc] = useState<StageCardsDoc>(stageCards as StageCardsDoc);

  useEffect(() => {
    // Prefer live API when available; fall back to synced JSON.
    void fetch("/api/stage-cards")
      .then((r) => (r.ok ? r.json() : null))
      .then((live) => {
        if (live?.cards) setDoc(live as StageCardsDoc);
      })
      .catch(() => undefined);
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <AppNav subtitle={t("engineDocs.subtitle")} />
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="font-serif text-3xl tracking-tight">
          {t("engineDocs.title")}
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          {t("engineDocs.lead")} · catalog {doc.catalog_version}
        </p>

        <div className="mt-8 space-y-6">
          {doc.cards.map((card) => (
            <section
              key={`${card.stage}-${card.implementation_id}`}
              className="border-t border-slate-200 pt-4"
            >
              <h2 className="text-xl font-medium">
                {card.stage}{" "}
                <span className="text-sm font-normal text-slate-500">
                  {card.implementation_id}@{card.version}
                </span>
              </h2>
              <p className="mt-2 text-sm text-slate-700">
                {card.summary?.[lang] || card.summary?.en || card.summary?.zh}
              </p>
              {card.invariants?.length ? (
                <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">
                  {card.invariants.map((inv) => (
                    <li key={inv}>{inv}</li>
                  ))}
                </ul>
              ) : null}
              {(card.inputs?.length || card.outputs?.length) ? (
                <div className="mt-3 grid gap-3 text-xs md:grid-cols-2">
                  <div>
                    <div className="font-medium">Inputs</div>
                    <ul className="mt-1 space-y-1 text-slate-600">
                      {(card.inputs || []).slice(0, 8).map((i) => (
                        <li key={i.name}>
                          <code>{i.name}</code>: {i.type}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="font-medium">Outputs</div>
                    <ul className="mt-1 space-y-1 text-slate-600">
                      {(card.outputs || []).slice(0, 8).map((o) => (
                        <li key={o.name}>
                          <code>{o.name}</code>: {o.type}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}

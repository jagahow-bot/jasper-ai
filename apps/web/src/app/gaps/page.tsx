"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppNav } from "@/components/AppNav";
import { useI18n } from "@/lib/i18n";

type GapTicket = {
  ticket_id: string;
  stage: string;
  kind: string;
  missing_capability: string;
  status: string;
  reuse_count: number;
  summary_i18n?: Record<string, string>;
  updated_at?: string;
  nearest_supported?: Record<string, unknown> | null;
};

const API = process.env.NEXT_PUBLIC_QUANT_API_BASE || "http://127.0.0.1:8001";

export default function GapsBacklogPage() {
  const { t, lang } = useI18n();
  const [tickets, setTickets] = useState<GapTicket[]>([]);
  const [stage, setStage] = useState("all");
  const [status, setStatus] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GapTicket | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (stage !== "all") qs.set("stage", stage);
      if (status !== "all") qs.set("status", status);
      const res = await fetch(`${API}/gaps?${qs.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as GapTicket[];
      setTickets(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load_failed");
    }
  }, [stage, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const stages = useMemo(
    () => [
      "all",
      "universe",
      "signals",
      "allocator",
      "constraints",
      "objective",
      "rebalance",
      "cash_schedule",
      "reporting",
    ],
    [],
  );

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <AppNav subtitle={t("gaps.subtitle")} />
      <div className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="font-serif text-3xl tracking-tight">{t("gaps.title")}</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">{t("gaps.lead")}</p>

        <div className="mt-6 flex flex-wrap gap-3">
          <label className="text-sm">
            Stage{" "}
            <select
              className="ml-1 border border-slate-300 bg-white px-2 py-1"
              value={stage}
              onChange={(e) => setStage(e.target.value)}
            >
              {stages.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Status{" "}
            <select
              className="ml-1 border border-slate-300 bg-white px-2 py-1"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {[
                "all",
                "open",
                "triaged",
                "drafted",
                "in_review",
                "merged",
                "rejected",
                "blocked_model_unavailable",
              ].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="border border-slate-300 bg-white px-3 py-1 text-sm"
            onClick={() => void load()}
          >
            Refresh
          </button>
        </div>

        {error ? (
          <p className="mt-4 text-sm text-red-700">{error}</p>
        ) : null}

        <ul className="mt-6 divide-y divide-slate-200 border border-slate-200 bg-white">
          {tickets.map((ticket) => (
            <li key={ticket.ticket_id}>
              <button
                type="button"
                className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left hover:bg-slate-50"
                onClick={() => setSelected(ticket)}
              >
                <div>
                  <div className="font-medium">
                    {ticket.ticket_id} · {ticket.missing_capability}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {ticket.stage} · {ticket.kind} ·{" "}
                    {ticket.summary_i18n?.[lang] ||
                      ticket.summary_i18n?.zh ||
                      ticket.summary_i18n?.en ||
                      ""}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs">
                  <div className="rounded bg-amber-50 px-2 py-0.5 text-amber-900">
                    {ticket.status}
                  </div>
                  <div className="mt-1 text-slate-500">
                    reuse ×{ticket.reuse_count}
                  </div>
                </div>
              </button>
            </li>
          ))}
          {tickets.length === 0 ? (
            <li className="px-4 py-8 text-sm text-slate-500">{t("gaps.empty")}</li>
          ) : null}
        </ul>

        {selected ? (
          <aside className="mt-6 border border-slate-200 bg-white p-4">
            <h2 className="text-lg font-medium">{selected.ticket_id}</h2>
            <pre className="mt-3 overflow-auto text-xs text-slate-700">
              {JSON.stringify(selected, null, 2)}
            </pre>
          </aside>
        ) : null}
      </div>
    </main>
  );
}

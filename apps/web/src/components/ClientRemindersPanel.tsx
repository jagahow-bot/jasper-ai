"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEMO_CLIENTS_OVERRIDES_STORAGE_KEY,
  getClientReminders,
  setClientReminderStatus,
} from "@/lib/demo-clients-store";
import { formatHistoryDate } from "@/lib/backtest-history";
import {
  NEEDS_TABLE_I18N,
  type NeedsFloorRowKey,
} from "@/lib/needs-fulfillment";
import { rebalanceFreqLabel, useI18n } from "@/lib/i18n";
import {
  todayIsoDate,
  type ClientReminder,
  type ReminderRuleId,
  type ReminderStatus,
} from "@/lib/reminders";

type Props = {
  clientId: string;
};

type FilterId = "all" | "open" | "done" | "dismissed";

function ruleBadgeClass(rule: ReminderRuleId): string {
  if (rule === "R1") return "pixel-badge pixel-badge-rose";
  if (rule === "R2" || rule === "R3") return "pixel-badge pixel-badge-cyan";
  if (rule === "R4") return "pixel-badge pixel-badge-warn";
  if (rule === "R6") return "pixel-badge pixel-badge-slate";
  return "pixel-badge";
}

function isOpenish(status: ReminderStatus): boolean {
  return status === "open" || status === "suggested";
}

function sortReminders(
  rows: ClientReminder[],
  today: string,
): ClientReminder[] {
  return [...rows].sort((a, b) => {
    const aOpen = isOpenish(a.status) ? 0 : 1;
    const bOpen = isOpenish(b.status) ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;

    const aOverdue =
      a.due_date && a.due_date < today && isOpenish(a.status) ? 0 : 1;
    const bOverdue =
      b.due_date && b.due_date < today && isOpenish(b.status) ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;

    const aDue = a.due_date ?? "9999-99-99";
    const bDue = b.due_date ?? "9999-99-99";
    if (aDue !== bDue) return aDue.localeCompare(bDue);

    return b.created_at.localeCompare(a.created_at);
  });
}

export function ClientRemindersPanel({ clientId }: Props) {
  const { t, lang } = useI18n();
  const [rows, setRows] = useState<ClientReminder[]>([]);
  const [filter, setFilter] = useState<FilterId>("all");

  const refresh = useCallback(() => {
    setRows(getClientReminders(clientId));
  }, [clientId]);

  useEffect(() => {
    setFilter("all");
    refresh();
  }, [clientId, refresh]);

  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === DEMO_CLIENTS_OVERRIDES_STORAGE_KEY) {
        refresh();
      }
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
    };
  }, [refresh]);

  const today = todayIsoDate();
  const locale =
    lang === "zh" ? "zh-TW" : lang === "ko" ? "ko-KR" : "en-US";

  const counts = useMemo(() => {
    const open = rows.filter((r) => isOpenish(r.status)).length;
    const done = rows.filter((r) => r.status === "done").length;
    const dismissed = rows.filter((r) => r.status === "dismissed").length;
    return { all: rows.length, open, done, dismissed };
  }, [rows]);

  const visible = useMemo(() => {
    const filtered =
      filter === "all"
        ? rows
        : filter === "open"
          ? rows.filter((r) => isOpenish(r.status))
          : rows.filter((r) => r.status === filter);
    return sortReminders(filtered, today);
  }, [rows, filter, today]);

  const formatDue = (iso: string) => {
    const d = new Date(`${iso}T12:00:00Z`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  const titleFor = (r: ClientReminder): string => {
    if (r.rule_id === "R1" && r.subject === "class_quota_unfilled") {
      return t("reminders.rule.r1.quotaTitle", {
        classes: String(r.params?.classes ?? ""),
      });
    }
    if (r.rule_id === "R1") {
      const i18nKey =
        NEEDS_TABLE_I18N[r.subject as NeedsFloorRowKey] ?? r.subject;
      const subjectLabel = t(i18nKey);
      return t("reminders.rule.r1.title", {
        subject: subjectLabel === i18nKey ? r.subject : subjectLabel,
      });
    }
    if (r.rule_id === "R2") return t("reminders.rule.r2.title");
    if (r.rule_id === "R3") {
      return t("reminders.rule.r3.title", {
        k: Number(r.params?.k ?? 0),
        n: Number(r.params?.n ?? 0),
      });
    }
    if (r.rule_id === "R4" && r.subject === "supervisor-drift") {
      return t("reminders.rule.r4.driftTitle", {
        pct: Number(r.params?.pct ?? 0),
      });
    }
    if (r.rule_id === "R4" && r.subject === "supervisor-capability") {
      return t("reminders.rule.r4.capabilityTitle", {
        count: Number(r.params?.count ?? 0),
      });
    }
    if (r.rule_id === "R5") return t("reminders.rule.r5.title");
    if (r.rule_id === "R6") return t("reminders.rule.r6.title");
    return r.subject;
  };

  const detailFor = (r: ClientReminder): string | null => {
    if (r.rule_id === "R1" && r.subject === "class_quota_unfilled") {
      return t("reminders.rule.r1.quotaDetail");
    }
    if (r.rule_id === "R1") {
      return t("reminders.rule.r1.detail", {
        detail: String(r.params?.detail ?? ""),
      });
    }
    if (r.rule_id === "R2") {
      const freqRaw = String(r.params?.freq ?? "");
      return t("reminders.rule.r2.detail", {
        freq: rebalanceFreqLabel(t, freqRaw) || freqRaw,
        end: String(r.params?.end ?? ""),
      });
    }
    if (r.rule_id === "R3") {
      return t("reminders.rule.r3.detail", {
        k: Number(r.params?.k ?? 0),
      });
    }
    if (r.rule_id === "R6") return t("reminders.rule.r6.detail");
    return null;
  };

  const dueBadge = (r: ClientReminder) => {
    if (!r.due_date) return null;
    if (r.due_date < today && isOpenish(r.status)) {
      return (
        <span className="text-xs font-medium text-rose-600">
          {t("reminders.overdue", { date: formatDue(r.due_date) })}
        </span>
      );
    }
    if (r.due_date === today && isOpenish(r.status)) {
      return (
        <span className="text-xs font-medium text-amber-700">
          {t("reminders.dueToday")}
        </span>
      );
    }
    return (
      <span className="text-xs text-[var(--text-dim)]">
        {t("reminders.due", { date: formatDue(r.due_date) })}
      </span>
    );
  };

  const setStatus = (id: string, status: ReminderStatus) => {
    setClientReminderStatus(clientId, id, status);
    refresh();
  };

  const openCount = counts.open;
  const titleCount =
    openCount > 0
      ? `${t("reminders.panel.title")}（${openCount}）`
      : t("reminders.panel.title");

  const filters: { id: FilterId; label: string; count: number }[] = [
    { id: "all", label: t("reminders.filter.all"), count: counts.all },
    { id: "open", label: t("reminders.filter.open"), count: counts.open },
    { id: "done", label: t("reminders.filter.done"), count: counts.done },
    {
      id: "dismissed",
      label: t("reminders.filter.dismissed"),
      count: counts.dismissed,
    },
  ];

  return (
    <section id="reminders" className="pixel-panel scroll-mt-20">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="ui-section-title">{titleCount}</h2>
        <button
          type="button"
          className="ui-body text-[var(--primary)] hover:underline"
          onClick={refresh}
          title={t("history.refresh")}
          aria-label={t("history.refresh")}
        >
          ↻
        </button>
      </div>
      <p className="mb-3 ui-hint">{t("reminders.panel.hint")}</p>

      <div className="mb-3 flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={`pixel-chip ${filter === f.id ? "pixel-chip-active" : ""}`}
          >
            {f.label} {f.count}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="ui-body text-dim">{t("reminders.panel.empty")}</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((r) => {
            const href = `/?job=${encodeURIComponent(r.job_id)}&client=${encodeURIComponent(clientId)}`;
            const detail = detailFor(r);
            const ruleKey = `reminders.rule.${r.rule_id.toLowerCase()}.label`;
            return (
              <li
                key={r.id}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5 ui-body"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={`${ruleBadgeClass(r.rule_id)} text-[8px]`}>
                        {t(ruleKey)}
                      </span>
                      {r.status === "suggested" ? (
                        <span className="pixel-badge pixel-badge-slate text-[8px]">
                          {t("reminders.status.suggested")}
                        </span>
                      ) : null}
                      {dueBadge(r)}
                    </div>
                    <p className="font-medium text-[var(--foreground)]">
                      {titleFor(r)}
                    </p>
                    {detail ? (
                      <p className="ui-hint text-[var(--text-dim)]">{detail}</p>
                    ) : null}
                    <p className="ui-hint">
                      {formatHistoryDate(r.created_at)} ·{" "}
                      {r.job_id.slice(0, 8)}…
                      {" · "}
                      <Link
                        href={href}
                        className="text-[var(--primary)] hover:underline"
                      >
                        {t("reminders.action.openReport")}
                      </Link>
                    </p>
                    {r.status === "done" && r.resolved_by_job_id ? (
                      <p className="ui-hint text-emerald-700">
                        {t("reminders.resolvedAuto")}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-shrink-0 flex-wrap gap-1.5">
                    {r.status === "suggested" ? (
                      <>
                        <button
                          type="button"
                          className="pixel-btn px-2 py-1 text-xs"
                          onClick={() => setStatus(r.id, "open")}
                        >
                          {t("reminders.action.accept")}
                        </button>
                        <button
                          type="button"
                          className="pixel-btn px-2 py-1 text-xs"
                          onClick={() => setStatus(r.id, "dismissed")}
                        >
                          {t("reminders.action.dismiss")}
                        </button>
                      </>
                    ) : null}
                    {r.status === "open" ? (
                      <>
                        <button
                          type="button"
                          className="pixel-btn px-2 py-1 text-xs"
                          onClick={() => setStatus(r.id, "done")}
                        >
                          {t("reminders.action.done")}
                        </button>
                        <button
                          type="button"
                          className="pixel-btn px-2 py-1 text-xs"
                          onClick={() => setStatus(r.id, "dismissed")}
                        >
                          {t("reminders.action.dismiss")}
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * Auto-reminders: deterministic derive + merge for RM personal todos.
 * Storage I/O lives in demo-clients-store.ts; this module is pure.
 */

import type { DemoClient } from "@/lib/clients";
import { needsFloorRows } from "@/lib/needs-fulfillment";
import { driftOverrideApproval } from "@/lib/overlay-feasibility";
import { resolveChampionCandidateIndex } from "@/lib/performance-compare-chart";
import { pendingSupervisorCapabilities } from "@/lib/proposal-capability-badge";
import type { BacktestRequest, BacktestResult } from "@/lib/types";

/** Reminder rule ids. R5/R6 are Phase 2 (R6 derive still implemented). */
export type ReminderRuleId = "R1" | "R2" | "R3" | "R4" | "R5" | "R6";

/**
 * suggested：R6-style suggestions (RM must accept → open).
 * open：active todo. done：completed. dismissed：ignored.
 */
export type ReminderStatus = "suggested" | "open" | "done" | "dismissed";

export type ClientReminder = {
  id: string;
  client_id: string;
  rule_id: ReminderRuleId;
  /** Mechanical subject key, e.g. "drawdown", "rebalance", "dca-tranche-2". */
  subject: string;
  /** Idempotency: `${job_id}:${rule_id}:${subject}`. */
  dedupe_key: string;
  /** Continuity: `${rule_id}:${subject}` — one open/suggested per subject. */
  subject_key: string;
  job_id: string;
  last_seen_job_id: string;
  status: ReminderStatus;
  /** ISO date YYYY-MM-DD; omit when no due concept (e.g. R1). */
  due_date?: string;
  /** i18n interpolation params (copy assembled at render time). */
  params?: Record<string, string | number>;
  created_at: string;
  updated_at: string;
  closed_at?: string;
  /** Auto-close source job; manual close leaves undefined. */
  resolved_by_job_id?: string;
};

export const MAX_REMINDERS_PER_CLIENT = 100;
export const CLOSED_REMINDER_RETENTION_DAYS = 90;

const SCHEDULE_RULES: ReminderRuleId[] = ["R2", "R3", "R6"];

export type DeriveRemindersInput = {
  jobId: string;
  clientId: string;
  request: BacktestRequest;
  result: BacktestResult;
  /** R6 horizon fallback; omit to use client_context only. */
  client?: Pick<DemoClient, "investment_horizon"> | null;
  /** Injected clock for tests; default new Date(). */
  now?: Date;
};

export type MergeRemindersOpts = {
  now?: Date;
  /** Source job for auto-resolve when derived is empty. */
  jobId?: string;
  /**
   * When true, open/suggested R1 subjects absent from derived are auto-closed.
   * Set only when champion.needs_attainment was non-null (avoid false closes).
   */
  autoResolveR1?: boolean;
  /**
   * When true, open R4 supervisor-drift absent from derived is auto-closed
   * (drift no longer requires supervisor).
   */
  autoResolveR4Drift?: boolean;
  /**
   * When true, open R4 supervisor-capability absent from derived is auto-closed.
   * Set only when capabilities_used was defined (not undefined).
   */
  autoResolveR4Capability?: boolean;
};

export type MergeOutcome = {
  reminders: ClientReminder[];
  added: ClientReminder[];
  updated: ClientReminder[];
  autoResolved: ClientReminder[];
};

function newReminderId(): string {
  return `rem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** ISO date YYYY-MM-DD; UTC noon anchor avoids TZ day-flip. */
export function toIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseIsoDate(s: string): Date | null {
  const trimmed = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const d = new Date(`${trimmed}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function todayIsoDate(now?: Date): string {
  const d = now ?? new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Month-end clamp: 1/31 + 1mo → 2/28 (UTC date-setter; no roll into March). */
export function addMonthsClamped(isoDate: string, months: number): string {
  const base = parseIsoDate(isoDate);
  if (!base) return isoDate;
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const day = base.getUTCDate();
  const targetMonth = m + months;
  const targetY = y + Math.floor(targetMonth / 12);
  const targetM = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetY, targetM + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDay);
  return toIsoDate(new Date(Date.UTC(targetY, targetM, clampedDay, 12, 0, 0)));
}

/**
 * Next rebalance = one period after end_date.
 * Freq recognition mirrors rebalanceFreqLabel (i18n).
 */
export function nextRebalanceDate(
  endDate: string,
  freq: string,
): string | null {
  const base = parseIsoDate(endDate);
  if (!base) return null;
  const c = String(freq).trim().toUpperCase();
  if (!c) return null;
  if (c.startsWith("W")) {
    const next = new Date(base.getTime());
    next.setUTCDate(next.getUTCDate() + 7);
    return toIsoDate(next);
  }
  if (c === "ME" || c === "M" || c === "MS" || c.startsWith("MON")) {
    return addMonthsClamped(endDate, 1);
  }
  if (c.startsWith("Q")) {
    return addMonthsClamped(endDate, 3);
  }
  if (c.startsWith("Y") || c.startsWith("A")) {
    return addMonthsClamped(endDate, 12);
  }
  if (c === "D" || c.startsWith("DAY") || c === "B") {
    const next = new Date(base.getTime());
    next.setUTCDate(next.getUTCDate() + 1);
    return toIsoDate(next);
  }
  return null;
}

function makeReminder(args: {
  clientId: string;
  ruleId: ReminderRuleId;
  subject: string;
  jobId: string;
  status: ReminderStatus;
  now: Date;
  dueDate?: string;
  params?: Record<string, string | number>;
}): ClientReminder {
  const iso = args.now.toISOString();
  return {
    id: newReminderId(),
    client_id: args.clientId,
    rule_id: args.ruleId,
    subject: args.subject,
    dedupe_key: `${args.jobId}:${args.ruleId}:${args.subject}`,
    subject_key: `${args.ruleId}:${args.subject}`,
    job_id: args.jobId,
    last_seen_job_id: args.jobId,
    status: args.status,
    due_date: args.dueDate,
    params: args.params,
    created_at: iso,
    updated_at: iso,
  };
}

/** Pick up to `max` tranche indices, always including 1 and n. */
function selectTrancheIndices(n: number, max = 6): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i + 1);
  const indices = new Set<number>();
  for (let i = 0; i < max; i++) {
    const k = Math.round(1 + (i * (n - 1)) / (max - 1));
    indices.add(Math.max(1, Math.min(n, k)));
  }
  return Array.from(indices).sort((a, b) => a - b);
}

function parseHorizonYears(
  request: BacktestRequest,
  client?: Pick<DemoClient, "investment_horizon"> | null,
): number | null {
  const fromCtx = request.client_context?.investment_horizon_years;
  if (typeof fromCtx === "number" && Number.isFinite(fromCtx) && fromCtx >= 1) {
    return fromCtx;
  }
  if (!client?.investment_horizon) return null;
  const raw =
    typeof client.investment_horizon === "string"
      ? client.investment_horizon
      : client.investment_horizon.en;
  const match = String(raw).match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

/** Derive reminders from a completed customized job (pure; no I/O). */
export function deriveReminders(input: DeriveRemindersInput): ClientReminder[] {
  const clientId = input.clientId?.trim() ?? "";
  if (!clientId) return [];

  const { result, request, jobId } = input;
  const now = input.now ?? new Date();
  const completedDateIso = toIsoDate(now);
  const out: ClientReminder[] = [];

  const championIdx = resolveChampionCandidateIndex(
    result.candidates,
    result.narrative_facts,
  );
  if (championIdx < 0 || !result.candidates.length) return [];
  const champion = result.candidates[championIdx] ?? result.candidates[0];
  if (!champion) return [];

  // —— R1: unmet needs ——
  const na = champion.needs_attainment;
  if (na) {
    for (const row of needsFloorRows(na)) {
      if (row.pass !== false) continue;
      out.push(
        makeReminder({
          clientId,
          ruleId: "R1",
          subject: row.key,
          jobId,
          status: "open",
          now,
          params: { detail: row.detail ?? "" },
        }),
      );
    }
  }

  const unfilled = result.narrative_facts?.class_quota_unfilled;
  if (Array.isArray(unfilled) && unfilled.length > 0) {
    const classes = unfilled
      .map((r: { asset_class?: string }) => r?.asset_class)
      .filter((c): c is string => typeof c === "string" && c.length > 0)
      .join(", ");
    out.push(
      makeReminder({
        clientId,
        ruleId: "R1",
        subject: "class_quota_unfilled",
        jobId,
        status: "open",
        now,
        params: { classes },
      }),
    );
  }

  // —— R2: rebalance ——
  const freq = request.rebalance_freq;
  const endDate = request.end_date;
  if (freq && endDate) {
    const due = nextRebalanceDate(endDate, freq);
    if (due) {
      out.push(
        makeReminder({
          clientId,
          ruleId: "R2",
          subject: "rebalance",
          jobId,
          status: "open",
          now,
          dueDate: due,
          params: { freq, end: endDate },
        }),
      );
    }
  }

  // —— R3: DCA milestones ——
  const months = request.deployment_months;
  if (typeof months === "number" && months > 0) {
    const rawTranches = request.deployment_tranches ?? months;
    const n = Math.max(1, Math.floor(Number(rawTranches)));
    const indices = selectTrancheIndices(n, 6);
    const cashPct = request.cash_reserve_pct;
    for (const k of indices) {
      const offset = Math.round((k * months) / n);
      const params: Record<string, string | number> = { k, n };
      if (typeof cashPct === "number" && cashPct > 0) {
        params.cashPct = Math.round(cashPct * 1000) / 10;
      }
      out.push(
        makeReminder({
          clientId,
          ruleId: "R3",
          subject: `dca-tranche-${k}`,
          jobId,
          status: "open",
          now,
          dueDate: addMonthsClamped(completedDateIso, offset),
          params,
        }),
      );
    }
  }

  // —— R4: supervisor ——
  const drift = request.customization_drift ?? 0.5;
  const driftApproval = driftOverrideApproval(drift);
  if (driftApproval.requiresSupervisor) {
    out.push(
      makeReminder({
        clientId,
        ruleId: "R4",
        subject: "supervisor-drift",
        jobId,
        status: "open",
        now,
        dueDate: completedDateIso,
        params: { pct: Math.round(drift * 100) },
      }),
    );
  }

  if (result.capabilities_used !== undefined) {
    const pending = pendingSupervisorCapabilities(result.capabilities_used);
    if (pending.length > 0) {
      out.push(
        makeReminder({
          clientId,
          ruleId: "R4",
          subject: "supervisor-capability",
          jobId,
          status: "open",
          now,
          dueDate: completedDateIso,
          params: { count: pending.length },
        }),
      );
    }
  }

  // —— R6: annual review (Phase 2 UI; derive for tests) ——
  const horizon = parseHorizonYears(request, input.client);
  if (horizon != null && horizon >= 1) {
    out.push(
      makeReminder({
        clientId,
        ruleId: "R6",
        subject: "annual-review",
        jobId,
        status: "suggested",
        now,
        dueDate: addMonthsClamped(completedDateIso, 12),
      }),
    );
  }

  return out;
}

function isClosed(status: ReminderStatus): boolean {
  return status === "done" || status === "dismissed";
}

function isScheduleRule(rule: ReminderRuleId): boolean {
  return SCHEDULE_RULES.includes(rule);
}

function retentionCutoffIso(now: Date): string {
  const d = new Date(now.getTime());
  d.setUTCDate(d.getUTCDate() - CLOSED_REMINDER_RETENTION_DAYS);
  return d.toISOString();
}

function pruneReminders(
  list: ClientReminder[],
  now: Date,
): ClientReminder[] {
  const cutoff = retentionCutoffIso(now);
  let next = list.filter((r) => {
    if (!isClosed(r.status) || !r.closed_at) return true;
    return r.closed_at >= cutoff;
  });

  if (next.length <= MAX_REMINDERS_PER_CLIENT) return next;

  const closed = next
    .filter((r) => isClosed(r.status))
    .sort((a, b) => {
      const aKey = a.closed_at ?? a.updated_at;
      const bKey = b.closed_at ?? b.updated_at;
      return aKey.localeCompare(bKey);
    });
  const openish = next.filter((r) => !isClosed(r.status));
  const dropClosed = next.length - MAX_REMINDERS_PER_CLIENT;
  if (dropClosed <= closed.length) {
    const dropIds = new Set(closed.slice(0, dropClosed).map((r) => r.id));
    return next.filter((r) => !dropIds.has(r.id));
  }
  next = openish.concat(closed.slice(dropClosed));
  if (next.length <= MAX_REMINDERS_PER_CLIENT) return next;

  const byUpdated = [...next].sort((a, b) =>
    a.updated_at.localeCompare(b.updated_at),
  );
  const dropOpen = next.length - MAX_REMINDERS_PER_CLIENT;
  const dropIds = new Set(byUpdated.slice(0, dropOpen).map((r) => r.id));
  return next.filter((r) => !dropIds.has(r.id));
}

export function mergeReminders(
  existing: ClientReminder[],
  derived: ClientReminder[],
  opts: MergeRemindersOpts = {},
): MergeOutcome {
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const jobId =
    opts.jobId ??
    derived[0]?.job_id ??
    derived[0]?.last_seen_job_id ??
    "";

  const derivedSubjectKeys = new Set(derived.map((d) => d.subject_key));
  const existingDedupe = new Set(existing.map((e) => e.dedupe_key));

  let list = existing.map((r) => ({ ...r }));
  const added: ClientReminder[] = [];
  const updated: ClientReminder[] = [];
  const autoResolved: ClientReminder[] = [];

  // 4. Auto-resolve R1 / R4 (open/suggested only)
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    if (r.status !== "open" && r.status !== "suggested") continue;
    if (derivedSubjectKeys.has(r.subject_key)) continue;

    let shouldResolve = false;
    if (r.rule_id === "R1" && opts.autoResolveR1) {
      shouldResolve = true;
    } else if (
      r.rule_id === "R4" &&
      r.subject === "supervisor-drift" &&
      opts.autoResolveR4Drift
    ) {
      shouldResolve = true;
    } else if (
      r.rule_id === "R4" &&
      r.subject === "supervisor-capability" &&
      opts.autoResolveR4Capability
    ) {
      shouldResolve = true;
    }

    if (!shouldResolve) continue;
    const closed: ClientReminder = {
      ...r,
      status: "done",
      closed_at: nowIso,
      updated_at: nowIso,
      resolved_by_job_id: jobId || undefined,
    };
    list[i] = closed;
    autoResolved.push(closed);
  }

  // 1–3. Apply derived
  for (const d of derived) {
    if (existingDedupe.has(d.dedupe_key)) {
      continue;
    }

    const openIdx = list.findIndex(
      (e) =>
        e.subject_key === d.subject_key &&
        (e.status === "open" || e.status === "suggested"),
    );
    if (openIdx >= 0) {
      const prev = list[openIdx];
      const next: ClientReminder = {
        ...prev,
        last_seen_job_id: d.job_id,
        due_date: d.due_date,
        params: d.params,
        updated_at: nowIso,
      };
      list[openIdx] = next;
      updated.push(next);
      existingDedupe.add(d.dedupe_key);
      continue;
    }

    const closedSame = list.filter((e) => e.subject_key === d.subject_key);
    const hasDismissed = closedSame.some((e) => e.status === "dismissed");

    // Schedule (R2/R3/R6): respect dismiss — never rebuild.
    // Alert (R1/R4/R5): closed → recreate (fall through).
    if (isScheduleRule(d.rule_id) && hasDismissed) {
      continue;
    }

    const created: ClientReminder = {
      ...d,
      id: d.id || newReminderId(),
      updated_at: nowIso,
      created_at: d.created_at || nowIso,
    };
    list.push(created);
    added.push(created);
    existingDedupe.add(d.dedupe_key);
  }

  list = pruneReminders(list, now);

  return { reminders: list, added, updated, autoResolved };
}

/** Build auto-resolve flags from the same inputs used for derive. */
export function mergeOptsFromDeriveInput(
  input: DeriveRemindersInput,
): MergeRemindersOpts {
  const championIdx = resolveChampionCandidateIndex(
    input.result.candidates,
    input.result.narrative_facts,
  );
  const champion =
    championIdx >= 0
      ? input.result.candidates[championIdx]
      : input.result.candidates[0];
  return {
    now: input.now,
    jobId: input.jobId,
    autoResolveR1: champion?.needs_attainment != null,
    autoResolveR4Drift: true,
    autoResolveR4Capability: input.result.capabilities_used !== undefined,
  };
}

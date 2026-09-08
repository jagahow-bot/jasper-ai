import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEMO_CLIENTS_OVERRIDES_STORAGE_KEY,
  getClientReminders,
  mergeClientReminders,
  setClientReminderStatus,
} from "./demo-clients-store";
import {
  CLOSED_REMINDER_RETENTION_DAYS,
  MAX_REMINDERS_PER_CLIENT,
  addMonthsClamped,
  deriveReminders,
  mergeReminders,
  nextRebalanceDate,
  type ClientReminder,
  type DeriveRemindersInput,
} from "./reminders";
import type { BacktestRequest, BacktestResult, PortfolioCandidate } from "./types";

const NOW = new Date("2026-09-04T09:36:00Z");
const CLIENT = "client-demo-1";

function baseRequest(
  partial: Partial<BacktestRequest> = {},
): BacktestRequest {
  return {
    scenario_id: "test",
    max_weight: 0.3,
    objective: "max_sharpe",
    backtest_mode: "historical",
    start_date: "2020-01-01",
    end_date: "2026-08-31",
    trials: 10,
    top_models: 3,
    asset_classes: ["equity"],
    enable_oos: false,
    train_ratio: 0.7,
    fee_bps: 5,
    rebalance_freq: "ME",
    max_turnover: 1,
    ...partial,
  };
}

function candidate(
  partial: Partial<PortfolioCandidate> = {},
): PortfolioCandidate {
  return {
    model_code: "C1",
    sharpe: 1,
    cagr: 0.1,
    max_drawdown: -0.15,
    weights: { SPY: 1 },
    is_champion: true,
    ...partial,
  };
}

function baseResult(
  partial: Partial<BacktestResult> & {
    candidates?: PortfolioCandidate[];
  } = {},
): BacktestResult {
  const { candidates, ...rest } = partial;
  return {
    job_id: "job-a",
    candidates: candidates ?? [candidate()],
    narrative_facts: {},
    ...rest,
  } as BacktestResult;
}

function deriveInput(
  partial: Partial<DeriveRemindersInput> = {},
): DeriveRemindersInput {
  return {
    jobId: "job-a",
    clientId: CLIENT,
    request: baseRequest(),
    result: baseResult(),
    now: NOW,
    ...partial,
  };
}

function reminder(
  partial: Partial<ClientReminder> &
    Pick<ClientReminder, "id" | "rule_id" | "subject" | "job_id" | "status">,
): ClientReminder {
  const subject_key = `${partial.rule_id}:${partial.subject}`;
  const dedupe_key = `${partial.job_id}:${partial.rule_id}:${partial.subject}`;
  return {
    client_id: CLIENT,
    subject_key,
    dedupe_key,
    last_seen_job_id: partial.job_id,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...partial,
  };
}

describe("deriveReminders", () => {
  it("U1: empty clientId / no candidates → []", () => {
    expect(
      deriveReminders(deriveInput({ clientId: "  " })),
    ).toEqual([]);
    expect(
      deriveReminders(
        deriveInput({
          result: baseResult({ candidates: [] }),
        }),
      ),
    ).toEqual([]);
  });

  it("U2: R1 two failing needs rows", () => {
    const derived = deriveReminders(
      deriveInput({
        result: baseResult({
          candidates: [
            candidate({
              needs_attainment: {
                max_drawdown_tolerance: 0.1,
                max_drawdown_actual: 0.2,
                within_drawdown_tolerance: false,
                max_single_name_pct: 0.1,
                max_single_name_actual: 0.123,
                within_single_name_cap: false,
              },
            }),
          ],
        }),
      }),
    );
    const r1 = derived.filter((r) => r.rule_id === "R1");
    expect(r1).toHaveLength(2);
    expect(r1.map((r) => r.subject).sort()).toEqual(["drawdown", "singleName"]);
    expect(r1.every((r) => r.status === "open")).toBe(true);
    expect(r1.find((r) => r.subject === "drawdown")?.params?.detail).toContain(
      "%",
    );
    expect(
      r1.find((r) => r.subject === "singleName")?.params?.detail,
    ).toContain("%");
  });

  it("U3: R1 all pass / null → no R1", () => {
    expect(
      deriveReminders(
        deriveInput({
          result: baseResult({
            candidates: [
              candidate({
                needs_attainment: {
                  max_drawdown_tolerance: 0.2,
                  max_drawdown_actual: 0.1,
                  within_drawdown_tolerance: true,
                },
              }),
            ],
          }),
        }),
      ).filter((r) => r.rule_id === "R1"),
    ).toHaveLength(0);

    expect(
      deriveReminders(
        deriveInput({
          result: baseResult({
            candidates: [candidate({ needs_attainment: null })],
          }),
        }),
      ).filter((r) => r.rule_id === "R1"),
    ).toHaveLength(0);
  });

  it("U4: class_quota_unfilled + unmet classQuota coexist", () => {
    const derived = deriveReminders(
      deriveInput({
        result: baseResult({
          candidates: [
            candidate({
              needs_attainment: {
                within_class_quotas: false,
                class_quotas: [
                  {
                    asset_class: "bond",
                    target_pct: 0.2,
                    actual_pct: 0.05,
                    within_class_quota: false,
                  },
                ],
              },
            }),
          ],
          narrative_facts: {
            class_quota_unfilled: [
              { asset_class: "commodity", target_pct: 0.05 },
              { asset_class: "cash", target_pct: 0.1 },
            ],
          },
        }),
      }),
    );
    const r1 = derived.filter((r) => r.rule_id === "R1");
    expect(r1.some((r) => r.subject === "classQuota")).toBe(true);
    const unfilled = r1.find((r) => r.subject === "class_quota_unfilled");
    expect(unfilled).toBeTruthy();
    expect(unfilled?.params?.classes).toBe("commodity, cash");
  });

  it("U5: R2 next rebalance by freq", () => {
    expect(nextRebalanceDate("2026-08-31", "ME")).toBe("2026-09-30");
    expect(nextRebalanceDate("2026-08-31", "QE")).toBe("2026-11-30");
    expect(nextRebalanceDate("2026-08-31", "W-FRI")).toBe("2026-09-07");
    expect(nextRebalanceDate("2026-08-31", "YE")).toBe("2027-08-31");
    expect(nextRebalanceDate("2026-08-31", "XYZ")).toBeNull();

    const me = deriveReminders(
      deriveInput({
        request: baseRequest({ rebalance_freq: "ME", end_date: "2026-08-31" }),
      }),
    ).find((r) => r.rule_id === "R2");
    expect(me?.due_date).toBe("2026-09-30");
    expect(me?.subject).toBe("rebalance");

    expect(
      deriveReminders(
        deriveInput({
          request: baseRequest({ rebalance_freq: "NOPE", end_date: "2026-08-31" }),
        }),
      ).filter((r) => r.rule_id === "R2"),
    ).toHaveLength(0);
  });

  it("U6: month-end clamp is TZ-safe", () => {
    expect(addMonthsClamped("2026-01-31", 1)).toBe("2026-02-28");
    expect(nextRebalanceDate("2026-01-31", "ME")).toBe("2026-02-28");
  });

  it("U7: R3 DCA 3 tranches over 6 months", () => {
    const r3 = deriveReminders(
      deriveInput({
        request: baseRequest({
          deployment_months: 6,
          deployment_tranches: 3,
        }),
      }),
    ).filter((r) => r.rule_id === "R3");
    expect(r3).toHaveLength(3);
    expect(r3.map((r) => r.subject)).toEqual([
      "dca-tranche-1",
      "dca-tranche-2",
      "dca-tranche-3",
    ]);
    expect(r3.map((r) => r.due_date)).toEqual([
      "2026-11-04",
      "2027-01-04",
      "2027-03-04",
    ]);
  });

  it("U8: R3 caps at 6 including first and last", () => {
    const r3 = deriveReminders(
      deriveInput({
        request: baseRequest({
          deployment_months: 12,
          deployment_tranches: 12,
        }),
      }),
    ).filter((r) => r.rule_id === "R3");
    expect(r3).toHaveLength(6);
    expect(r3[0].subject).toBe("dca-tranche-1");
    expect(r3[r3.length - 1].subject).toBe("dca-tranche-12");
  });

  it("U9: cash_reserve alone does not derive R3", () => {
    expect(
      deriveReminders(
        deriveInput({
          request: baseRequest({
            cash_reserve_pct: 0.1,
            deployment_months: null,
            deployment_tranches: null,
          }),
        }),
      ).filter((r) => r.rule_id === "R3"),
    ).toHaveLength(0);
  });

  it("U10: R4 drift threshold", () => {
    const hi = deriveReminders(
      deriveInput({
        request: baseRequest({ customization_drift: 0.65 }),
      }),
    ).find((r) => r.subject === "supervisor-drift");
    expect(hi?.params?.pct).toBe(65);
    expect(hi?.due_date).toBe("2026-09-04");

    expect(
      deriveReminders(
        deriveInput({
          request: baseRequest({ customization_drift: 0.6 }),
        }),
      ).filter((r) => r.subject === "supervisor-drift"),
    ).toHaveLength(0);
  });

  it("U11: R4 pending capabilities", () => {
    const one = deriveReminders(
      deriveInput({
        result: baseResult({
          capabilities_used: [
            {
              stage: "allocator",
              implementation_id: "mv",
              version: "1",
              status: "approved",
              pending_supervisor_signoff: true,
            },
          ],
        }),
      }),
    ).find((r) => r.subject === "supervisor-capability");
    expect(one?.params?.count).toBe(1);

    expect(
      deriveReminders(
        deriveInput({
          result: baseResult({ capabilities_used: [] }),
        }),
      ).filter((r) => r.subject === "supervisor-capability"),
    ).toHaveLength(0);

    expect(
      deriveReminders(
        deriveInput({
          result: baseResult({
            capabilities_used: [
              {
                stage: "allocator",
                implementation_id: "mv",
                version: "1",
                status: "approved",
              },
            ],
          }),
        }),
      ).filter((r) => r.subject === "supervisor-capability"),
    ).toHaveLength(0);
  });

  it("U12: R6 annual review suggested", () => {
    const ok = deriveReminders(
      deriveInput({
        request: baseRequest({
          client_context: { investment_horizon_years: 5 },
        }),
      }),
    ).find((r) => r.rule_id === "R6");
    expect(ok?.status).toBe("suggested");
    expect(ok?.subject).toBe("annual-review");
    expect(ok?.due_date).toBe("2027-09-04");

    expect(
      deriveReminders(
        deriveInput({
          request: baseRequest({
            client_context: { investment_horizon_years: 0.5 },
          }),
        }),
      ).filter((r) => r.rule_id === "R6"),
    ).toHaveLength(0);

    expect(
      deriveReminders(
        deriveInput({
          request: baseRequest({ client_context: null }),
        }),
      ).filter((r) => r.rule_id === "R6"),
    ).toHaveLength(0);
  });
});

describe("mergeReminders", () => {
  it("U13: same dedupe_key is idempotent", () => {
    const derived = deriveReminders(
      deriveInput({
        request: baseRequest({ rebalance_freq: "ME", end_date: "2026-08-31" }),
      }),
    );
    const first = mergeReminders([], derived, { now: NOW, jobId: "job-a" });
    expect(first.added.length).toBeGreaterThan(0);
    const second = mergeReminders(first.reminders, derived, {
      now: NOW,
      jobId: "job-a",
    });
    expect(second.added).toHaveLength(0);
    expect(second.updated).toHaveLength(0);
    expect(second.reminders).toHaveLength(first.reminders.length);
  });

  it("U14: same subject_key open → in-place update", () => {
    const existing = [
      reminder({
        id: "rem-1",
        rule_id: "R2",
        subject: "rebalance",
        job_id: "job-a",
        status: "open",
        due_date: "2026-09-30",
        params: { freq: "ME", end: "2026-08-31" },
      }),
    ];
    const derived = [
      reminder({
        id: "rem-2",
        rule_id: "R2",
        subject: "rebalance",
        job_id: "job-b",
        status: "open",
        due_date: "2026-10-31",
        params: { freq: "ME", end: "2026-09-30" },
      }),
    ];
    const out = mergeReminders(existing, derived, { now: NOW, jobId: "job-b" });
    expect(out.added).toHaveLength(0);
    expect(out.updated).toHaveLength(1);
    expect(out.reminders[0].id).toBe("rem-1");
    expect(out.reminders[0].last_seen_job_id).toBe("job-b");
    expect(out.reminders[0].due_date).toBe("2026-10-31");
  });

  it("U15: R1 auto-resolve when subject gone and needs present", () => {
    const existing = [
      reminder({
        id: "rem-dd",
        rule_id: "R1",
        subject: "drawdown",
        job_id: "job-a",
        status: "open",
      }),
    ];
    const out = mergeReminders(existing, [], {
      now: NOW,
      jobId: "job-b",
      autoResolveR1: true,
    });
    expect(out.autoResolved).toHaveLength(1);
    expect(out.reminders[0].status).toBe("done");
    expect(out.reminders[0].resolved_by_job_id).toBe("job-b");
  });

  it("U16: needs_attainment null → do not auto-resolve R1", () => {
    const existing = [
      reminder({
        id: "rem-dd",
        rule_id: "R1",
        subject: "drawdown",
        job_id: "job-a",
        status: "open",
      }),
    ];
    const out = mergeReminders(existing, [], {
      now: NOW,
      jobId: "job-b",
      autoResolveR1: false,
    });
    expect(out.autoResolved).toHaveLength(0);
    expect(out.reminders[0].status).toBe("open");
  });

  it("U17: dismissed schedule not rebuilt; dismissed alert is", () => {
    const existing = [
      reminder({
        id: "rem-r2",
        rule_id: "R2",
        subject: "rebalance",
        job_id: "job-a",
        status: "dismissed",
        closed_at: "2026-09-02T00:00:00.000Z",
      }),
      reminder({
        id: "rem-r1",
        rule_id: "R1",
        subject: "drawdown",
        job_id: "job-a",
        status: "dismissed",
        closed_at: "2026-09-02T00:00:00.000Z",
      }),
    ];
    const derived = [
      reminder({
        id: "rem-r2-new",
        rule_id: "R2",
        subject: "rebalance",
        job_id: "job-b",
        status: "open",
        due_date: "2026-10-31",
      }),
      reminder({
        id: "rem-r1-new",
        rule_id: "R1",
        subject: "drawdown",
        job_id: "job-b",
        status: "open",
        params: { detail: "fail" },
      }),
    ];
    const out = mergeReminders(existing, derived, { now: NOW, jobId: "job-b" });
    expect(out.reminders.filter((r) => r.rule_id === "R2" && r.status === "open")).toHaveLength(
      0,
    );
    expect(
      out.reminders.filter((r) => r.rule_id === "R1" && r.status === "open"),
    ).toHaveLength(1);
  });

  it("U18: prune closed >90d and max cap prefers oldest closed", () => {
    const oldClosedAt = new Date(NOW.getTime());
    oldClosedAt.setUTCDate(
      oldClosedAt.getUTCDate() - (CLOSED_REMINDER_RETENTION_DAYS + 5),
    );
    const existing = [
      reminder({
        id: "rem-old",
        rule_id: "R1",
        subject: "drawdown",
        job_id: "job-old",
        status: "done",
        closed_at: oldClosedAt.toISOString(),
      }),
      reminder({
        id: "rem-keep",
        rule_id: "R2",
        subject: "rebalance",
        job_id: "job-a",
        status: "open",
      }),
    ];
    const pruned = mergeReminders(existing, [], { now: NOW, jobId: "job-b" });
    expect(pruned.reminders.find((r) => r.id === "rem-old")).toBeUndefined();
    expect(pruned.reminders.find((r) => r.id === "rem-keep")).toBeTruthy();

    const many: ClientReminder[] = [];
    for (let i = 0; i < MAX_REMINDERS_PER_CLIENT + 5; i++) {
      many.push(
        reminder({
          id: `rem-c-${i}`,
          rule_id: "R1",
          subject: `drawdown-${i}`,
          job_id: `job-${i}`,
          status: "done",
          closed_at: `2026-08-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
          updated_at: `2026-08-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
        }),
      );
    }
    const capped = mergeReminders(many, [], { now: NOW });
    expect(capped.reminders.length).toBeLessThanOrEqual(MAX_REMINDERS_PER_CLIENT);
  });
});

describe("setClientReminderStatus + store", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };
    vi.stubGlobal("window", { localStorage });
    vi.stubGlobal("localStorage", localStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("U19: suggested→open clears closed_at; done/dismissed set it; missing → null", () => {
    const suggested = reminder({
      id: "rem-sug",
      rule_id: "R6",
      subject: "annual-review",
      job_id: "job-a",
      status: "suggested",
    });
    mergeClientReminders(CLIENT, [suggested]);

    const accepted = setClientReminderStatus(CLIENT, "rem-sug", "open");
    expect(accepted?.status).toBe("open");
    expect(accepted?.closed_at).toBeUndefined();
    expect(accepted?.resolved_by_job_id).toBeUndefined();

    const done = setClientReminderStatus(CLIENT, "rem-sug", "done");
    expect(done?.status).toBe("done");
    expect(done?.closed_at).toBeTruthy();

    expect(setClientReminderStatus(CLIENT, "nope", "done")).toBeNull();
  });

  it("I5: missing reminders field → []", () => {
    localStorage.setItem(
      DEMO_CLIENTS_OVERRIDES_STORAGE_KEY,
      JSON.stringify({
        [CLIENT]: { extra_notes: [{ id: "n1", text: "hi" }] },
      }),
    );
    expect(getClientReminders(CLIENT)).toEqual([]);
  });
});

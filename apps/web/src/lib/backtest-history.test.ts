import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  historyEntryDisplayLabel,
  listLocalHistoryForClient,
  resolveHistoryClientId,
  upsertLocalBacktestHistory,
  type LocalHistoryEntry,
} from "./backtest-history";

function entry(
  partial: Partial<LocalHistoryEntry> & Pick<LocalHistoryEntry, "job_id">,
): LocalHistoryEntry {
  return {
    created_at: "2026-07-30T10:00:00.000Z",
    status: "completed",
    start_date: "2020-01-01",
    end_date: "2025-12-31",
    objective: "sharpe",
    optimization_mode: "pro_auto",
    ...partial,
  };
}

describe("client customized history helpers", () => {
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

  it("resolves client id from field, request, or overlay", () => {
    expect(
      resolveHistoryClientId(entry({ job_id: "a", clientId: "c1" })),
    ).toBe("c1");
    expect(
      resolveHistoryClientId(
        entry({
          job_id: "b",
          request: { client_ref: "c2" } as LocalHistoryEntry["request"],
        }),
      ),
    ).toBe("c2");
    expect(
      resolveHistoryClientId(
        entry({
          job_id: "c",
          signedOverlay: {
            audit: { client_ref: "c3" },
          } as LocalHistoryEntry["signedOverlay"],
        }),
      ),
    ).toBe("c3");
    expect(resolveHistoryClientId(entry({ job_id: "d" }))).toBeUndefined();
  });

  it("lists only matching client rows in upsert order", () => {
    upsertLocalBacktestHistory(
      entry({ job_id: "other", clientId: "x" }),
    );
    upsertLocalBacktestHistory(
      entry({
        job_id: "mine-old",
        clientId: "c1",
        personalizationCompare: {
          customizedLabel: "Alice Custom A",
        } as LocalHistoryEntry["personalizationCompare"],
      }),
    );
    upsertLocalBacktestHistory(
      entry({
        job_id: "mine-new",
        clientId: "c1",
        champion_model_code: "M1",
      }),
    );

    const rows = listLocalHistoryForClient("c1");
    expect(rows.map((r) => r.job_id)).toEqual(["mine-new", "mine-old"]);
    expect(historyEntryDisplayLabel(rows[1]!)).toBe("Alice Custom A");
    expect(historyEntryDisplayLabel(rows[0]!)).toBe("M1");
  });
});

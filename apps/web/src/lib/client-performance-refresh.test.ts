import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PERF_ASOF_KEY,
  PERF_REFRESH_DAY_KEY,
  localCalendarDate,
  pickLaterDate,
  shouldAttemptRefresh,
  startOpportunisticRefresh,
} from "./client-performance-refresh";

afterEach(() => {
  vi.unstubAllGlobals();
});

function memoryStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    store,
  };
}

describe("pickLaterDate", () => {
  it("returns the later ISO date and ignores empties", () => {
    expect(pickLaterDate("2026-07-28", "2026-08-14")).toBe("2026-08-14");
    expect(pickLaterDate("2026-08-14", "2026-07-28")).toBe("2026-08-14");
    expect(pickLaterDate(null, "2026-07-28")).toBe("2026-07-28");
    expect(pickLaterDate("nope", null)).toBeNull();
  });
});

describe("shouldAttemptRefresh", () => {
  it("skips when this browser already succeeded today", () => {
    expect(
      shouldAttemptRefresh({
        storedDay: "2026-08-14",
        today: "2026-08-14",
        attempts: 0,
      }),
    ).toBe(false);
  });

  it("allows a new calendar day and caps retries", () => {
    expect(
      shouldAttemptRefresh({
        storedDay: "2026-08-13",
        today: "2026-08-14",
        attempts: 0,
      }),
    ).toBe(true);
    expect(
      shouldAttemptRefresh({
        storedDay: null,
        today: "2026-08-14",
        attempts: 3,
      }),
    ).toBe(false);
  });
});

describe("localCalendarDate", () => {
  it("formats the local calendar day", () => {
    expect(localCalendarDate(new Date(2026, 7, 14))).toBe("2026-08-14");
  });
});

describe("startOpportunisticRefresh", () => {
  it("fires once, persists day + as_of, and does not repeat the same day", async () => {
    const storage = memoryStorage();
    const refresh = vi.fn().mockResolvedValue({
      as_of: "2026-08-14",
      tickers: 4,
      skipped: false,
    });
    const onAsOf = vi.fn();
    const doc = {
      visibilityState: "visible" as Document["visibilityState"],
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    const { stop } = startOpportunisticRefresh(onAsOf, {
      refresh,
      now: () => "2026-08-14",
      storage,
      documentRef: doc,
    });

    await vi.waitFor(() => expect(onAsOf).toHaveBeenCalledWith("2026-08-14"));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(storage.getItem(PERF_REFRESH_DAY_KEY)).toBe("2026-08-14");
    expect(storage.getItem(PERF_ASOF_KEY)).toBe("2026-08-14");

    startOpportunisticRefresh(onAsOf, {
      refresh,
      now: () => "2026-08-14",
      storage,
      documentRef: doc,
    }).stop();
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not run while the tab is hidden", () => {
    const refresh = vi.fn();
    const { stop } = startOpportunisticRefresh(vi.fn(), {
      refresh,
      now: () => "2026-08-14",
      storage: memoryStorage(),
      documentRef: {
        visibilityState: "hidden",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });
    expect(refresh).not.toHaveBeenCalled();
    stop();
  });
});

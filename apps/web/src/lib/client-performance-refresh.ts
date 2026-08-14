/**
 * Opportunistic client-performance refresh: fire when the website is visible,
 * once per local calendar day per browser. Not a cron.
 */

export const PERF_REFRESH_DAY_KEY = "jasper-client-perf-refresh-day";
export const PERF_ASOF_KEY = "jasper-client-perf-as-of";
export const PERF_REFRESH_MAX_ATTEMPTS = 3;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;

export type PerformanceRefreshResult = {
  as_of: string | null;
  tickers: number;
  clients?: number;
  skipped: boolean;
  data_source?: string;
};

export function localCalendarDate(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Later of two ISO dates; invalid/empty values ignored. */
export function pickLaterDate(
  a?: string | null,
  b?: string | null,
): string | null {
  const dates = [a, b]
    .filter((x): x is string => typeof x === "string" && ISO_DATE_RE.test(x))
    .map((x) => x.slice(0, 10));
  if (dates.length === 0) return null;
  dates.sort();
  return dates[dates.length - 1] ?? null;
}

export function shouldAttemptRefresh(opts: {
  storedDay: string | null;
  today: string;
  attempts: number;
  maxAttempts?: number;
}): boolean {
  if (opts.storedDay === opts.today) return false;
  const max = opts.maxAttempts ?? PERF_REFRESH_MAX_ATTEMPTS;
  if (opts.attempts >= max) return false;
  return true;
}

export function readStoredAsOf(
  storage?: Pick<Storage, "getItem"> | null,
): string | null {
  try {
    const s =
      storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    if (!s) return null;
    const v = s.getItem(PERF_ASOF_KEY);
    return v && ISO_DATE_RE.test(v) ? v.slice(0, 10) : null;
  } catch {
    return null;
  }
}

type RefreshFn = () => Promise<PerformanceRefreshResult>;

export function startOpportunisticRefresh(
  onAsOf: (asOf: string) => void,
  opts?: {
    refresh?: RefreshFn;
    now?: () => string;
    storage?: Pick<Storage, "getItem" | "setItem">;
    documentRef?: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> | null;
  },
): { stop: () => void } {
  const storage =
    opts?.storage ??
    (typeof window !== "undefined" ? window.localStorage : undefined);
  const todayFn = opts?.now ?? (() => localCalendarDate());
  const doc =
    opts?.documentRef !== undefined
      ? opts.documentRef
      : typeof document !== "undefined"
        ? document
        : null;
  const refresh: RefreshFn =
    opts?.refresh ??
    (async () => {
      const { refreshClientPerformance } = await import("./api");
      return refreshClientPerformance();
    });

  let attempts = 0;
  let attemptDay = todayFn();
  let inFlight = false;
  let stopped = false;

  const readDay = (): string | null => {
    try {
      return storage?.getItem(PERF_REFRESH_DAY_KEY) ?? null;
    } catch {
      return null;
    }
  };

  const write = (key: string, value: string) => {
    try {
      storage?.setItem(key, value);
    } catch {
      /* private mode / quota */
    }
  };

  const fire = () => {
    if (stopped) return;
    if (doc && doc.visibilityState === "hidden") return;
    const today = todayFn();
    if (today !== attemptDay) {
      attemptDay = today;
      attempts = 0;
    }
    if (
      !shouldAttemptRefresh({
        storedDay: readDay(),
        today,
        attempts,
      })
    ) {
      return;
    }
    if (inFlight) return;
    inFlight = true;
    attempts += 1;
    void refresh()
      .then((res) => {
        if (stopped) return;
        write(PERF_REFRESH_DAY_KEY, todayFn());
        const asOf =
          res.as_of && ISO_DATE_RE.test(res.as_of) ? res.as_of.slice(0, 10) : null;
        if (asOf) {
          write(PERF_ASOF_KEY, asOf);
          onAsOf(asOf);
        }
      })
      .catch(() => {
        /* retry on a later visibility pulse, up to MAX_ATTEMPTS */
      })
      .finally(() => {
        inFlight = false;
      });
  };

  const onVis = () => {
    if (doc && doc.visibilityState === "visible") fire();
  };

  fire();
  doc?.addEventListener("visibilitychange", onVis);
  return {
    stop: () => {
      stopped = true;
      doc?.removeEventListener("visibilitychange", onVis);
    },
  };
}

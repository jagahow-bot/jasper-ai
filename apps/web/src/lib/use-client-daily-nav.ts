"use client";

import { useEffect, useMemo, useState } from "react";
import type { ClientNavPoint, ClientPerfHolding } from "./clients-charts";
import { useEffectiveClientAsOf } from "@/components/ClientPerformanceRefresh";
import {
  buildDailyNavPlan,
  getCachedClientDailyNav,
  type HoldingRealReturn,
} from "./client-daily-nav";

export type ClientDailyNavState = {
  /** Real daily NAV once loaded; null while loading or after failure. */
  points: ClientNavPoint[] | null;
  /** Real per-ticker returns for table reconciliation; null until loaded. */
  perTicker: Map<string, HoldingRealReturn> | null;
  loading: boolean;
  /** True when the API failed or returned no usable points → callers fall back. */
  failed: boolean;
};

const IDLE: ClientDailyNavState = {
  points: null,
  perTicker: null,
  loading: false,
  failed: false,
};

/**
 * Fetch the client book's real daily NAV (POST /backcast/daily-nav).
 * Consumers render the synchronous calibrated series while `points` is null
 * and switch to the real series when it arrives. Requests are memoized by
 * book content via `getCachedClientDailyNav`.
 */
export function useClientDailyNav(
  holdings: ClientPerfHolding[] | null | undefined,
  asOfDate: string | null | undefined,
  opts?: { enabled?: boolean },
): ClientDailyNavState {
  const enabled = opts?.enabled ?? true;
  const effectiveAsOf = useEffectiveClientAsOf(asOfDate);
  const plan = useMemo(
    () => (enabled ? buildDailyNavPlan(holdings ?? [], effectiveAsOf) : null),
    [holdings, effectiveAsOf, enabled],
  );
  const planKey = plan?.key ?? "";
  const [state, setState] = useState<ClientDailyNavState & { key: string }>({
    ...IDLE,
    key: "",
  });

  useEffect(() => {
    if (!plan || !planKey) {
      setState({ ...IDLE, key: "" });
      return;
    }
    let cancelled = false;
    setState({ ...IDLE, loading: true, key: planKey });
    getCachedClientDailyNav(plan)
      .then((data) => {
        if (cancelled) return;
        setState({
          points: data.points,
          perTicker: data.perTicker,
          loading: false,
          failed: data.points.length === 0,
          key: planKey,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ ...IDLE, failed: true, key: planKey });
        }
      });
    return () => {
      cancelled = true;
    };
    // plan identity tracks holdings identity; planKey tracks book content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey]);

  // Between a book change and the effect run, report loading for the new key
  // instead of leaking the previous book's series.
  if (state.key !== planKey) {
    return planKey === ""
      ? IDLE
      : { points: null, perTicker: null, loading: true, failed: false };
  }
  return state;
}

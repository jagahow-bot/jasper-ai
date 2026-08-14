"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  pickLaterDate,
  readStoredAsOf,
  startOpportunisticRefresh,
} from "@/lib/client-performance-refresh";

type Ctx = { asOf: string | null };

const ClientPerformanceAsOfContext = createContext<Ctx>({ asOf: null });

/**
 * Later of the book's JSON as_of and the last successful website-open refresh.
 * Safe without the provider (returns the fallback).
 */
export function useEffectiveClientAsOf(
  fallback?: string | null,
): string | null {
  const { asOf } = useContext(ClientPerformanceAsOfContext);
  return pickLaterDate(fallback, asOf) ?? fallback ?? null;
}

/**
 * Background refresh of all demo-client prices when the tab is visible.
 * Does not block render; daily-NAV consumers pick up the new as_of when it arrives.
 */
export function ClientPerformanceRefreshProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [asOf, setAsOf] = useState<string | null>(null);

  useEffect(() => {
    setAsOf(readStoredAsOf());
    if (typeof window === "undefined") return;
    const ctl = startOpportunisticRefresh(
      (next) => {
        setAsOf((prev) => pickLaterDate(prev, next) ?? next);
      },
      { storage: window.localStorage },
    );
    return () => ctl.stop();
  }, []);

  const value = useMemo<Ctx>(() => ({ asOf }), [asOf]);
  return (
    <ClientPerformanceAsOfContext.Provider value={value}>
      {children}
    </ClientPerformanceAsOfContext.Provider>
  );
}

import type { ClientUpcomingEvent, LocalizedText } from "@/lib/clients";

export const DEMO_CLIENTS_OVERRIDES_STORAGE_KEY =
  "jasper_demo_clients_overrides_v1";

export type ClientExtraNote = {
  id: string;
  /** Plain text entered by the RM (shown for all langs). */
  text: string;
};

export type ClientProfileOverrides = {
  extra_notes?: ClientExtraNote[];
  extra_events?: ClientUpcomingEvent[];
};

type OverridesMap = Record<string, ClientProfileOverrides>;

function toLocalized(text: string): LocalizedText {
  const trimmed = text.trim();
  return { en: trimmed, zh: trimmed, ko: trimmed };
}

function readAll(): OverridesMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(DEMO_CLIENTS_OVERRIDES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as OverridesMap;
  } catch {
    return {};
  }
}

function writeAll(map: OverridesMap): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      DEMO_CLIENTS_OVERRIDES_STORAGE_KEY,
      JSON.stringify(map),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

export function getClientProfileOverrides(
  clientId: string,
): ClientProfileOverrides {
  return readAll()[clientId] ?? {};
}

export function getExtraNotes(clientId: string): ClientExtraNote[] {
  return getClientProfileOverrides(clientId).extra_notes ?? [];
}

export function getExtraEvents(clientId: string): ClientUpcomingEvent[] {
  return getClientProfileOverrides(clientId).extra_events ?? [];
}

export function addClientNote(
  clientId: string,
  text: string,
): ClientExtraNote | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const note: ClientExtraNote = {
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: trimmed,
  };
  const all = readAll();
  const current = all[clientId] ?? {};
  all[clientId] = {
    ...current,
    extra_notes: [...(current.extra_notes ?? []), note],
  };
  writeAll(all);
  return note;
}

export function addClientEvent(
  clientId: string,
  date: string,
  title: string,
): ClientUpcomingEvent | null {
  const trimmedDate = date.trim();
  const trimmedTitle = title.trim();
  if (!trimmedDate || !trimmedTitle) return null;
  const event: ClientUpcomingEvent = {
    id: `event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: trimmedDate,
    title: toLocalized(trimmedTitle),
  };
  const all = readAll();
  const current = all[clientId] ?? {};
  all[clientId] = {
    ...current,
    extra_events: [...(current.extra_events ?? []), event],
  };
  writeAll(all);
  return event;
}

import demoClientsFile from "@/data/demo-clients.json";
import { etfDisplayName } from "@/lib/etf-display-name";
import {
  esgPreferenceLabel,
  riskProfileLabel,
  translate,
  type Lang,
  type TFn,
} from "@/lib/i18n";

export type LocalizedText = {
  en: string;
  zh: string;
  ko: string;
};

export type ClientHolding = {
  ticker: string;
  name: string;
  asset_class: string;
  weight: number;
  region?: string;
  notes?: string;
};

export type ClientUpcomingEvent = {
  id: string;
  /** ISO date (YYYY-MM-DD) or year-month (YYYY-MM). */
  date: string;
  title: LocalizedText;
};

export type DemoClient = {
  client_id: string;
  display_name: LocalizedText;
  segment: string;
  risk_profile: "conservative" | "moderate" | "aggressive";
  currency: string;
  age: number;
  aum_usd: number;
  cash_usd: number;
  investment_horizon: LocalizedText | string;
  liquidity_notes: LocalizedText;
  preferences: {
    esg?: string;
    tags?: string[];
  };
  rm_owner: string;
  as_of_date: string;
  suggested_model_portfolio_id: string | null;
  holdings: ClientHolding[];
  notes: LocalizedText;
  upcoming_events?: ClientUpcomingEvent[];
};

type DemoClientsFile = {
  version: string;
  updated: string;
  description?: string;
  clients: DemoClient[];
};

const file = demoClientsFile as DemoClientsFile;

export function getDemoClients(): DemoClient[] {
  return file.clients;
}

export function getDemoClientById(id: string): DemoClient | undefined {
  return file.clients.find((c) => c.client_id === id);
}

export function localizedText(
  text: LocalizedText | string | undefined | null,
  lang: Lang,
): string {
  if (text == null) return "";
  if (typeof text === "string") return text;
  return text[lang] ?? text.en;
}

/** Display month for an event date: "2027-06-15" → "2027-06". */
export function formatEventMonth(date: string): string {
  const trimmed = date.trim();
  return trimmed.length >= 7 ? trimmed.slice(0, 7) : trimmed;
}

/** Chronological upcoming events (stable for empty / missing). */
export function getUpcomingEvents(
  client: Pick<DemoClient, "upcoming_events">,
): ClientUpcomingEvent[] {
  const events = client.upcoming_events;
  if (!events?.length) return [];
  return [...events].sort((a, b) => a.date.localeCompare(b.date));
}

/** Localized "YYYY-MM · title" line for a client event. */
export function formatUpcomingEvent(
  event: ClientUpcomingEvent,
  lang: Lang,
): string {
  return `${formatEventMonth(event.date)} · ${localizedText(event.title, lang)}`;
}

export function formatUsd(amount: number, lang: Lang): string {
  const locale = lang === "zh" ? "zh-TW" : lang === "ko" ? "ko-KR" : "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Localized display name for a holding (ETFs via name map; cash is translated). */
export function holdingDisplayName(
  holding: Pick<ClientHolding, "ticker" | "name">,
  t: TFn,
  lang: Lang = "en",
): string {
  if (holding.ticker.toUpperCase() === "CASH") {
    const lower = holding.name.toLowerCase();
    if (lower.includes("money market") || lower.includes("貨幣") || lower.includes("단기")) {
      return t("clients.holding.cashMoneyMarket");
    }
    return t("clients.holding.cash");
  }
  return etfDisplayName(holding.ticker, lang);
}

/** Prefill prompt for Overlay conversation from client profile. */
export function buildClientOverlayPrefill(client: DemoClient, lang: Lang): string {
  const t: TFn = (key, params) => translate(lang, key, params);
  const name = localizedText(client.display_name, lang);
  const liquidity = localizedText(client.liquidity_notes, lang);
  const notes = localizedText(client.notes, lang);
  const horizon = localizedText(client.investment_horizon, lang);
  const risk = riskProfileLabel(t, client.risk_profile);
  const esg = esgPreferenceLabel(t, client.preferences.esg ?? "none");
  const holdingsSummary = client.holdings
    .filter((h) => h.ticker !== "CASH" || h.weight >= 0.5)
    .map((h) => `${h.ticker} ${(h.weight * 100).toFixed(0)}%`)
    .join(", ");

  if (lang === "zh") {
    return `${name}，${client.age} 歲，風險屬性 ${risk}，投資年期 ${horizon}，AUM 約 ${formatUsd(client.aum_usd, lang)}（現金約 ${formatUsd(client.cash_usd, lang)}）。流動性：${liquidity} ESG：${esg}。現況持倉：${holdingsSummary}。${notes}`;
  }
  if (lang === "ko") {
    return `${name}, ${client.age}세, 위험성향 ${risk}, 투자기간 ${horizon}, AUM 약 ${formatUsd(client.aum_usd, lang)} (현금 약 ${formatUsd(client.cash_usd, lang)}). 유동성: ${liquidity} ESG: ${esg}. 현재 보유: ${holdingsSummary}. ${notes}`;
  }
  return `${name}, age ${client.age}, risk ${risk}, horizon ${horizon}, AUM ~${formatUsd(client.aum_usd, lang)} (cash ~${formatUsd(client.cash_usd, lang)}). Liquidity: ${liquidity} ESG: ${esg}. Holdings: ${holdingsSummary}. ${notes}`;
}

/** Map client risk_profile to model risk_level strings used in catalogs. */
export function matchModelRiskLevels(riskProfile: string): string[] {
  switch (riskProfile) {
    case "conservative":
      return ["conservative", "moderate_conservative"];
    case "aggressive":
      return ["aggressive", "moderate_aggressive"];
    default:
      return ["moderate", "moderate_aggressive", "moderate_conservative"];
  }
}

/** pixel-badge class for client risk tags (slate / amber / rose). */
export function tagClassForRisk(risk: string): string {
  switch (risk) {
    case "conservative":
      return "pixel-badge pixel-badge-slate";
    case "aggressive":
      return "pixel-badge pixel-badge-rose";
    case "moderate":
    default:
      return "pixel-badge pixel-badge-warn";
  }
}

/** pixel-badge class for wealth segment tags (indigo family; UHNW stronger). */
export function tagClassForSegment(seg: string): string {
  const key = seg.trim().toUpperCase();
  if (key === "UHNW") return "pixel-badge pixel-badge-violet";
  return "pixel-badge pixel-badge-indigo";
}

/** pixel-badge class for age tags (muted emerald). */
export function tagClassForAge(): string {
  return "pixel-badge pixel-badge-emerald";
}

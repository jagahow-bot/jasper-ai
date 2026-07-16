import demoClientsFile from "@/data/demo-clients.json";
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

export function formatUsd(amount: number, lang: Lang): string {
  const locale = lang === "zh" ? "zh-TW" : lang === "ko" ? "ko-KR" : "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Localized display name for a holding (ETF names stay English; cash is translated). */
export function holdingDisplayName(
  holding: Pick<ClientHolding, "ticker" | "name">,
  t: TFn,
): string {
  if (holding.ticker.toUpperCase() === "CASH") {
    const lower = holding.name.toLowerCase();
    if (lower.includes("money market") || lower.includes("貨幣") || lower.includes("단기")) {
      return t("clients.holding.cashMoneyMarket");
    }
    return t("clients.holding.cash");
  }
  return holding.name;
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

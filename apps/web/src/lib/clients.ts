import demoClientsFile from "@/data/demo-clients.json";
import { displayNameIsCjk, etfDisplayName } from "@/lib/etf-display-name";
import {
  esgPreferenceLabel,
  riskProfileLabel,
  translate,
  type Lang,
  type TFn,
} from "@/lib/i18n";
import { getPortfolioLabel, SKIP_BASELINE_ANCHOR_ID } from "@/lib/model-portfolios";
import { getManagedPortfolioById } from "@/lib/model-portfolios-store";
import type { BacktestRequest } from "@/lib/types";
import { getUniverseItems } from "@/lib/universe";

export type LocalizedText = {
  en: string;
  zh: string;
  ko: string;
};

export type ClientHolding = {
  ticker: string;
  name: string;
  /**
   * Economic sleeve (equity / bond / cash / …). Used for allocation math.
   * For UI labels prefer {@link resolveHoldingProductType} (ETF / stock / fund).
   */
  asset_class: string;
  /** Optional override; otherwise resolved from the investment universe. */
  product_type?: string;
  /** Current portfolio weight after return drift (normalized across the book). */
  weight: number;
  /**
   * Model / sleeve target weight at investment (demo source).
   * When set, `weight` is derived from initial_weight × (1 + total_return).
   */
  initial_weight?: number;
  /** Year-to-date return in percent points (e.g. 12.3 → +12.3%). Null = N/A (e.g. cash). */
  return_ytd?: number | null;
  /**
   * Cumulative holding-period return since invested_at, in percent points
   * (e.g. 28.1 → +28.1%). Used with invested_at + as_of to compute CAGR.
   * Null = N/A (e.g. cash).
   */
  total_return?: number | null;
  /** Purchase / invested date (ISO YYYY-MM-DD). */
  invested_at?: string | null;
  region?: string;
  notes?: string;
};

/** Sleeve of a client book: a model portfolio, standalone tickers, or cash. */
export type ClientHoldingsGroup = {
  id: string;
  type: "model" | "individual" | "cash";
  /** When type is "model", links to a catalog model portfolio id. */
  model_id?: string;
  /** Optional display override; model groups usually resolve via getPortfolioLabel. */
  label?: LocalizedText;
  /** Portfolio-level weights (sum across all groups ≈ 1). */
  holdings: ClientHolding[];
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
  /** Optional biological sex for longevity-based retirement spend years. */
  gender?: "male" | "female" | null;
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
  /** Flat holdings (derived from holdings_groups when present). */
  holdings: ClientHolding[];
  /** Optional grouped sleeves; when set, preferred source for dashboard display. */
  holdings_groups?: ClientHoldingsGroup[];
  notes: LocalizedText;
  upcoming_events?: ClientUpcomingEvent[];
};

type DemoClientsFile = {
  version: string;
  updated: string;
  description?: string;
  clients: RawDemoClient[];
};

/** Holdings as stored in demo-clients.json (model weights + returns; weight computed at load). */
type RawClientHolding = Omit<ClientHolding, "weight"> & {
  weight?: number;
  initial_weight: number;
};

type RawClientHoldingsGroup = Omit<ClientHoldingsGroup, "holdings"> & {
  holdings: RawClientHolding[];
};

type RawDemoClient = Omit<DemoClient, "holdings" | "holdings_groups"> & {
  holdings: RawClientHolding[];
  holdings_groups?: RawClientHoldingsGroup[];
};

function flattenHoldingsGroups(groups: RawClientHoldingsGroup[]): RawClientHolding[] {
  return groups.flatMap((g) => g.holdings);
}

/** Growth multiplier from cumulative holding-period return (cash → 1). */
export function holdingGrowthFactor(
  holding: Pick<ClientHolding, "total_return" | "ticker" | "asset_class">,
): number {
  if (isCashHolding(holding)) return 1;
  if (
    typeof holding.total_return === "number" &&
    !Number.isNaN(holding.total_return)
  ) {
    return 1 + holding.total_return / 100;
  }
  return 1;
}

/**
 * Drift current weights from model initial_weight × (1 + total_return).
 * Weights renormalize to sum to 1 across the full book.
 */
export function applyDriftedHoldingsWeights(
  holdings: RawClientHolding[],
): ClientHolding[] {
  if (!holdings.length) return [];
  const hasInitial = holdings.some((h) => typeof h.initial_weight === "number");
  if (!hasInitial) {
    return holdings.map((h) => ({
      ...h,
      weight: h.weight ?? 0,
    }));
  }

  const valueFactors = holdings.map((h) => {
    const initial = h.initial_weight ?? h.weight ?? 0;
    return initial * holdingGrowthFactor(h);
  });
  const total = valueFactors.reduce((sum, value) => sum + value, 0) || 1;
  return holdings.map((h, i) => ({
    ...h,
    weight: valueFactors[i] / total,
  }));
}

function remapDriftedHoldingsToGroups(
  groups: ClientHoldingsGroup[],
  drifted: ClientHolding[],
): ClientHoldingsGroup[] {
  let idx = 0;
  return groups.map((group) => ({
    ...group,
    holdings: group.holdings.map(() => {
      const holding = drifted[idx];
      idx += 1;
      return holding;
    }),
  }));
}

function syncCashUsd(
  client: Pick<DemoClient, "aum_usd" | "cash_usd">,
  holdings: ClientHolding[],
): number {
  const cashHolding = holdings.find(isCashHolding);
  if (!cashHolding) return client.cash_usd;
  return Math.round(client.aum_usd * cashHolding.weight);
}

function normalizeDemoClient(raw: RawDemoClient): DemoClient {
  if (raw.holdings_groups?.length) {
    const flat = flattenHoldingsGroups(raw.holdings_groups);
    const drifted = applyDriftedHoldingsWeights(flat);
    const holdings_groups = remapDriftedHoldingsToGroups(
      raw.holdings_groups as ClientHoldingsGroup[],
      drifted,
    );
    return {
      ...raw,
      cash_usd: syncCashUsd(raw, drifted),
      holdings_groups,
      holdings: drifted,
    } as DemoClient;
  }
  const holdings = applyDriftedHoldingsWeights(raw.holdings);
  return {
    ...raw,
    cash_usd: syncCashUsd(raw, holdings),
    holdings,
  } as DemoClient;
}

const file = demoClientsFile as DemoClientsFile;

export function getDemoClients(): DemoClient[] {
  return file.clients.map(normalizeDemoClient);
}

export function getDemoClientById(id: string): DemoClient | undefined {
  const raw = file.clients.find((c) => c.client_id === id);
  return raw ? normalizeDemoClient(raw) : undefined;
}

/** Groups for UI; falls back to a single individual sleeve from flat holdings. */
export function getClientHoldingsGroups(
  client: Pick<DemoClient, "holdings" | "holdings_groups">,
): ClientHoldingsGroup[] {
  if (client.holdings_groups?.length) return client.holdings_groups;
  return [
    {
      id: "all",
      type: "individual",
      holdings: client.holdings,
    },
  ];
}

export function holdingsGroupWeight(group: ClientHoldingsGroup): number {
  return group.holdings.reduce((sum, h) => sum + h.weight, 0);
}

/** Localized label for a holdings sleeve (model, individual, or cash). */
export function holdingsGroupLabel(
  group: ClientHoldingsGroup,
  lang: Lang,
  t: TFn,
): string {
  if (group.type === "individual") {
    if (group.label) return localizedText(group.label, lang);
    return t("clients.holdings.individual");
  }
  if (group.type === "cash") {
    if (group.label) return localizedText(group.label, lang);
    return t("clients.holdings.cash");
  }
  if (group.model_id) {
    const model = getManagedPortfolioById(group.model_id);
    if (model) return getPortfolioLabel(model, lang);
  }
  if (group.label) return localizedText(group.label, lang);
  return group.model_id ?? group.id;
}

/** True for cash / 現金 holdings (ticker CASH or cash asset class). */
export function isCashHolding(
  holding: Pick<ClientHolding, "ticker" | "asset_class">,
): boolean {
  const t = holding.ticker.toUpperCase();
  const c = holding.asset_class.toLowerCase();
  return (
    t === "CASH" ||
    c === "cash" ||
    c.includes("現金") ||
    c.includes("cash")
  );
}

/**
 * Instrument / product type for display (etf | stock | fund | cash | …).
 * Prefers holding.product_type, then universe lookup; cash sleeves → "cash".
 */
export function resolveHoldingProductType(
  holding: Pick<ClientHolding, "ticker" | "asset_class" | "product_type">,
): string {
  if (holding.product_type?.trim()) {
    return holding.product_type.trim().toLowerCase();
  }
  if (isCashHolding(holding)) return "cash";
  const ticker = holding.ticker.toUpperCase();
  const hit = getUniverseItems().find((u) => u.ticker.toUpperCase() === ticker);
  if (hit?.product_type?.trim()) {
    return hit.product_type.trim().toLowerCase();
  }
  return "other";
}

const MS_PER_DAY = 86_400_000;
const DAYS_PER_YEAR = 365.25;

/**
 * Standard CAGR from cumulative holding-period return R (decimal) and years t:
 * CAGR = (1 + R)^(1/t) − 1. Returns percent points (e.g. 11.2 → +11.2%).
 * t ≤ 0, missing inputs, or non-finite results → undefined (UI shows "—").
 */
export function computeCagr(
  investedAt: string | null | undefined,
  asOfDate: string | null | undefined,
  cumulativeReturn: number | null | undefined,
): number | undefined {
  if (
    !investedAt ||
    !asOfDate ||
    typeof cumulativeReturn !== "number" ||
    Number.isNaN(cumulativeReturn)
  ) {
    return undefined;
  }
  const start = new Date(`${investedAt}T12:00:00Z`);
  const end = new Date(`${asOfDate}T12:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return undefined;
  }
  const t = (end.getTime() - start.getTime()) / MS_PER_DAY / DAYS_PER_YEAR;
  if (!(t > 0)) return undefined;
  const R = cumulativeReturn; // already decimal
  const base = 1 + R;
  if (base <= 0) {
    // Negative wealth not annualizable via this power formula.
    return undefined;
  }
  const cagr = base ** (1 / t) - 1;
  if (!Number.isFinite(cagr)) return undefined;
  return cagr * 100;
}

/**
 * Resolve cumulative holding-period return as a decimal for CAGR.
 * Prefers total_return (percent points → decimal). If missing and the
 * invest date is in the same calendar year as as_of, falls back to return_ytd.
 */
export function holdingCumulativeReturnDecimal(
  holding: Pick<ClientHolding, "total_return" | "return_ytd" | "invested_at">,
  asOfDate: string | null | undefined,
): number | undefined {
  if (typeof holding.total_return === "number") {
    return holding.total_return / 100;
  }
  if (
    typeof holding.return_ytd === "number" &&
    holding.invested_at &&
    asOfDate &&
    holding.invested_at.slice(0, 4) === asOfDate.slice(0, 4)
  ) {
    return holding.return_ytd / 100;
  }
  return undefined;
}

/** Per-holding CAGR in percent points from invested_at, as_of, and R. */
export function holdingCagr(
  holding: Pick<
    ClientHolding,
    "total_return" | "return_ytd" | "invested_at" | "ticker" | "asset_class"
  >,
  asOfDate: string | null | undefined,
): number | undefined {
  if (isCashHolding(holding)) return undefined;
  const R = holdingCumulativeReturnDecimal(holding, asOfDate);
  return computeCagr(holding.invested_at, asOfDate, R);
}

/**
 * Weight-weighted average of constituent return_ytd (percent points).
 * Cash is included at 0% (weight in denominator, 0 in numerator) so cash
 * dilutes mixed group/total; the cash row UI still shows "—".
 * Cash-only groups (no invested holdings with values) return undefined → "—".
 * Holdings with missing values (non-cash) are skipped.
 */
export function holdingsGroupReturnYtd(
  group: ClientHoldingsGroup,
): number | undefined {
  let wSum = 0;
  let retSum = 0;
  let investedWeight = 0;
  for (const h of group.holdings) {
    if (isCashHolding(h)) {
      wSum += h.weight;
      continue;
    }
    if (typeof h.return_ytd !== "number") continue;
    wSum += h.weight;
    investedWeight += h.weight;
    retSum += h.weight * h.return_ytd;
  }
  if (investedWeight <= 0 || wSum <= 0) return undefined;
  return retSum / wSum;
}

/**
 * Weight-weighted average of cumulative holding-period returns (percent
 * points). Cash is included at 0% (weight in denominator) so cash dilutes.
 */
export function holdingsGroupCumulativeReturn(
  group: ClientHoldingsGroup,
  asOfDate: string | null | undefined,
): number | undefined {
  let wSum = 0;
  let retSum = 0;
  let investedWeight = 0;
  for (const h of group.holdings) {
    if (isCashHolding(h)) {
      wSum += h.weight;
      continue;
    }
    const value = holdingCumulativeReturnDecimal(h, asOfDate);
    if (typeof value !== "number") continue;
    wSum += h.weight;
    investedWeight += h.weight;
    retSum += h.weight * value * 100;
  }
  if (investedWeight <= 0 || wSum <= 0) return undefined;
  return retSum / wSum;
}

/**
 * Weight-weighted average of computed constituent CAGRs (percent points).
 * Same cash-dilution rules as holdingsGroupReturnYtd.
 */
export function holdingsGroupCagr(  group: ClientHoldingsGroup,
  asOfDate: string | null | undefined,
): number | undefined {
  let wSum = 0;
  let retSum = 0;
  let investedWeight = 0;
  for (const h of group.holdings) {
    if (isCashHolding(h)) {
      wSum += h.weight;
      continue;
    }
    const value = holdingCagr(h, asOfDate);
    if (typeof value !== "number") continue;
    wSum += h.weight;
    investedWeight += h.weight;
    retSum += h.weight * value;
  }
  if (investedWeight <= 0 || wSum <= 0) return undefined;
  return retSum / wSum;
}

/** Earliest invested_at (ISO date) among holdings that have one. */
export function holdingsGroupInvestedAt(
  group: ClientHoldingsGroup,
): string | undefined {
  let earliest: string | undefined;
  for (const h of group.holdings) {
    if (!h.invested_at) continue;
    if (!earliest || h.invested_at < earliest) earliest = h.invested_at;
  }
  return earliest;
}

/** Holdings from the selected group ids (empty selection → empty list). */
export function holdingsFromSelectedGroups(
  groups: ClientHoldingsGroup[],
  selectedIds: ReadonlySet<string> | readonly string[],
): ClientHolding[] {
  const selected =
    selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  return groups
    .filter((g) => selected.has(g.id))
    .flatMap((g) => g.holdings);
}

/**
 * Empty selection means “all groups” (launch / confirm summary fallback).
 * Returns an explicit id list for checkbox UIs and toggle helpers.
 */
export function effectiveScopeGroupIds(
  groups: readonly { id: string }[],
  selectedIds: readonly string[],
): string[] {
  if (selectedIds.length > 0) return [...selectedIds];
  return groups.map((g) => g.id);
}

/** Toggle a holdings group in scope; keeps at least one group selected. */
export function toggleScopeGroupId(
  selectedIds: readonly string[],
  groupId: string,
  allGroupIds: readonly string[],
): string[] {
  const current =
    selectedIds.length > 0 ? [...selectedIds] : [...allGroupIds];
  const selected = current.includes(groupId);
  if (selected && current.length <= 1) return current;
  return selected
    ? current.filter((id) => id !== groupId)
    : [...current, groupId];
}

/**
 * Scale so selected groups' portfolio weights sum to 1.
 * Returns 1 when nothing is selected or the selected weight sum is 0.
 */
export function selectedGroupsWeightScale(
  groups: ClientHoldingsGroup[],
  selectedIds: ReadonlySet<string> | readonly string[],
): number {
  const selected =
    selectedIds instanceof Set ? selectedIds : new Set(selectedIds);
  const sum = groups
    .filter((g) => selected.has(g.id))
    .reduce((acc, g) => acc + holdingsGroupWeight(g), 0);
  return sum > 0 ? 1 / sum : 1;
}

/** Merge selected groups' holdings with portfolio-level weights renormalized to 100%. */
export function buildScopeHoldings(
  groups: ClientHoldingsGroup[],
  selectedIds: readonly string[],
): ClientHolding[] {
  if (!selectedIds.length) return [];
  const selected = new Set(selectedIds);
  const scale = selectedGroupsWeightScale(groups, selectedIds);
  const byTicker = new Map<string, ClientHolding>();
  for (const group of groups) {
    if (!selected.has(group.id)) continue;
    for (const h of group.holdings) {
      const ticker = h.ticker.toUpperCase();
      const w = h.weight * scale;
      const existing = byTicker.get(ticker);
      if (existing) {
        existing.weight += w;
      } else {
        byTicker.set(ticker, { ...h, weight: w });
      }
    }
  }
  return Array.from(byTicker.values());
}

/**
 * Default anchor from selected scope:
 * - one selected model sleeve → that model id
 * - cash-only (no investable names) → skip-baseline (do not silently force SPY
 *   as the UI "基準組合" when buildCurrentHoldingsAnchor would return null)
 * - otherwise → caller fallback (usually current-holdings)
 */
export function resolveAnchorIdFromScope(
  groups: ClientHoldingsGroup[],
  selectedIds: readonly string[],
  fallbackAnchorId: string,
): string {
  const effectiveIds =
    selectedIds.length > 0 ? selectedIds : groups.map((g) => g.id);
  const selected = new Set(effectiveIds);
  const modelGroups = groups.filter(
    (g) => g.type === "model" && g.model_id && selected.has(g.id),
  );
  if (modelGroups.length >= 1) {
    return modelGroups[0].model_id!;
  }
  const scope = buildScopeHoldings(groups, effectiveIds);
  const hasInvestable = scope.some((h) => !isCashHolding(h) && h.weight > 0);
  const hasCash = scopeCashWeight(scope) > 0;
  // Pure cash: CURRENT_HOLDINGS cannot be built (cash filtered out) — prefer
  // skip-baseline over SPY-labeled fallback in the step-1 dropdown.
  if (!hasInvestable && hasCash) {
    return SKIP_BASELINE_ANCHOR_ID;
  }
  return fallbackAnchorId;
}

export function countSelectedModelGroups(
  groups: ClientHoldingsGroup[],
  selectedIds: readonly string[],
): number {
  const selected = new Set(selectedIds);
  return groups.filter(
    (g) => g.type === "model" && g.model_id && selected.has(g.id),
  ).length;
}

export function defaultCustomizationPortfolioName(
  client: Pick<DemoClient, "display_name">,
  lang: Lang,
): string {
  const name = localizedText(client.display_name, lang);
  if (lang === "zh") return `${name} 客製化投組`;
  if (lang === "ko") return `${name} 맞춤 포트폴리오`;
  return `${name} customized portfolio`;
}

export function holdingsToStaticReplay(
  holdings: ClientHolding[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const h of holdings) {
    out[h.ticker.toUpperCase()] = h.weight;
  }
  return out;
}

/** Matches API BacktestRequest.cash_reserve_pct upper bound (pydantic le=0.40). */
export const MAX_CASH_RESERVE_PCT = 0.4;

/**
 * True when the run is customizing a cash sleeve (scope reserve, overlay ask,
 * or deployment liquidity buffer). Gates the "skip anchor compare" UX.
 */
export function requestHasCashCustomization(
  request: Pick<BacktestRequest, "cash_reserve_pct">,
  overlay?: {
    asks?: ReadonlyArray<{ kind?: string }>;
    deployment_schedule?: { liquidity_buffer_pct?: number | null } | null;
  } | null,
): boolean {
  if ((request.cash_reserve_pct ?? 0) > 1e-9) return true;
  if (overlay?.asks?.some((a) => a.kind === "cash_reserve")) return true;
  if ((overlay?.deployment_schedule?.liquidity_buffer_pct ?? 0) > 1e-9) {
    return true;
  }
  return false;
}

/**
 * Cash share of the selected scope (weights already normalized to 1).
 * Becomes the request's permanent cash sleeve; cash is a pseudo-ticker the
 * price engine cannot fetch, so it must never enter the tradable universe.
 */
export function scopeCashWeight(scopeHoldings: ClientHolding[]): number {
  return scopeHoldings
    .filter(isCashHolding)
    .reduce((sum, h) => sum + Math.max(0, h.weight), 0);
}

function withScopeCashReserve(
  req: BacktestRequest,
  cashWeight: number,
): BacktestRequest {
  if (cashWeight <= 0) return req;
  const reserve = Math.min(
    MAX_CASH_RESERVE_PCT,
    Math.max(req.cash_reserve_pct ?? 0, cashWeight),
  );
  return { ...req, cash_reserve_pct: reserve };
}

/**
 * Apply scope holdings to the backtest universe.
 *
 * When the request already has a locked whitelist (model/anchor holdings),
 * scope tickers are unioned into that whitelist — never used to open the
 * full asset-class fund pool via supplement-union semantics.
 *
 * Cash scope holdings become `cash_reserve_pct` (uninvested sleeve earning
 * `cash_return_mode`) instead of a universe ticker.
 */
export function applyScopeToBacktestRequest(
  req: BacktestRequest,
  scopeHoldings: ClientHolding[],
): BacktestRequest {
  if (!scopeHoldings.length) return req;
  const cashWeight = scopeCashWeight(scopeHoldings);
  const scopeTickers = scopeHoldings
    .filter((h) => !isCashHolding(h))
    .map((h) => h.ticker.toUpperCase());
  if (!scopeTickers.length) return withScopeCashReserve(req, cashWeight);
  const existingWhitelist = (req.universe_tickers ?? []).map((t) =>
    t.toUpperCase(),
  );
  const fromStatic = Object.keys(req.static_replay_holdings ?? {}).map((t) =>
    t.toUpperCase(),
  );
  const lockedBase =
    existingWhitelist.length > 0
      ? existingWhitelist
      : fromStatic.length > 0
        ? fromStatic
        : [];

  if (lockedBase.length > 0) {
    const uniq = [...new Set([...lockedBase, ...scopeTickers])];
    return withScopeCashReserve(
      {
        ...req,
        universe_tickers: uniq,
        universe_supplement_tickers: uniq,
        max_holdings: Math.max(req.max_holdings ?? uniq.length, uniq.length),
      },
      cashWeight,
    );
  }

  const uniq = [...new Set(scopeTickers)];
  return withScopeCashReserve(
    {
      ...req,
      universe_tickers: uniq,
      universe_supplement_tickers: [
        ...new Set([...(req.universe_supplement_tickers ?? []), ...uniq]),
      ],
      max_holdings: Math.max(req.max_holdings ?? 30, uniq.length),
    },
    cashWeight,
  );
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

  const upper = holding.ticker.trim().toUpperCase();
  const own = holding.name?.trim() ?? "";
  const localized = etfDisplayName(holding.ticker, lang);

  // Name map / English universe hit — use it unless it is bare ticker and we have a better own name.
  if (localized && localized !== upper) {
    // Guard: never show CJK labels in non-zh UI even if a stale map entry slips through.
    if (lang !== "zh" && displayNameIsCjk(localized) && own && !displayNameIsCjk(own)) {
      return own;
    }
    return localized;
  }

  // Map/universe miss (or CJK skipped for en/ko): prefer the holding's own English-style name.
  if (own) {
    if (lang === "zh" || !displayNameIsCjk(own)) return own;
  }

  return localized || upper;
}

export type {
  ClientNavPoint,
  ClientPerfHolding,
  ClientPerfTimeframe,
  ClientPieSlice,
  ClientReturnPoint,
} from "@/lib/clients-charts";

export {
  CLIENT_PERF_HISTORY_MONTHS,
  CLIENT_PERF_TIMEFRAMES,
  buildClientHoldingsGroupPie,
  buildClientHoldingsPie,
  buildClientPerformanceSeries,
  buildHoldingsCalibratedNavSeries,
  clientPerfWindowStart,
  holdingsCurrentWeightYtdDecimal,
  holdingsHavePerformanceMetrics,
  holdingGrowthKnots,
  holdingGrowthOnDate,
  toClientPerformanceReturnSeries,
} from "@/lib/clients-charts";

/** Prefill prompt for Overlay conversation from client profile. */
export function buildClientOverlayPrefill(client: DemoClient, lang: Lang): string {
  return buildClientOverlayPrefillFromHoldings(client, client.holdings, lang);
}

/** Prefill using a scoped holdings subset (selected groups). */
export function buildClientOverlayPrefillFromHoldings(
  client: DemoClient,
  scopeHoldings: ClientHolding[],
  lang: Lang,
): string {
  const t: TFn = (key, params) => translate(lang, key, params);
  const name = localizedText(client.display_name, lang);
  const liquidity = localizedText(client.liquidity_notes, lang);
  const notes = localizedText(client.notes, lang);
  const horizon = localizedText(client.investment_horizon, lang);
  const risk = riskProfileLabel(t, client.risk_profile);
  const esg = esgPreferenceLabel(t, client.preferences.esg ?? "none");
  const holdingsSummary = scopeHoldings
    .filter((h) => h.ticker !== "CASH" || h.weight >= 0.5)
    .map((h) => `${h.ticker} ${(h.weight * 100).toFixed(0)}%`)
    .join(", ");

  if (lang === "zh") {
    return `${name}，${client.age} 歲，風險屬性 ${risk}，投資年期 ${horizon}，AUM 約 ${formatUsd(client.aum_usd, lang)}（現金約 ${formatUsd(client.cash_usd, lang)}）。流動性：${liquidity} ESG：${esg}。本次優化持倉：${holdingsSummary}。${notes}`;
  }
  if (lang === "ko") {
    return `${name}, ${client.age}세, 위험성향 ${risk}, 투자기간 ${horizon}, AUM 약 ${formatUsd(client.aum_usd, lang)} (현금 약 ${formatUsd(client.cash_usd, lang)}). 유동성: ${liquidity} ESG: ${esg}. 이번 최적화 보유: ${holdingsSummary}. ${notes}`;
  }
  return `${name}, age ${client.age}, risk ${risk}, horizon ${horizon}, AUM ~${formatUsd(client.aum_usd, lang)} (cash ~${formatUsd(client.cash_usd, lang)}). Liquidity: ${liquidity} ESG: ${esg}. Scope holdings: ${holdingsSummary}. ${notes}`;
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

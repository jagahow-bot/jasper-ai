import {
  extractExplicitTickersFromTexts,
  uniqueTickers,
} from "@/lib/locked-universe";
import type {
  ClientOverlay,
  OverlayClarification,
  OverlayProposedTicker,
} from "@/lib/overlay-schema";
import {
  filterSellableProposed,
} from "@/lib/sellable-overrides";
import { getUniverseItems } from "@/lib/universe";
import { analyzeUniverseFilterFallback } from "@/lib/universe-filter-fallback";

/** Known catalog tickers named in clarification questions or option chips. */
export function tickersNamedInClarifications(
  clarifications: readonly OverlayClarification[],
  proposed?: readonly OverlayProposedTicker[],
): Set<string> {
  if (!clarifications.length) return new Set();
  const texts = clarifications.flatMap((c) => [
    c.question,
    ...c.options.flatMap((o) => [o.label, o.id]),
  ]);
  const haystack = texts.join("\n").toUpperCase();
  const covered = new Set(
    extractExplicitTickersFromTexts(texts).map((t) => t.toUpperCase()),
  );
  // Symbols in proposed_tickers but absent from catalog (e.g. AIQ) still count
  // when literally named in clarification chips.
  for (const p of proposed ?? []) {
    const sym = p.ticker.toUpperCase();
    if (sym && haystack.includes(sym)) covered.add(sym);
  }
  return covered;
}

/**
 * During clarify stage, hide proposed_tickers already offered as clarification
 * choices (e.g. AIQ/BOTZ/SMH chips) so RM is not asked twice.
 * Prefer {@link visibleProposedForUi} for UI / sign-off gates — that helper
 * hides the entire list while clarifications remain pending.
 */
export function proposedTickersAfterClarificationDedup(
  proposed: readonly OverlayProposedTicker[] | undefined,
  clarifications: readonly OverlayClarification[],
): OverlayProposedTicker[] {
  if (!proposed?.length) return [];
  if (!clarifications.length) return [...proposed];
  const covered = tickersNamedInClarifications(clarifications, proposed);
  if (!covered.size) return [...proposed];
  return proposed.filter((p) => !covered.has(p.ticker.toUpperCase()));
}

/**
 * UI / sign-off gate visible proposal list.
 * While clarifications are pending, always return [] (store may still keep
 * proposed_tickers). After clarifications clear, apply chip dedupe.
 */
export function visibleProposedForUi(
  proposed: readonly OverlayProposedTicker[] | undefined,
  clarifications: readonly OverlayClarification[],
): OverlayProposedTicker[] {
  if (clarifications.length > 0) return [];
  return proposedTickersAfterClarificationDedup(proposed, clarifications);
}

/** Fingerprint of universe prompts used to gate one-shot filter interrupts. */
export function overlayPromptsKey(overlay: ClientOverlay): string {
  return overlay.universe.prompts.filter(Boolean).join("\0");
}

/** True when the RM summary already lists suggestions (「建議參考標的」/ panel). */
export function overlayAlreadyShowsProposedTickers(overlay: ClientOverlay): boolean {
  return (overlay.universe.proposed_tickers?.length ?? 0) > 0;
}

/**
 * Filter matches not already in supplements or pending proposed_tickers.
 * These are the only candidates that should force the suggestions panel open.
 */
export function novelFilterProposedTickers(
  overlay: ClientOverlay,
  filterProposedTickers: readonly OverlayProposedTicker[] | undefined,
): OverlayProposedTicker[] {
  if (!filterProposedTickers?.length) return [];
  const existing = new Set(
    uniqueTickers([
      ...(overlay.universe.supplement_tickers ?? []),
      ...(overlay.universe.proposed_tickers?.map((p) => p.ticker) ?? []),
    ]).map((t) => t.toUpperCase()),
  );
  return filterProposedTickers.filter(
    (p) => !existing.has(p.ticker.toUpperCase()),
  );
}

export function mergeFilterProposedIntoOverlay(
  overlay: ClientOverlay,
  novel: readonly OverlayProposedTicker[],
): ClientOverlay {
  if (!novel.length) return overlay;
  return {
    ...overlay,
    universe: {
      ...overlay.universe,
      proposed_tickers: [
        ...(overlay.universe.proposed_tickers ?? []),
        ...novel,
      ].slice(0, 12),
    },
  };
}

/** Drop unconfirmed suggestions once the RM proceeds past the gate. */
export function clearProposedTickers(overlay: ClientOverlay): ClientOverlay {
  if (
    !overlay.universe.proposed_tickers?.length &&
    !overlay.universe.bulk_include?.length
  ) {
    return overlay;
  }
  return {
    ...overlay,
    universe: {
      ...overlay.universe,
      proposed_tickers: undefined,
      bulk_include: undefined,
    },
  };
}

export type FilterProposalDecision =
  | { action: "interrupt"; overlay: ClientOverlay; promptsKey: string }
  | { action: "proceed"; overlay: ClientOverlay };

/**
 * Finalize overlay on「確認 Overlay 並簽核」.
 *
 * Sign-off always proceeds: the chat-time ProposedTickersPanel is the only
 * suggestion-review UI. Confirm must not open another filter/propose pass
 * (even when `/api/universe/filter` returns novel tickers), or suggestions
 * reappear after the RM already clicked confirm.
 *
 * `filterProposedTickers` / `surfacedKey` are accepted for call-site
 * compatibility but never trigger an interrupt.
 */
export function decideFilterProposalInterrupt(opts: {
  overlay: ClientOverlay;
  filterProposedTickers?: readonly OverlayProposedTicker[];
  /** Prompts key from a prior interrupt in this confirm session, or null. */
  surfacedKey: string | null;
}): FilterProposalDecision {
  void opts.filterProposedTickers;
  void opts.surfacedKey;
  return { action: "proceed", overlay: clearProposedTickers(opts.overlay) };
}

/** Soft sleeve prompt lines are not investable-theme evidence by themselves. */
const SOFT_SLEEVE_PROMPT_RE = /^soft sleeve target/i;

type ThemeBucket = {
  id: string;
  match: RegExp;
  tickers: string[];
  rationale: { en: string; zh: string; ko: string };
};

/**
 * Catalog-backed theme → ETF suggestions when Gemini returns sleeve/themes
 * without concrete proposed_tickers (green bond / ESG / utilities, …).
 */
const THEME_PROPOSAL_BUCKETS: ThemeBucket[] = [
  {
    id: "green_bond",
    match:
      /green\s*bond|green\s*fixed|綠債|绿色债券|綠色債券|기후\s*채권|지속가능\s*채권|sustainable\s*bond/i,
    // No dedicated green-bond ETF in catalog — nearest aggregate FI proxies.
    tickers: ["AGG", "BND", "BNDX"],
    rationale: {
      en: "Nearest fixed-income proxies for a green-bond sleeve (catalog has no dedicated green-bond ETF)",
      zh: "綠債袖套的近似固定收益標的（標的池尚無專用綠債 ETF）",
      ko: "그린본드 슬리브용 근사 채권 ETF (전용 그린본드 ETF 없음)",
    },
  },
  {
    id: "esg_equity",
    match: /\besg\b|永續|可持續|可持续|社會責任|책임\s*투자|sustainab|responsible\s*invest/i,
    tickers: ["ESGU", "ESGV", "SUSA"],
    rationale: {
      en: "US ESG equity ETFs for the ESG sleeve",
      zh: "ESG 股票袖套建議標的",
      ko: "ESG 주식 슬리브 제안 종목",
    },
  },
  {
    id: "europe_asia",
    match:
      /europe|asia|歐|欧|亞|亚|유럽|아시아|eafe|ex-?us|國際股|国际股|developed\s*ex/i,
    tickers: ["IEFA", "VEU", "VGK"],
    rationale: {
      en: "Europe / Asia (ex-US) equity exposure",
      zh: "歐亞（美國除外）股票曝險",
      ko: "유럽·아시아(미국 제외) 주식 노출",
    },
  },
  {
    id: "utilities_infra",
    match:
      /utilit|公用|인프라|infra|infrastructure|基建|基礎設施|基础设施|전력|전력유틸/i,
    tickers: ["XLU", "VPU", "IDU", "PAVE"],
    rationale: {
      en: "Utilities / infrastructure sleeve",
      zh: "公用事業／基礎設施袖套",
      ko: "유틸리티·인프라 슬리브",
    },
  },
  {
    id: "clean_energy",
    match: /clean\s*energy|潔淨能源|清洁能源|태양광|solar|climate|氣候|기후/i,
    tickers: ["ICLN", "TAN"],
    rationale: {
      en: "Clean energy / climate thematic ETFs",
      zh: "潔淨能源／氣候主題 ETF",
      ko: "청정에너지·기후 테마 ETF",
    },
  },
  {
    id: "ai_tech",
    match: /\bai\b|artificial\s*intelligence|機器人|机器人|반도체|semi|科技衛星|ai\s*satellite/i,
    tickers: ["BOTZ", "AIQ", "SMH", "SOXX", "XLK"],
    rationale: {
      en: "AI / tech thematic ETFs",
      zh: "AI／科技主題 ETF",
      ko: "AI·테크 테마 ETF",
    },
  },
];

function overlayInstrumentCorpus(overlay: ClientOverlay): string {
  const sleeveKeys = Object.keys(overlay.allocation.sleeve_targets ?? {}).filter(
    (k) => !k.startsWith("w_"),
  );
  const subKeys = Object.keys(overlay.allocation.sub_sleeve_targets ?? {});
  const askBits = (overlay.asks ?? []).flatMap((a) => [
    a.title,
    a.summary,
    a.group_id ?? "",
    ...(a.tickers ?? []),
  ]);
  return [
    ...overlay.universe.prompts.filter((p) => p && !SOFT_SLEEVE_PROMPT_RE.test(p)),
    overlay.market_view.narrative_summary,
    ...(overlay.market_view.themes ?? []),
    ...sleeveKeys,
    ...subKeys,
    ...askBits,
    overlay.rationale,
    overlay.client_profile.esg_preference &&
    overlay.client_profile.esg_preference !== "none"
      ? `esg ${overlay.client_profile.esg_preference}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * True when the overlay implies investable themes / sleeves that need concrete
 * instruments — not just cash, objective, or exclude tweaks on the model book.
 */
export function overlayNeedsNewInstruments(overlay: ClientOverlay): boolean {
  const sleeves = overlay.allocation.sleeve_targets;
  if (sleeves) {
    for (const [key, raw] of Object.entries(sleeves)) {
      if (key.startsWith("w_")) continue;
      const w = Number(raw);
      if (Number.isFinite(w) && w > 0) return true;
    }
  }
  if (Object.keys(overlay.allocation.sub_sleeve_targets ?? {}).length) {
    return true;
  }

  const esg = overlay.client_profile.esg_preference;
  if (esg && esg !== "none") return true;

  if (overlay.universe.construction === "direct_index") return true;

  if ((overlay.universe.bulk_include?.length ?? 0) > 0) return true;

  for (const ask of overlay.asks ?? []) {
    if (ask.kind === "group_weight_band") {
      const hasTarget =
        (ask.target_pct != null && ask.target_pct > 0) ||
        (ask.min_pct != null && ask.min_pct > 0) ||
        (ask.max_pct != null && ask.max_pct > 0);
      if (hasTarget) return true;
    }
    if (ask.kind === "ticker_min" && (ask.tickers?.length ?? 0) > 0) return true;
    if (ask.kind === "direct_index") return true;
  }

  const themes = (overlay.market_view.themes ?? []).filter(Boolean);
  if (themes.some((t) => THEME_PROPOSAL_BUCKETS.some((b) => b.match.test(t)))) {
    return true;
  }

  const corpus = overlayInstrumentCorpus(overlay);
  if (!corpus.trim()) return false;
  return THEME_PROPOSAL_BUCKETS.some((b) => b.match.test(corpus));
}

/** Stable key for「無新增標的」ack — resets when thematic needs change. */
export function instrumentNeedsKey(overlay: ClientOverlay): string {
  const sleeves = Object.entries(overlay.allocation.sleeve_targets ?? {})
    .filter(([k, v]) => !k.startsWith("w_") && Number(v) > 0)
    .map(([k, v]) => `${k}:${Number(v).toFixed(4)}`)
    .sort();
  const themes = [...(overlay.market_view.themes ?? [])].map(String).sort();
  const prompts = overlay.universe.prompts
    .filter((p) => p && !SOFT_SLEEVE_PROMPT_RE.test(p))
    .map((p) => p.trim())
    .sort();
  const askIds = (overlay.asks ?? [])
    .filter(
      (a) =>
        a.kind === "group_weight_band" ||
        a.kind === "ticker_min" ||
        a.kind === "direct_index",
    )
    .map((a) => a.id)
    .sort();
  const bulkSig = (overlay.universe.bulk_include ?? [])
    .map((b) =>
      [b.id, b.asset_class, b.category, b.product_type, b.theme]
        .filter(Boolean)
        .join(":"),
    )
    .sort()
    .join("|");
  return [
    sleeves.join("|"),
    themes.join("|"),
    prompts.join("|"),
    askIds.join("|"),
    overlay.client_profile.esg_preference ?? "",
    overlay.universe.construction ?? "",
    bulkSig,
  ].join("\0");
}

function mapTickersToProposed(
  tickers: readonly string[],
  rationale: string,
): OverlayProposedTicker[] {
  const metaByTicker = new Map(
    getUniverseItems().map((u) => [u.ticker.toUpperCase(), u]),
  );
  const universe = new Set(metaByTicker.keys());
  const candidates = uniqueTickers(tickers)
    .filter((t) => universe.has(t.toUpperCase()))
    .map((ticker) => {
      const meta = metaByTicker.get(ticker.toUpperCase());
      return {
        ticker,
        name: meta?.name,
        category: meta?.category,
        rationale,
      };
    });
  try {
    return filterSellableProposed(candidates).kept;
  } catch (err) {
    console.warn("[sellable] mapTickersToProposed fail-open", err);
    return candidates;
  }
}

function localizedRationale(
  bucket: ThemeBucket,
  lang: "en" | "zh" | "ko",
): string {
  return bucket.rationale[lang] ?? bucket.rationale.en;
}

/**
 * Build catalog proposals from thematic sleeve / prompt / ask corpus when the
 * LLM left proposed_tickers empty.
 */
export function synthesizeThemeProposedTickers(
  overlay: ClientOverlay,
  lang: "en" | "zh" | "ko" = "en",
): OverlayProposedTicker[] {
  const corpus = overlayInstrumentCorpus(overlay);
  if (!corpus.trim() && !overlayNeedsNewInstruments(overlay)) return [];

  const already = new Set(
    uniqueTickers([
      ...(overlay.universe.supplement_tickers ?? []),
      ...(overlay.universe.proposed_tickers?.map((p) => p.ticker) ?? []),
    ]).map((t) => t.toUpperCase()),
  );

  const out: OverlayProposedTicker[] = [];
  const seen = new Set<string>(already);

  const push = (items: OverlayProposedTicker[]) => {
    for (const p of items) {
      const key = p.ticker.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(p);
      if (out.length >= 12) return;
    }
  };

  for (const bucket of THEME_PROPOSAL_BUCKETS) {
    if (!bucket.match.test(corpus)) continue;
    push(mapTickersToProposed(bucket.tickers, localizedRationale(bucket, lang)));
    if (out.length >= 12) break;
  }

  // Ask-listed tickers that never made it into supplements still need RM confirm.
  for (const ask of overlay.asks ?? []) {
    if (!ask.tickers?.length) continue;
    if (
      ask.kind !== "group_weight_band" &&
      ask.kind !== "ticker_min" &&
      ask.kind !== "direct_index"
    ) {
      continue;
    }
    const rationale =
      lang === "zh"
        ? `來自需求「${ask.title}」`
        : lang === "ko"
          ? `요구사항「${ask.title}」`
          : `From ask “${ask.title}”`;
    push(mapTickersToProposed(ask.tickers, rationale));
  }

  if (out.length < 12 && corpus.trim()) {
    const fallback = analyzeUniverseFilterFallback(corpus, lang);
    if (fallback.tickers?.length) {
      const rationale =
        lang === "zh"
          ? "依主題／產業關鍵字自標的池建議"
          : lang === "ko"
            ? "테마·섹터 키워드 기반 유니버스 제안"
            : "Catalog suggestions from theme / sector keywords";
      push(mapTickersToProposed(fallback.tickers.slice(0, 8), rationale));
    }
  }

  return out.slice(0, 12);
}

/**
 * When thematic needs exist but proposed_tickers is empty (and no supplements
 * yet), fill proposals from the catalog so the RM confirm step cannot be skipped.
 */
export function ensureProposedTickersForReview(
  overlay: ClientOverlay,
  lang: "en" | "zh" | "ko" = "en",
): ClientOverlay {
  if ((overlay.universe.proposed_tickers?.length ?? 0) > 0) return overlay;
  if ((overlay.universe.supplement_tickers?.length ?? 0) > 0) return overlay;
  if (!overlayNeedsNewInstruments(overlay)) return overlay;
  const synthesized = synthesizeThemeProposedTickers(overlay, lang);
  if (!synthesized.length) return overlay;
  return mergeFilterProposedIntoOverlay(overlay, synthesized);
}

/**
 * Block「確認 Overlay」until clarifications are done, then until proposed
 * tickers are added or RM explicitly acknowledges「無新增標的」for the
 * current thematic needs fingerprint.
 *
 * Clarifications-first: never allow Overlay sign-off while Qs remain.
 */
export function isTickerReviewBlocking(
  overlay: ClientOverlay,
  opts: {
    visibleProposed: readonly OverlayProposedTicker[];
    /** instrumentNeedsKey that the RM acknowledged with「無新增標的」. */
    noAddsAckKey: string | null;
    hasPendingClarifications?: boolean;
  },
): boolean {
  if (opts.hasPendingClarifications) return true;

  if (opts.visibleProposed.length > 0) return true;

  const needs = overlayNeedsNewInstruments(overlay);
  if (!needs) return false;

  if ((overlay.universe.supplement_tickers?.length ?? 0) > 0) {
    return false;
  }

  const needsKey = instrumentNeedsKey(overlay);
  if (opts.noAddsAckKey && opts.noAddsAckKey === needsKey) {
    return false;
  }
  return true;
}

export type ProposedBulkGroup = {
  bulkId: string | null;
  label: string;
  items: OverlayProposedTicker[];
  emptyHint?: boolean;
};

/** Group proposed tickers for bulk UI: curated first, then bulk_include order. */
export function groupProposedByBulk(
  proposed: readonly OverlayProposedTicker[],
  bulkInclude: readonly { id: string; label: string }[] | undefined,
): ProposedBulkGroup[] {
  const byId = new Map<string, OverlayProposedTicker[]>();
  const curated: OverlayProposedTicker[] = [];
  for (const p of proposed) {
    if (p.bulk_id) {
      const list = byId.get(p.bulk_id) ?? [];
      list.push(p);
      byId.set(p.bulk_id, list);
    } else {
      curated.push(p);
    }
  }

  const groups: ProposedBulkGroup[] = [];
  if (curated.length) {
    groups.push({ bulkId: null, label: "", items: curated });
  }

  const seen = new Set<string>();
  for (const b of bulkInclude ?? []) {
    seen.add(b.id);
    const items = byId.get(b.id) ?? [];
    groups.push({
      bulkId: b.id,
      label: b.label,
      items,
      emptyHint: items.length === 0,
    });
  }
  // Orphan bulk_id rows (no matching bulk_include) → curated-like group
  for (const [id, items] of byId) {
    if (seen.has(id) || !items.length) continue;
    groups.push({
      bulkId: id,
      label: id,
      items,
    });
  }
  return groups;
}

/**
 * After confirming selected tickers: prune finished bulk groups from pending
 * and append to confirmed_bulk_batches ledger.
 * `priorProposed` = proposed list *before* removing confirmed tickers.
 */
export function applyBulkConfirmLedger(
  overlay: ClientOverlay,
  confirmedTickers: readonly string[],
  priorProposed: readonly OverlayProposedTicker[] | undefined,
): ClientOverlay {
  const selected = new Set(confirmedTickers.map((t) => t.toUpperCase()));
  const pendingBulk = overlay.universe.bulk_include ?? [];
  if (!pendingBulk.length && !overlay.confirmed_bulk_batches?.length) {
    return overlay;
  }

  const remainingProposed = overlay.universe.proposed_tickers ?? [];
  const remainingByBulk = new Map<string, number>();
  for (const p of remainingProposed) {
    if (!p.bulk_id) continue;
    remainingByBulk.set(
      p.bulk_id,
      (remainingByBulk.get(p.bulk_id) ?? 0) + 1,
    );
  }

  const newBatches = [...(overlay.confirmed_bulk_batches ?? [])];
  const keptPending: typeof pendingBulk = [];

  for (const b of pendingBulk) {
    const fromThisBatch = (priorProposed ?? [])
      .filter(
        (p) =>
          p.bulk_id === b.id && selected.has(p.ticker.toUpperCase()),
      )
      .map((p) => p.ticker.toUpperCase());
    const stillPending = remainingByBulk.get(b.id) ?? 0;
    if (fromThisBatch.length) {
      const existing = newBatches.findIndex((x) => x.bulk_id === b.id);
      const entry = {
        bulk_id: b.id,
        label: b.label,
        tickers: fromThisBatch,
        confirmed_at: new Date().toISOString(),
      };
      if (existing >= 0) {
        const merged = uniqueTickers([
          ...newBatches[existing].tickers,
          ...fromThisBatch,
        ]);
        newBatches[existing] = { ...entry, tickers: merged };
      } else {
        newBatches.push(entry);
      }
    }
    if (stillPending > 0) {
      keptPending.push(b);
    }
  }

  return {
    ...overlay,
    universe: {
      ...overlay.universe,
      bulk_include: keptPending.length ? keptPending : undefined,
    },
    confirmed_bulk_batches: newBatches.length ? newBatches : undefined,
  };
}

/** Revoke a confirmed batch by bulk_id — remove intersection from supplements. */
export function revokeConfirmedBulk(
  overlay: ClientOverlay,
  bulkId: string,
): { overlay: ClientOverlay; removed: string[]; label: string } | null {
  const batch = overlay.confirmed_bulk_batches?.find((b) => b.bulk_id === bulkId);
  if (!batch) return null;
  const removeSet = new Set(batch.tickers.map((t) => t.toUpperCase()));
  const remainingSup = (overlay.universe.supplement_tickers ?? []).filter(
    (t) => !removeSet.has(t.toUpperCase()),
  );
  const remainingLedger = (overlay.confirmed_bulk_batches ?? []).filter(
    (b) => b.bulk_id !== bulkId,
  );
  return {
    overlay: {
      ...overlay,
      universe: {
        ...overlay.universe,
        supplement_tickers: remainingSup.length ? remainingSup : undefined,
      },
      confirmed_bulk_batches: remainingLedger.length
        ? remainingLedger
        : undefined,
    },
    removed: batch.tickers,
    label: batch.label,
  };
}

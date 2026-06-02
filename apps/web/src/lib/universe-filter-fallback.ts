import { getUniverseItems } from "./universe";
import type { UniverseFilterOutput } from "./universe-filter-schema";

const SHORT_MARKET_TICKERS = [
  "BTAL",
  "PUTW",
  "CTA",
  "DBMF",
  "KMLM",
  "MNA",
  "SVOL",
  "QAI",
  "RLY",
];

const AI_THEMATIC_TICKERS = [
  "BOTZ",
  "ROBO",
  "IRBO",
  "AIQ",
  "THNQ",
  "IGV",
  "SKYY",
  "WCLD",
  "SMH",
  "SOXX",
  "XSD",
  "XLK",
  "VGT",
  "FTEC",
];

const SECTOR_TICKERS: Record<string, string[]> = {
  technology: ["XLK", "VGT", "FTEC", "IYW", "XNTK", "IGV", "XSW", "SMH", "SOXX", "XSD"],
  tech: ["XLK", "VGT", "FTEC", "IYW", "XNTK", "IGV", "XSW", "SMH", "SOXX", "XSD"],
  healthcare: ["XLV", "VHT", "FXH", "XBI", "IBB", "XPH", "PPH", "XHE", "IHI", "IHF", "XHS"],
  health: ["XLV", "VHT", "FXH", "XBI", "IBB", "XPH", "PPH", "XHE", "IHI", "IHF", "XHS"],
  financials: ["XLF", "VFH", "IYF", "KBE", "KRE", "KIE"],
  finance: ["XLF", "VFH", "IYF", "KBE", "KRE", "KIE"],
  energy: ["XLE", "VDE", "IYE", "XOP", "XES"],
  industrials: ["XLI", "VIS", "XAR", "ITA", "IYT", "PAVE"],
  materials: ["XLB", "IYM", "XME"],
  utilities: ["XLU", "VPU", "IDU"],
  staples: ["XLP", "VDC", "IYK"],
  discretionary: ["XLY", "VCR", "IYC", "XRT", "XHB", "ITB"],
  consumer: ["XLP", "VDC", "IYK", "XLY", "VCR", "IYC", "XRT"],
  communication: ["XLC", "VOX", "XTL", "FDN"],
  real_estate: ["VNQ", "IYR", "RWR", "USRT", "XLRE"],
  reit: ["VNQ", "IYR", "RWR", "USRT", "XLRE"],
};

function tickersForKeywords(text: string): string[] | undefined {
  const lower = text.toLowerCase();
  const matched = new Set<string>();
  for (const [key, tickers] of Object.entries(SECTOR_TICKERS)) {
    if (lower.includes(key)) {
      for (const t of tickers) matched.add(t);
    }
  }
  if (!matched.size) return undefined;
  const universe = new Set(getUniverseItems().map((u) => u.ticker));
  return [...matched].filter((t) => universe.has(t));
}

function categoriesForText(text: string): string[] | undefined {
  const lower = text.toLowerCase();
  const cats = new Set<string>();
  if (/sector|industry|gics|tech|health|financial|energy|staple|utility|material|industrial|consumer|communication|biotech|software|semiconductor|bank|pharma|reit/.test(lower)) {
    cats.add("us_sector");
    cats.add("us_industry");
  }
  if (/treasury|t-?bill|duration|bond|fixed income|credit|muni|tips|inflation/.test(lower)) {
    cats.add("treasury");
    cats.add("aggregate");
    cats.add("credit_ig");
    cats.add("credit_hy");
    cats.add("inflation");
    cats.add("muni");
    cats.add("bond_floating");
    cats.add("bond_mbs");
    cats.add("intl_bond");
    cats.add("em_bond");
  }
  if (/commodit|gold|oil|precious|agriculture/.test(lower)) {
    cats.add("precious");
    cats.add("energy");
    cats.add("broad");
    cats.add("commodity_agriculture");
    cats.add("industrial");
  }
  if (/reit|real estate/.test(lower)) {
    cats.add("reit");
    cats.add("reit_mortgage");
    cats.add("reit_sector");
  }
  if (/thematic|theme|ai |robot|cloud|cyber|solar|uranium|nuclear|ev |electric vehicle/.test(lower)) {
    cats.add("us_thematic");
    cats.add("intl_thematic");
  }
  return cats.size ? [...cats] : undefined;
}

export function analyzeUniverseFilterFallback(text: string): UniverseFilterOutput {
  const lower = text.toLowerCase();
  const universe = new Set(getUniverseItems().map((u) => u.ticker));
  const pick = (list: string[]) => list.filter((t) => universe.has(t));

  let tickers: string[] | undefined;
  let categories = categoriesForText(text);

  if (/short.*(stock|equity|market)|bear.*(market|equity)|inverse.*(market|equity)|hedge.*equity/.test(lower)) {
    tickers = pick(SHORT_MARKET_TICKERS);
    categories = ["alt_hedge", "alt_managed_futures", "multi_alt"];
  } else if (/\bai\b|artificial intelligence|machine learning|robot/.test(lower)) {
    tickers = pick(AI_THEMATIC_TICKERS);
    categories = ["us_thematic", "us_industry"];
  } else {
    tickers = tickersForKeywords(text);
  }

  const parts: string[] = [];
  if (tickers?.length) parts.push(`${tickers.length} matching ETF(s)`);
  if (categories?.length) {
    parts.push(`Categories: ${categories.slice(0, 4).join(", ")}${categories.length > 4 ? "…" : ""}`);
  }

  return {
    asset_classes: undefined,
    categories,
    tickers,
    rationale: parts.join(" · ") || "Supplement tickers from rule-based match in full universe.",
  };
}

import type { AssetClass } from "./constants";
import { ASSET_CLASSES } from "./constants";
import { getUniverseItems } from "./universe";
import type { UniverseFilterOutput } from "./universe-filter-schema";

const ALL: AssetClass[] = [...ASSET_CLASSES];

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
  let asset_classes: AssetClass[] = [...ALL];

  if (/no bond|without bond|exclude bond|bond.?free|equity only|stock only|equities only/.test(lower)) {
    asset_classes = ALL.filter((c) => c !== "bond");
  }
  if (/bond only|fixed income only|treasury only|no equity|without equity|exclude equity/.test(lower)) {
    asset_classes = ["bond"];
  }
  if (/commodit(y|ies) only|gold only|no equity|no bond/.test(lower) && /commodit|gold|oil|precious/.test(lower)) {
    asset_classes = ["commodity"];
  }
  if (/reit only|real estate only/.test(lower)) {
    asset_classes = ["real_estate"];
  }
  if (/equity and bond|stock and bond|balanced|multi-asset|diversified/.test(lower)) {
    asset_classes = ["equity", "bond"];
  }
  if (/sector|industry|tech|health|financial|energy|only/.test(lower) && !/bond|commodit|reit|alt/.test(lower)) {
    asset_classes = ["equity"];
  }

  const categories = categoriesForText(text);
  const tickers = tickersForKeywords(text);

  const parts: string[] = [];
  parts.push(`Asset classes: ${asset_classes.join(", ")}`);
  if (categories?.length) parts.push(`Categories: ${categories.slice(0, 4).join(", ")}${categories.length > 4 ? "…" : ""}`);
  if (tickers?.length) parts.push(`${tickers.length} sector/industry tickers`);

  return {
    asset_classes,
    categories,
    tickers,
    rationale: parts.join(" · ") || "Applied rule-based universe filter from your text.",
  };
}

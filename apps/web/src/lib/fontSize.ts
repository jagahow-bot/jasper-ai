export const FONT_SIZE_STORAGE_KEY = "jasper-font-size-root";

/** Root rem base sizes (px on html). */
export const FONT_SIZE_STEPS = [16, 17, 18, 19, 20, 21] as const;

/** Previous default before global bump (migrate stored preference once). */
export const FONT_SIZE_LEGACY_DEFAULT = 17;

export const FONT_SIZE_DEFAULT = 18;

export type FontSizePx = (typeof FONT_SIZE_STEPS)[number];

export function fontSizeToCss(px: number): string {
  return `${px}px`;
}

export function parseStoredFontSize(raw: string | null): FontSizePx | null {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return null;
  return (FONT_SIZE_STEPS as readonly number[]).includes(n) ? (n as FontSizePx) : null;
}

export function clampFontSize(px: number): FontSizePx {
  const steps = FONT_SIZE_STEPS as readonly number[];
  if (px <= steps[0]) return steps[0] as FontSizePx;
  if (px >= steps[steps.length - 1]) return steps[steps.length - 1] as FontSizePx;
  let closest = steps[0] as FontSizePx;
  let minDist = Math.abs(px - steps[0]);
  for (const s of steps) {
    const d = Math.abs(px - s);
    if (d < minDist) {
      minDist = d;
      closest = s as FontSizePx;
    }
  }
  return closest;
}

export function applyFontSizeRoot(px: FontSizePx): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--font-size-root", fontSizeToCss(px));
  if (px >= 18) {
    root.setAttribute("data-font-lg", "true");
  } else {
    root.removeAttribute("data-font-lg");
  }
}

export function persistFontSize(px: FontSizePx): void {
  try {
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(px));
  } catch {
    /* private mode / quota */
  }
}

export function readStoredFontSize(): FontSizePx | null {
  if (typeof window === "undefined") return null;
  try {
    return parseStoredFontSize(localStorage.getItem(FONT_SIZE_STORAGE_KEY));
  } catch {
    return null;
  }
}

function migrateStoredFontSize(stored: FontSizePx | null): FontSizePx {
  if (stored === FONT_SIZE_LEGACY_DEFAULT) {
    return FONT_SIZE_DEFAULT;
  }
  return stored ?? FONT_SIZE_DEFAULT;
}

export function initFontSizeFromStorage(): FontSizePx {
  const px = migrateStoredFontSize(readStoredFontSize());
  applyFontSizeRoot(px);
  return px;
}

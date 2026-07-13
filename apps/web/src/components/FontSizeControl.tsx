"use client";

import { useCallback, useEffect, useState } from "react";
import {
  FONT_SIZE_DEFAULT,
  FONT_SIZE_STEPS,
  type FontSizePx,
  applyFontSizeRoot,
  initFontSizeFromStorage,
  persistFontSize,
} from "@/lib/fontSize";
import { useI18n } from "@/lib/i18n";

function stepIndex(px: FontSizePx): number {
  return FONT_SIZE_STEPS.indexOf(px);
}

export function FontSizeControl() {
  const { t } = useI18n();
  const [sizePx, setSizePx] = useState<FontSizePx>(FONT_SIZE_DEFAULT);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSizePx(initFontSizeFromStorage());
    setReady(true);
  }, []);

  const apply = useCallback((px: FontSizePx) => {
    applyFontSizeRoot(px);
    persistFontSize(px);
    setSizePx(px);
  }, []);

  const shrink = useCallback(() => {
    const i = stepIndex(sizePx);
    if (i > 0) apply(FONT_SIZE_STEPS[i - 1]);
  }, [apply, sizePx]);

  const enlarge = useCallback(() => {
    const i = stepIndex(sizePx);
    if (i < FONT_SIZE_STEPS.length - 1) apply(FONT_SIZE_STEPS[i + 1]);
  }, [apply, sizePx]);

  const reset = useCallback(() => {
    apply(FONT_SIZE_DEFAULT);
  }, [apply]);

  const atMin = stepIndex(sizePx) === 0;
  const atMax = stepIndex(sizePx) === FONT_SIZE_STEPS.length - 1;
  const isDefault = sizePx === FONT_SIZE_DEFAULT;

  return (
    <div
      className="flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] bg-white px-1 py-0.5 shadow-sm"
      role="group"
      aria-label={t("font.aria")}
      title={t("font.aria")}
    >
      <span className="px-1 text-xs font-medium text-[var(--text-dim)]">
        {t("font.label")}
      </span>
      <button
        type="button"
        className="flex h-7 min-w-7 items-center justify-center rounded-md border border-transparent text-sm font-semibold leading-none text-[var(--foreground)] transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-40"
        onClick={shrink}
        disabled={!ready || atMin}
        aria-label={t("font.decrease")}
        title={t("font.decrease")}
      >
        A−
      </button>
      <span
        className="min-w-[2rem] text-center text-sm font-medium tabular-nums leading-none text-[var(--text-dim)]"
        aria-live="polite"
        aria-atomic="true"
      >
        {ready ? sizePx : "—"}
      </span>
      <button
        type="button"
        className="flex h-7 min-w-7 items-center justify-center rounded-md border border-transparent text-sm font-semibold leading-none text-[var(--foreground)] transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-40"
        onClick={enlarge}
        disabled={!ready || atMax}
        aria-label={t("font.increase")}
        title={t("font.increase")}
      >
        A+
      </button>
      {!isDefault && (
        <button
          type="button"
          className="h-7 rounded-md border border-transparent px-1.5 text-xs leading-none text-[var(--text-dim)] transition hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
          onClick={reset}
          disabled={!ready}
          aria-label={t("font.reset")}
          title={t("font.reset")}
        >
          {t("font.resetShort")}
        </button>
      )}
    </div>
  );
}

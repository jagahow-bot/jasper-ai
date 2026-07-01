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
      className="flex h-8 items-center gap-1 border-2 border-[var(--neon-dim)] bg-[#050508] px-1 py-0.5 shadow-[0_0_12px_rgba(57,255,20,0.12)]"
      role="group"
      aria-label={t("font.aria")}
      title={t("font.aria")}
    >
      <span className="px-0.5 font-terminal text-[10px] font-bold tracking-wide text-[var(--cyan)]">
        {t("font.label")}
      </span>
      <button
        type="button"
        className="font-terminal flex h-7 min-w-7 items-center justify-center border-2 border-[var(--border)] bg-[#0a1a0a] text-sm font-bold leading-none text-[var(--neon)] transition hover:border-[var(--neon)] hover:bg-[#122812] disabled:cursor-not-allowed disabled:opacity-40"
        onClick={shrink}
        disabled={!ready || atMin}
        aria-label={t("font.decrease")}
        title={t("font.decrease")}
      >
        A−
      </button>
      <span
        className="min-w-[2rem] text-center font-terminal text-sm font-bold tabular-nums leading-none text-[var(--cyan)]"
        aria-live="polite"
        aria-atomic="true"
      >
        {ready ? sizePx : "—"}
      </span>
      <button
        type="button"
        className="font-terminal flex h-7 min-w-7 items-center justify-center border-2 border-[var(--border)] bg-[#0a1a0a] text-sm font-bold leading-none text-[var(--neon)] transition hover:border-[var(--neon)] hover:bg-[#122812] disabled:cursor-not-allowed disabled:opacity-40"
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
          className="font-terminal h-7 border-2 border-[var(--border)] bg-[#0a1a0a] px-1.5 text-[10px] leading-none text-[var(--text-dim)] transition hover:border-[var(--neon-dim)] hover:text-[var(--neon)]"
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

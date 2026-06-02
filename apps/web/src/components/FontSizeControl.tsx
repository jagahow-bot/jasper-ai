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

function stepIndex(px: FontSizePx): number {
  return FONT_SIZE_STEPS.indexOf(px);
}

export function FontSizeControl() {
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
      className="flex items-center gap-1.5 border-2 border-[var(--neon-dim)] bg-[#050508] px-2 py-1 shadow-[0_0_12px_rgba(57,255,20,0.12)]"
      role="group"
      aria-label="Font size"
      title="Font size"
    >
      <span className="px-0.5 font-terminal text-base font-bold tracking-wide text-[var(--cyan)]">
        FONT
      </span>
      <button
        type="button"
        className="font-terminal flex min-h-11 min-w-11 items-center justify-center border-2 border-[var(--border)] bg-[#0a1a0a] text-lg font-bold leading-none text-[var(--neon)] transition hover:border-[var(--neon)] hover:bg-[#122812] disabled:cursor-not-allowed disabled:opacity-40"
        onClick={shrink}
        disabled={!ready || atMin}
        aria-label="Decrease font size"
        title="Decrease font size"
      >
        A−
      </button>
      <span
        className="min-w-[2.5rem] text-center font-terminal text-lg font-bold tabular-nums text-[var(--cyan)]"
        aria-live="polite"
        aria-atomic="true"
      >
        {ready ? sizePx : "—"}
      </span>
      <button
        type="button"
        className="font-terminal flex min-h-11 min-w-11 items-center justify-center border-2 border-[var(--border)] bg-[#0a1a0a] text-lg font-bold leading-none text-[var(--neon)] transition hover:border-[var(--neon)] hover:bg-[#122812] disabled:cursor-not-allowed disabled:opacity-40"
        onClick={enlarge}
        disabled={!ready || atMax}
        aria-label="Increase font size"
        title="Increase font size"
      >
        A+
      </button>
      {!isDefault && (
        <button
          type="button"
          className="font-terminal min-h-11 border-2 border-[var(--border)] bg-[#0a1a0a] px-2 text-sm text-[var(--text-dim)] transition hover:border-[var(--neon-dim)] hover:text-[var(--neon)]"
          onClick={reset}
          disabled={!ready}
          aria-label="Reset font size"
          title="Reset font size"
        >
          RESET
        </button>
      )}
    </div>
  );
}

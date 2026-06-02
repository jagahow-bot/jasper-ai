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
      className="flex items-center gap-1 border-2 border-[var(--border)] bg-[#050508] px-1 py-0.5"
      role="group"
      aria-label="字體大小"
      title="字體大小"
    >
      <span className="hidden px-1 font-pixel text-[9px] uppercase tracking-wide text-[var(--text-dim)] sm:inline">
        字體
      </span>
      <button
        type="button"
        className="font-pixel min-w-[2rem] border border-[var(--border)] bg-[#0a1a0a] px-1.5 py-0.5 text-[9px] uppercase text-[var(--neon)] transition hover:border-[var(--neon)] disabled:cursor-not-allowed disabled:opacity-40"
        onClick={shrink}
        disabled={!ready || atMin}
        aria-label="縮小字體"
        title="縮小字體"
      >
        A−
      </button>
      <span
        className="min-w-[2.25rem] text-center font-terminal text-sm tabular-nums text-[var(--cyan)]"
        aria-live="polite"
        aria-atomic="true"
      >
        {ready ? sizePx : "—"}
      </span>
      <button
        type="button"
        className="font-pixel min-w-[2rem] border border-[var(--border)] bg-[#0a1a0a] px-1.5 py-0.5 text-[9px] uppercase text-[var(--neon)] transition hover:border-[var(--neon)] disabled:cursor-not-allowed disabled:opacity-40"
        onClick={enlarge}
        disabled={!ready || atMax}
        aria-label="放大字體"
        title="放大字體"
      >
        A+
      </button>
      {!isDefault && (
        <button
          type="button"
          className="font-pixel border border-[var(--border)] bg-[#0a1a0a] px-1 py-0.5 text-[8px] uppercase text-[var(--text-dim)] transition hover:border-[var(--neon-dim)] hover:text-[var(--neon)]"
          onClick={reset}
          disabled={!ready}
          aria-label="重設字體大小"
          title="重設為預設"
        >
          重設
        </button>
      )}
    </div>
  );
}

"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LANGUAGES, useI18n } from "@/lib/i18n";

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18" />
      <path d="M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}

export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const currentLabel =
    LANGUAGES.find((item) => item.code === lang)?.label ?? lang;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-white text-[var(--text-dim)] shadow-sm transition hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
        aria-label={`${t("lang.aria")}: ${currentLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={t("lang.aria")}
        onClick={() => setOpen((value) => !value)}
      >
        <GlobeIcon className="h-4 w-4" />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={t("lang.aria")}
          className="absolute right-0 top-full z-50 mt-1 min-w-[7.5rem] overflow-hidden rounded-lg border border-[var(--border)] bg-white py-1 shadow-md"
        >
          {LANGUAGES.map(({ code, label }) => {
            const selected = lang === code;
            return (
              <button
                key={code}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                className={`flex w-full items-center px-3 py-1.5 text-left text-sm font-medium transition ${
                  selected
                    ? "bg-[var(--primary-muted)] text-[var(--primary)]"
                    : "text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
                }`}
                onClick={() => {
                  setLang(code);
                  setOpen(false);
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

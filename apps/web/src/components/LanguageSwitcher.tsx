"use client";

import { LANGUAGES, useI18n } from "@/lib/i18n";

export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();

  return (
    <div
      className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] bg-white px-1 py-0.5 shadow-sm"
      role="group"
      aria-label={t("lang.aria")}
      title={t("lang.aria")}
    >
      <span className="px-1 text-xs font-medium text-[var(--text-dim)]">
        {t("lang.label")}
      </span>
      {LANGUAGES.map(({ code, label }) => (
        <button
          key={code}
          type="button"
          className={`flex h-7 min-w-7 items-center justify-center rounded-md border px-1.5 text-sm font-medium leading-none transition ${
            lang === code
              ? "border-[var(--primary)] bg-[var(--primary-muted)] text-[var(--primary)]"
              : "border-transparent bg-transparent text-[var(--text-dim)] hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
          }`}
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
          aria-label={label}
          title={label}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

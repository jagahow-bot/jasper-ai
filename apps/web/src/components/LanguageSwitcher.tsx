"use client";

import { LANGUAGES, useI18n } from "@/lib/i18n";

export function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();

  return (
    <div
      className="flex h-8 items-center gap-1 border-2 border-[var(--neon-dim)] bg-[#050508] px-1 py-0.5 shadow-[0_0_12px_rgba(57,255,20,0.12)]"
      role="group"
      aria-label={t("lang.aria")}
      title={t("lang.aria")}
    >
      <span className="px-0.5 font-terminal text-[10px] font-bold tracking-wide text-[var(--cyan)]">
        {t("lang.label")}
      </span>
      {LANGUAGES.map(({ code, label }) => (
        <button
          key={code}
          type="button"
          className={`font-terminal flex h-7 min-w-7 items-center justify-center border-2 px-1.5 text-sm font-bold leading-none transition ${
            lang === code
              ? "border-[var(--neon)] bg-[#122812] text-[var(--neon)]"
              : "border-[var(--border)] bg-[#0a1a0a] text-[var(--text-dim)] hover:border-[var(--neon)] hover:text-[var(--neon)]"
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

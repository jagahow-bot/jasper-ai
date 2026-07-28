"use client";

import { useI18n } from "@/lib/i18n";

type Variant = "default" | "compact";

export function ComplianceBadge({ variant = "default" }: { variant?: Variant }) {
  const { t } = useI18n();
  if (variant === "compact") {
    return (
      <span className="inline-flex items-center rounded-full border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-2 py-0.5 text-xs font-medium text-[var(--amber)]">
        {t("compliance.badgeCompact")}
      </span>
    );
  }
  return (
    <div className="rounded-lg border border-[var(--amber)]/40 bg-[var(--amber)]/10 px-3 py-2 text-sm text-[var(--amber)]">
      {t("compliance.badgeDefault")}
    </div>
  );
}

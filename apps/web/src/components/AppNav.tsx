"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FontSizeControl } from "@/components/FontSizeControl";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useI18n } from "@/lib/i18n";

type NavItem = {
  href: string;
  labelKey: string;
  match?: (path: string) => boolean;
};

const NAV: NavItem[] = [
  {
    href: "/clients",
    labelKey: "nav.clients",
    match: (p) => p === "/clients" || p.startsWith("/clients/"),
  },
  { href: "/pool", labelKey: "nav.pool", match: (p) => p === "/pool" },
  { href: "/models", labelKey: "nav.models", match: (p) => p === "/models" },
  {
    href: "/",
    labelKey: "nav.personalization",
    match: (p) => p === "/",
  },
];

type Props = {
  subtitle?: string;
  showLabLink?: boolean;
  extraBadges?: React.ReactNode;
};

export function AppNav({ subtitle, showLabLink = false, extraBadges }: Props) {
  const { t } = useI18n();
  const pathname = usePathname() ?? "/";

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface)] shadow-sm">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="min-w-0">
            <Link
              href="/clients"
              className="text-lg font-semibold tracking-tight text-[var(--foreground)] md:text-xl"
            >
              JASPER.AI
            </Link>
            {subtitle ? (
              <p className="mt-0.5 text-sm text-[var(--text-dim)]">{subtitle}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <LanguageSwitcher />
            <FontSizeControl />
            {extraBadges}
            {showLabLink ? (
              <Link
                href="/lab/objective-switch"
                className="pixel-badge pixel-badge-link"
              >
                {t("header.objectiveLab")}
              </Link>
            ) : null}
          </div>
        </div>
        <nav
          className="flex flex-wrap gap-1.5"
          aria-label={t("nav.aria")}
        >
          {NAV.map((item) => {
            const active = item.match
              ? item.match(pathname)
              : pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                  active
                    ? "border-[var(--primary)] bg-[var(--primary-muted)] text-[var(--primary)]"
                    : "border-[var(--border)] bg-white text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
                }`}
              >
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
          <div className="min-w-0 max-w-full shrink-0 basis-full sm:basis-auto">
            <Link
              href="/clients"
              className="text-lg font-semibold tracking-tight text-[var(--foreground)] md:text-xl"
            >
              JASPER.AI
            </Link>
            {subtitle ? (
              <p className="mt-0.5 truncate text-sm text-[var(--text-dim)]">
                {subtitle}
              </p>
            ) : null}
          </div>
          <div className="flex min-w-0 max-w-full flex-[1_1_14rem] flex-wrap items-center gap-2 sm:justify-end sm:gap-3">
            <LanguageSwitcher />
            {extraBadges}
            {showLabLink ? (
              <Link
                href="/lab/objective-switch"
                className="pixel-badge pixel-badge-link shrink-0"
              >
                {t("header.objectiveLab")}
              </Link>
            ) : null}
          </div>
        </div>
        <nav
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:thin] sm:flex-wrap sm:overflow-visible sm:pb-0"
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
                className={`shrink-0 whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
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

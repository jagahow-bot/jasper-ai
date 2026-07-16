"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
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
  {
    href: "/settings",
    labelKey: "nav.settings",
    match: (p) => p === "/settings" || p.startsWith("/settings/"),
  },
];

type Props = {
  subtitle?: string;
  extraBadges?: React.ReactNode;
};

function MenuIcon({ open }: { open: boolean }) {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {open ? (
        <>
          <path d="M6 6l12 12" />
          <path d="M18 6L6 18" />
        </>
      ) : (
        <>
          <path d="M4 7h16" />
          <path d="M4 12h16" />
          <path d="M4 17h16" />
        </>
      )}
    </svg>
  );
}

function isActive(item: NavItem, pathname: string) {
  return item.match ? item.match(pathname) : pathname === item.href;
}

function navLinkClass(active: boolean) {
  return `shrink-0 whitespace-nowrap rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
    active
      ? "border-[var(--primary)] bg-[var(--primary-muted)] text-[var(--primary)]"
      : "border-[var(--border)] bg-white text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
  }`;
}

export function AppNav({ subtitle, extraBadges }: Props) {
  const { t } = useI18n();
  const pathname = usePathname() ?? "/";
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface)] shadow-sm">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex items-start justify-between gap-x-3">
          <div className="min-w-0">
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
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
            <div ref={menuRef} className="relative md:hidden">
              <button
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-white text-[var(--text-dim)] shadow-sm transition hover:bg-[var(--surface-2)] hover:text-[var(--foreground)]"
                aria-label={t("nav.menu")}
                aria-expanded={menuOpen}
                aria-controls={menuId}
                onClick={() => setMenuOpen((value) => !value)}
              >
                <MenuIcon open={menuOpen} />
              </button>
              {menuOpen ? (
                <nav
                  id={menuId}
                  aria-label={t("nav.aria")}
                  className="absolute right-0 top-full z-50 mt-1 min-w-[12rem] overflow-hidden rounded-lg border border-[var(--border)] bg-white py-1 shadow-md"
                >
                  {NAV.map((item) => {
                    const active = isActive(item, pathname);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`block border-0 px-3 py-2 text-sm font-medium transition ${
                          active
                            ? "bg-[var(--primary-muted)] text-[var(--primary)]"
                            : "text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
                        }`}
                        onClick={() => setMenuOpen(false)}
                      >
                        {t(item.labelKey)}
                      </Link>
                    );
                  })}
                </nav>
              ) : null}
            </div>
            <LanguageSwitcher />
            {extraBadges}
          </div>
        </div>
        <nav
          className="-mx-1 hidden gap-1.5 px-1 md:flex md:flex-wrap"
          aria-label={t("nav.aria")}
        >
          {NAV.map((item) => {
            const active = isActive(item, pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={navLinkClass(active)}
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

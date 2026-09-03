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

/** Client journey — always visible in the primary row. */
const PRIMARY_NAV: NavItem[] = [
  {
    href: "/clients",
    labelKey: "nav.clients",
    match: (p) => p === "/clients" || p.startsWith("/clients/"),
  },
  {
    href: "/",
    labelKey: "nav.personalization",
    match: (p) => p === "/",
  },
];

/** Shelf / admin — under Tools to keep RM focus on clients. */
const TOOLS_NAV: NavItem[] = [
  { href: "/pool", labelKey: "nav.pool", match: (p) => p === "/pool" },
  { href: "/models", labelKey: "nav.models", match: (p) => p === "/models" },
  {
    href: "/gaps",
    labelKey: "nav.gaps",
    match: (p) => p === "/gaps" || p.startsWith("/gaps/"),
  },
  {
    href: "/docs/engine",
    labelKey: "nav.engineDocs",
    match: (p) => p.startsWith("/docs/engine"),
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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 transition ${open ? "rotate-180" : ""}`}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
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
  const [toolsOpen, setToolsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const toolsId = useId();

  const toolsActive = TOOLS_NAV.some((item) => isActive(item, pathname));

  useEffect(() => {
    setMenuOpen(false);
    setToolsOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen && !toolsOpen) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuOpen && !menuRef.current?.contains(target)) {
        setMenuOpen(false);
      }
      if (toolsOpen && !toolsRef.current?.contains(target)) {
        setToolsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        setToolsOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen, toolsOpen]);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[var(--surface)] shadow-sm">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:px-6 sm:py-2.5">
        <div className="min-w-0 shrink-0">
          <Link
            href="/clients"
            className="text-lg font-semibold leading-tight tracking-tight text-[var(--foreground)]"
          >
            JASPER.AI
          </Link>
          {subtitle ? (
            <p className="truncate text-xs leading-snug text-[var(--text-dim)] sm:text-sm">
              {subtitle}
            </p>
          ) : null}
        </div>

        <nav
          className="-mx-1 hidden min-w-0 flex-1 flex-wrap items-center gap-1.5 px-1 md:flex"
          aria-label={t("nav.aria")}
        >
          {PRIMARY_NAV.map((item) => {
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

          <div ref={toolsRef} className="relative">
            <button
              type="button"
              className={`${navLinkClass(toolsActive)} inline-flex items-center gap-1`}
              aria-expanded={toolsOpen}
              aria-controls={toolsId}
              aria-haspopup="menu"
              onClick={() => setToolsOpen((v) => !v)}
            >
              {t("nav.tools")}
              <ChevronIcon open={toolsOpen} />
            </button>
            {toolsOpen ? (
              <div
                id={toolsId}
                role="menu"
                aria-label={t("nav.tools")}
                className="absolute left-0 top-full z-50 mt-1 min-w-[11rem] overflow-hidden rounded-lg border border-[var(--border)] bg-white py-1 shadow-md"
              >
                {TOOLS_NAV.map((item) => {
                  const active = isActive(item, pathname);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      role="menuitem"
                      aria-current={active ? "page" : undefined}
                      className={`block px-3 py-2 text-sm font-medium transition ${
                        active
                          ? "bg-[var(--primary-muted)] text-[var(--primary)]"
                          : "text-[var(--ui-color-body)] hover:bg-[var(--surface-2)]"
                      }`}
                      onClick={() => setToolsOpen(false)}
                    >
                      {t(item.labelKey)}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        </nav>

        <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2">
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
                {PRIMARY_NAV.map((item) => {
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
                <p className="border-t border-[var(--border)] px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-dim)]">
                  {t("nav.tools")}
                </p>
                {TOOLS_NAV.map((item) => {
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
    </header>
  );
}

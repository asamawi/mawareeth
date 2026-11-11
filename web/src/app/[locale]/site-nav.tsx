"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { locales, type Locale, type Messages } from "@/i18n/messages";
import { authLinks, pathForLocale, casesPath } from "@/i18n/paths";

import { useAuthState } from "./use-session";

const languageNames: Record<Locale, string> = {
  ar: "العربية",
  en: "English",
  fr: "Français",
};

const linkClass =
  "rounded px-1 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current";

export function SiteNav({ locale, nav }: { locale: Locale; nav: Messages["nav"] }) {
  const pathname = usePathname() ?? `/${locale}/`;
  const authenticated = useAuthState() === "authenticated";

  return (
    <nav
      aria-label={nav.label}
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-current/20 px-6 py-3"
    >
      <div className="flex flex-wrap items-center gap-4">
        {/* prefetch is off on every Link: the static export lays its prefetch files out in
            nested folders, so each prefetch would be a wasted request ending in a Django 404. */}
        <Link href={`/${locale}/`} prefetch={false} className={`${linkClass} font-semibold`}>
          {nav.home}
        </Link>
        <Link href={`/${locale}/interview/`} prefetch={false} className={linkClass}>
          {nav.interview}
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {authenticated && <Link href={casesPath(locale)} prefetch={false} className={linkClass}>{nav.cases}</Link>}
        {authLinks(authenticated, locale, pathname).map((link) => (
          // Django pages, outside this app and its basePath.
          <a key={link.kind} href={link.href} className={linkClass}>
            {nav[link.kind]}
          </a>
        ))}
        <ul aria-label={nav.language} className="flex items-center gap-3">
          {locales.map((target) => (
            <li key={target}>
              {target === locale ? (
                <span aria-current="true" lang={target} className="font-semibold">
                  {languageNames[target]}
                </span>
              ) : (
                <Link
                  href={pathForLocale(pathname, target)}
                  prefetch={false}
                  lang={target}
                  hrefLang={target}
                  className={linkClass}
                >
                  {languageNames[target]}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

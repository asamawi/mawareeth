"use client";

import { useState } from "react";
import { submitAuth } from "@/api/auth";
import { messages } from "@/i18n/messages";
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

  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  async function logout() {
    setLoggingOut(true);
    const result = await submitAuth("logout", locale, {});
    if (result && result.status === 200) window.location.assign(`/${locale}/`);
    else { setLoggingOut(false); setLogoutError(result?.status === 429 ? messages[locale].auth.throttled : messages[locale].auth.error); }
  }

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
        {authenticated && <a href={`/${locale}/password-change/`} className={linkClass}>{messages[locale].auth.change}</a>}
        {authenticated && <button className={linkClass} disabled={loggingOut} onClick={logout}>{loggingOut ? messages[locale].auth.pending : messages[locale].auth.logout}</button>}
        {logoutError && <p role="alert">{logoutError}</p>}
        {authLinks(authenticated, locale, pathname).map((link) => (
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

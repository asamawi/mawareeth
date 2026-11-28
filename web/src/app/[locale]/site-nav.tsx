"use client";

import { useEffect, useRef, useState } from "react";
import { submitAuth } from "@/api/auth";
import { messages } from "@/i18n/messages";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { localeConfig } from "@/i18n/catalog.generated";
import { locales, type Locale, type Messages } from "@/i18n/messages";
import { authLinks, pathForLocale, casesPath } from "@/i18n/paths";
import { autosave } from "@/interview/autosave";

import { useAuthState } from "./use-session";
import { buttonClass } from "./interview/form-bits";

const linkClass =
  "rounded px-1 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current";

export function SiteNav({ locale, nav }: { locale: Locale; nav: Messages["nav"] }) {
  const pathname = usePathname() ?? `/${locale}/`;
  const authenticated = useAuthState() === "authenticated";

  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  // The discard question of a sign-out whose pending save did not succeed.
  const [discarding, setDiscarding] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const safe = useRef<HTMLButtonElement>(null);
  const pressed = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!discarding || !dialog.current || dialog.current.open) return;
    dialog.current.showModal?.();
    safe.current?.focus();
  }, [discarding]);
  async function requestLogout(button: HTMLElement) {
    pressed.current = button;
    setLoggingOut(true);
    setLogoutError("");
    const outcome = await autosave.flush();
    if (outcome === "unsaved") { setLoggingOut(false); setDiscarding(true); return; }
    await logout();
  }
  function closeDiscard() {
    if (dialog.current?.open) dialog.current.close();
    setDiscarding(false);
    pressed.current?.focus();
  }
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
        {authenticated && <button className={linkClass} disabled={loggingOut} onClick={(event) => void requestLogout(event.currentTarget)}>{loggingOut ? messages[locale].auth.pending : messages[locale].auth.logout}</button>}
        {logoutError && <p role="alert">{logoutError}</p>}
        {discarding && (
          <dialog ref={dialog} aria-labelledby="signout-discard-title" aria-describedby="signout-discard-body" className="m-auto max-w-md rounded border bg-white p-6 text-black backdrop:bg-black/50" onCancel={(event) => { event.preventDefault(); closeDiscard(); }}>
            <h2 id="signout-discard-title" className="text-xl font-semibold">{messages[locale].cases.discardTitle}</h2>
            <p id="signout-discard-body" className="my-4">{messages[locale].cases.discardBody}</p>
            <div className="flex flex-wrap gap-3">
              <button type="button" ref={safe} className={buttonClass} onClick={closeDiscard}>{messages[locale].cases.discardNo}</button>
              <button type="button" className={buttonClass} onClick={() => { if (dialog.current?.open) dialog.current.close(); setDiscarding(false); void logout(); }}>{nav.discardAndSignOut}</button>
            </div>
          </dialog>
        )}
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
                  {localeConfig[target].ownName}
                </span>
              ) : (
                <Link
                  href={pathForLocale(pathname, target)}
                  prefetch={false}
                  lang={target}
                  hrefLang={target}
                  className={linkClass}
                >
                  {localeConfig[target].ownName}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

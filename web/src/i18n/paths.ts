import type { Locale } from "./messages.ts";

/** The current path with its locale segment swapped, so switching language keeps the page. */
/** Where Django's login page sends the visitor back to: this page, under the /app base path. */
export function loginHref(pathname: string): string {
  return `/accounts/login/?next=${encodeURIComponent(`/app${pathname}`)}`;
}

export type AuthLink = { kind: "login" | "signup"; href: string };

/** Signup and login stay available to everyone except a visitor known to be logged in. */
export function authLinks(authenticated: boolean, locale: Locale, pathname: string): AuthLink[] {
  if (authenticated) return [];
  return [
    { kind: "login", href: loginHref(pathname) },
    { kind: "signup", href: signupHref(locale, pathname) },
  ];
}

export function pathForLocale(pathname: string, target: Locale): string {
  const [, , ...rest] = pathname.split("/");
  const tail = rest.filter(Boolean).join("/");
  return tail ? `/${target}/${tail}/` : `/${target}/`;
}

export function signupHref(locale: string, pathname: string): string {
  return `/${locale}/signup/?next=${encodeURIComponent(`/app${pathname}`)}`;
}

export function resultsResumePath(locale: string, action: "save" | "share"): string {
  return `/${locale}/results/?resume=${action}`;
}

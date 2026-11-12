import type { Locale } from "./messages.ts";

/** Return to the current page under /app after authentication. */
export function loginHref(pathname: string): string {
  const locale = pathname.split("/")[1];
  return `/app/${["ar", "en", "fr"].includes(locale) ? locale : "en"}/login/?next=${encodeURIComponent(`/app${pathname}`)}`;
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
  return `/app/${locale}/signup/?next=${encodeURIComponent(`/app${pathname}`)}`;
}

export function resultsResumePath(locale: string, action: "save" | "share" | "whatsapp"): string {
  return `/${locale}/results/?resume=${action}`;
}

/** The wa.me link that opens WhatsApp with the message prefilled. */
export function whatsappHref(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

export function casesPath(locale: string): string { return `/${locale}/cases/`; }

export function sharedPath(locale: string): string { return `/${locale}/shared/`; }

/** The link an owner hands out. The token sits in the fragment, so it never reaches a server log or Referer. */
export function shareUrl(origin: string, locale: string, token: string): string {
  return `${origin}/app${sharedPath(locale)}#${token}`;
}

export function invitePath(locale: string): string { return `/${locale}/invite/`; }
export function receivedPath(locale: string, id: number): string { return `/${locale}/received/#${id}`; }

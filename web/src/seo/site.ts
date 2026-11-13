import type { Metadata } from "next";

import { locales, type Locale } from "../i18n/messages.ts";

/** The canonical origin of the site. */
export const SITE_URL = "https://www.mawareeth.com";

/** The only pages search engines may index; "" is the landing page. */
export const publicPages = ["", "about", "terms", "privacy"] as const;
export type PublicPage = (typeof publicPages)[number];

export function pagePath(locale: Locale, page: PublicPage): string {
  return page ? `/${locale}/${page}/` : `/${locale}/`;
}

export function canonicalUrl(locale: Locale, page: PublicPage): string {
  return `${SITE_URL}${pagePath(locale, page)}`;
}

/** One entry per language for hreflang; x-default is added where a page has one. */
export function languageAlternates(page: PublicPage): Record<Locale, string> {
  return Object.fromEntries(locales.map((locale) => [locale, canonicalUrl(locale, page)])) as Record<Locale, string>;
}

/** Every indexable page, in every language. */
export function publicUrls(): { locale: Locale; page: PublicPage; url: string }[] {
  return locales.flatMap((locale) => publicPages.map((page) => ({ locale, page, url: canonicalUrl(locale, page) })));
}

const openGraphLocale: Record<Locale, string> = { ar: "ar_AR", en: "en_US", fr: "fr_FR" };

/** Metadata of an indexable page: canonical, hreflang alternates and robots index. */
export function pageMetadata(locale: Locale, page: PublicPage, text: { title: string; description: string }): Metadata {
  const url = canonicalUrl(locale, page);
  return {
    title: text.title,
    description: text.description,
    robots: { index: true, follow: true },
    alternates: {
      canonical: url,
      languages: { ...languageAlternates(page), ...(page === "" ? { "x-default": `${SITE_URL}/` } : {}) },
    },
    openGraph: {
      type: "website",
      siteName: "Mawareeth",
      title: text.title,
      description: text.description,
      url,
      locale: openGraphLocale[locale],
      alternateLocale: locales.filter((other) => other !== locale).map((other) => openGraphLocale[other]),
    },
  };
}

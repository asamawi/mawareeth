import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { directionOf, isLocale, locales, messages } from "@/i18n/messages";

import { SITE_URL } from "@/seo/site";

import { SiteFooter } from "./site-footer";
import { SiteNav } from "./site-nav";

import "./globals.css";

export const dynamicParams = false;

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return {
    metadataBase: new URL(SITE_URL),
    title: isLocale(locale) ? messages[locale].title : undefined,
    // Private by default; the landing, about, terms and privacy pages opt in.
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }

  return (
    <html lang={locale} dir={directionOf(locale)}>
      <body className="flex min-h-screen flex-col">
        <SiteNav locale={locale} nav={messages[locale].nav} />
        <div className="flex-1">{children}</div>
        <SiteFooter locale={locale} footer={messages[locale].footer} />
      </body>
    </html>
  );
}

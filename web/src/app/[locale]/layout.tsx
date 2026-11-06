import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { directionOf, isLocale, locales, messages } from "@/i18n/messages";

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
    title: isLocale(locale) ? messages[locale].title : undefined,
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
      <body>
        <SiteNav locale={locale} nav={messages[locale].nav} />
        {children}
      </body>
    </html>
  );
}

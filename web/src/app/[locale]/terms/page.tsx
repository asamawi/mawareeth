import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isLocale } from "@/i18n/messages";
import { publicText } from "@/i18n/public-pages";
import { pageMetadata } from "@/seo/site";

import { LegalPage } from "../legal-page";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const text = publicText[locale].terms;
  return pageMetadata(locale, "terms", { title: text.title, description: text.metaDescription });
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const text = publicText[locale].terms;
  return <LegalPage title={text.title} blocks={text.blocks} />;
}

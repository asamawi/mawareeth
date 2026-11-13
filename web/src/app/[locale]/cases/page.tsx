import { notFound } from "next/navigation";
import { isLocale, messages } from "@/i18n/messages";
import { CasesView } from "./cases-view";
export default async function CasesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-10" dir={locale === "ar" ? "rtl" : "ltr"}><h1 className="text-3xl font-semibold">{messages[locale].cases.heading}</h1><CasesView locale={locale} text={messages[locale]} /></main>;
}

import { notFound } from "next/navigation";

import { isLocale, messages } from "@/i18n/messages";

import { ReceivedView } from "./received-view";

export default async function ReceivedPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const text = messages[locale];
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10" dir={locale === "ar" ? "rtl" : "ltr"}>
      <h1 className="mx-auto w-full max-w-xl text-3xl font-semibold">{text.invites.received}</h1>
      <ReceivedView messages={text} locale={locale} />
    </main>
  );
}

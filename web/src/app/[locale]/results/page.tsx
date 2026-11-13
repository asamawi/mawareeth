import { notFound } from "next/navigation";

import { isLocale, messages } from "@/i18n/messages";

import { ResultsView } from "./results-view";

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const text = messages[locale];

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10">
      <h1 className="mx-auto w-full max-w-xl text-3xl font-semibold">{text.results.heading}</h1>
      <noscript>
        {/* Without JavaScript the loading text would sit next to the explanation. */}
        <style>{"[data-js-only]{display:none}"}</style>
        <p className="mx-auto w-full max-w-xl">{text.interview.noscript}</p>
      </noscript>
      <ResultsView messages={text} locale={locale} />
    </main>
  );
}

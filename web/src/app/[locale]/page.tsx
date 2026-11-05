import { notFound } from "next/navigation";

import { isLocale, messages } from "@/i18n/messages";

import { SessionStatus } from "./session-status";

export default async function ShellPage({
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
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-4 px-6">
      <h1 className="text-3xl font-semibold">{text.title}</h1>
      <SessionStatus messages={text} />
    </main>
  );
}

import Link from "next/link";
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
    <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col justify-center gap-4 px-6">
      <h1 className="text-3xl font-semibold">{text.title}</h1>
      <SessionStatus messages={text} />
      <p>
        {/* No prefetch: the static export lays its prefetch files out where Django answers 404. */}
        <Link href={`/${locale}/interview/`} prefetch={false} className="underline underline-offset-4">
          {text.cta}
        </Link>
      </p>
    </main>
  );
}

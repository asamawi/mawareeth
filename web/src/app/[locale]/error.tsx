"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { directionOf, isLocale, messages, type Locale } from "@/i18n/messages";

import { reloadForChunkError } from "../chunk-recovery";
import { primaryButton, secondaryButton } from "./ui";

export default function LocaleError({ error }: { error: unknown; retry?: () => void }) {
  const first = (usePathname() ?? "").split("/")[1] ?? "";
  const locale: Locale = isLocale(first) ? first : "ar";
  const text = messages[locale].pageError;
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    console.error(error);
    if (reloadForChunkError(error)) return;
    heading.current?.focus();
  }, [error]);

  return (
    <main dir={directionOf(locale)} lang={locale} className="mx-auto w-full max-w-2xl px-6 py-12">
      <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold outline-none">
        {text.title}
      </h1>
      <p className="mt-4">{text.body}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" className={primaryButton} onClick={() => window.location.reload()}>
          {text.reload}
        </button>
        <a href={`/${locale}/interview/`} className={secondaryButton}>
          {text.interview}
        </a>
      </div>
    </main>
  );
}

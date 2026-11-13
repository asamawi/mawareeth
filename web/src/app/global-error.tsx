"use client";

import { useEffect, useRef } from "react";

import { directionOf, isLocale, messages, type Locale } from "@/i18n/messages";

import { reloadForChunkError } from "./chunk-recovery";

function localeFromPath(): Locale {
  const first = typeof window === "undefined" ? "" : (window.location.pathname.split("/")[1] ?? "");
  return isLocale(first) ? first : "ar";
}

const buttonStyle = {
  display: "inline-flex",
  minHeight: "2.75rem",
  alignItems: "center",
  padding: "0.5rem 1.5rem",
  border: "1px solid currentColor",
  borderRadius: "0.5rem",
  font: "inherit",
  fontWeight: 600,
  color: "inherit",
  background: "transparent",
  cursor: "pointer",
  textDecoration: "none",
} as const;

export default function GlobalError({ error }: { error: unknown; retry?: () => void }) {
  const locale = localeFromPath();
  const text = messages[locale].pageError;
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    console.error(error);
    if (reloadForChunkError(error)) return;
    heading.current?.focus();
  }, [error]);

  return (
    <html lang={locale} dir={directionOf(locale)}>
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0, padding: "3rem 1.5rem" }}>
        <main style={{ maxWidth: "42rem", margin: "0 auto" }}>
          <h1 ref={heading} tabIndex={-1} style={{ fontSize: "1.5rem", outline: "none" }}>
            {text.title}
          </h1>
          <p>{text.body}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", marginTop: "1.5rem" }}>
            <button type="button" style={buttonStyle} onClick={() => window.location.reload()}>
              {text.reload}
            </button>
            <a href={`/${locale}/interview/`} style={buttonStyle}>
              {text.interview}
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}

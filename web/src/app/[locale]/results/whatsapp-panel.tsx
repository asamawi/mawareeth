"use client";

import { useState } from "react";
import { isLocale, messages, type Messages } from "@/i18n/messages";
import { whatsappHref } from "@/i18n/paths";
import { buttonClass } from "../interview/form-bits";

/** Opens WhatsApp with the draft disclaimer and the private link. Runs in its own click, so popup blockers allow it. */
export function WhatsappPanel({ url, locale, text }: { url: string; locale: string; text: Messages["share"] }) {
  const [unavailable, setUnavailable] = useState(false);
  const banner = messages[isLocale(locale) ? locale : "en"].shared.banner;
  function open() {
    let opened: Window | null = null;
    try {
      opened = window.open(whatsappHref(`${banner}\n${url}`), "_blank");
    } catch {
      // Some embedded browsers forbid new windows; treat that like a blocked popup.
    }
    if (opened) {
      try { opened.opener = null; } catch { /* already detached */ }
      setUnavailable(false);
    } else {
      setUnavailable(true);
    }
  }
  return (
    <section className="flex flex-col gap-3 rounded-md border border-current/60 p-3" dir={locale === "ar" ? "rtl" : "ltr"}>
      <p role="status">{text.whatsappReady}</p>
      <button type="button" className={buttonClass} onClick={open}>{text.whatsappOpen}</button>
      <p role="alert">{unavailable ? text.whatsappUnavailable : ""}</p>
    </section>
  );
}

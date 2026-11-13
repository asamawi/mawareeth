"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { listShares, revokeShare, updateShare, type CreatedShare, type Share } from "@/api/shares";
import type { Messages } from "@/i18n/messages";
import { shareUrl } from "@/i18n/paths";
import { buttonClass } from "../interview/form-bits";

/** The new link (shown once, with Copy) and every active link of the saved case, with its visibility controls. */
export function SharePanel({ savedId, created, locale, text }: { savedId: number; created: CreatedShare; locale: string; text: Messages["share"] }) {
  const [rows, setRows] = useState<Share[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copy, setCopy] = useState<"idle" | "copied" | "failed">("idle");
  const [warning, setWarning] = useState<number | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const title = useId();
  // The new link and its Copy button go away once that link is revoked or has expired out of the list.
  const live = rows === null || rows.some((row) => row.id === created.id);
  const url = shareUrl(window.location.origin, locale, created.token);
  const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });

  const refresh = useCallback(async (signal: AbortSignal) => {
    try {
      const value = await listShares(signal, savedId);
      if (!signal.aborted) setRows(value);
    } catch {
      if (!signal.aborted) setError(true);
    }
  }, [savedId]);
  useEffect(() => {
    const controller = new AbortController();
    listShares(controller.signal, savedId).then(
      (value) => { if (!controller.signal.aborted) setRows(value); },
      () => { if (!controller.signal.aborted) setError(true); },
    );
    return () => controller.abort();
  }, [savedId]);
  useEffect(() => {
    if (warning !== null && !dialog.current?.open) dialog.current?.showModal();
  }, [warning]);

  async function act(run: () => Promise<boolean>) {
    if (busy) return;
    setBusy(true);
    setError(false);
    const ok = await run();
    if (ok) await refresh(new AbortController().signal);
    else setError(true);
    setBusy(false);
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopy("copied");
    } catch {
      setCopy("failed");
      field.current?.select();
    }
  }
  function confirmPublic() {
    const id = warning;
    dialog.current?.close();
    if (id !== null) void act(async () => (await updateShare(new AbortController().signal, id, "public", true)) !== null);
  }

  return (
    <section aria-labelledby={`${title}-h`} className="flex flex-col gap-3 rounded-md border border-current/60 p-3" dir={locale === "ar" ? "rtl" : "ltr"}>
      <h2 id={`${title}-h`} className="text-xl font-semibold">{text.heading}</h2>
      {live && <><p role="status">{text.created}</p>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={`${title}-url`} className="font-semibold">{text.urlLabel}</label>
        <input id={`${title}-url`} ref={field} readOnly dir="ltr" value={url} className="min-w-0 flex-1 rounded border px-2 py-1 text-black" onFocus={(event) => event.currentTarget.select()} />
        <button type="button" className={buttonClass} onClick={() => void copyLink()}>{text.copy}</button>
      </div>
      <p role="status">{copy === "copied" ? text.copied : copy === "failed" ? text.copyFailed : ""}</p></>}
      <h3 className="text-lg font-semibold">{text.listHeading}</h3>
      {rows !== null && rows.length === 0 && <p>{text.none}</p>}
      <ul className="flex flex-col gap-2">
        {(rows ?? []).map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-3">
            <strong>{row.visibility === "public" ? text.publicBadge : text.privateBadge}</strong>
            <span>{row.expired ? text.expired : `${text.expires} ${dateFormat.format(new Date(row.expires_at))}`}</span>
            {row.visibility === "private" ? (
              <button type="button" disabled={busy} className={buttonClass} onClick={(event) => { trigger.current = event.currentTarget; setWarning(row.id); }}>{text.makePublic}</button>
            ) : (
              <button type="button" disabled={busy} className={buttonClass} onClick={() => void act(async () => (await updateShare(new AbortController().signal, row.id, "private")) !== null)}>{text.makePrivate}</button>
            )}
            <button type="button" disabled={busy} className={buttonClass} onClick={() => void act(() => revokeShare(new AbortController().signal, row.id))}>{text.revoke}</button>
          </li>
        ))}
      </ul>
      <p role="alert">{error ? text.actionError : ""}</p>
      <dialog ref={dialog} aria-labelledby={title} className="m-auto max-w-md rounded border bg-white p-6 text-black backdrop:bg-black/50" dir={locale === "ar" ? "rtl" : "ltr"} onClose={() => { setWarning(null); trigger.current?.focus(); }}>
        <div className="flex flex-col gap-4">
          <h2 id={title} className="text-xl font-semibold">{text.warningTitle}</h2>
          <p>{text.warningBody}</p>
          <button type="button" autoFocus className={buttonClass} onClick={() => dialog.current?.close()}>{text.cancel}</button>
          <button type="button" className={buttonClass} onClick={confirmPublic}>{text.warningConfirm}</button>
        </div>
      </dialog>
    </section>
  );
}

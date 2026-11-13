"use client";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createInvite, listInvites, revokeInvite, type Invite } from "@/api/invites";
import { messages, isLocale } from "@/i18n/messages";
import { buttonClass } from "../interview/form-bits";

export function InvitePanel({ savedId, locale }: { savedId: number; locale: string }) {
  const text = messages[isLocale(locale) ? locale : "en"].invites;
  const id = useId();
  const [rows, setRows] = useState<Invite[]>([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"sent" | "error" | null>(null);
  const listRequest = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    listRequest.current?.abort();
    const controller = new AbortController();
    listRequest.current = controller;
    try {
      const rows = await listInvites(controller.signal, savedId);
      if (!controller.signal.aborted) setRows(rows);
    } catch {
      if (!controller.signal.aborted) setNotice("error");
    }
  }, [savedId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => { window.clearTimeout(timer); listRequest.current?.abort(); };
  }, [refresh]);
  async function send() {
    if (busy) return;
    setBusy(true); setNotice(null);
    const row = await createInvite(new AbortController().signal, savedId, email, locale);
    if (row) { setEmail(""); setNotice("sent"); await refresh(); }
    else setNotice("error");
    setBusy(false);
  }
  async function revoke(id: number) {
    if (busy) return;
    setBusy(true); setNotice(null);
    if (await revokeInvite(new AbortController().signal, id)) await refresh();
    else setNotice("error");
    setBusy(false);
  }
  return <section className="flex flex-col gap-3" aria-labelledby={`${id}-heading`}>
    <h3 id={`${id}-heading`} className="text-lg font-semibold">{text.list}</h3>
    <form className="flex flex-wrap items-center gap-3" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      <label htmlFor={id}>{text.email}</label>
      <input id={id} type="email" required maxLength={254} dir="ltr" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="min-w-0 rounded border px-2 py-1 text-black" />
      <button type="submit" disabled={busy} className={buttonClass}>{text.send}</button>
    </form>
    <p role={notice === "error" ? "alert" : "status"}>{notice ? text[notice] : ""}</p>
    <ul className="flex flex-col gap-2">{rows.map((row) => <li key={row.id} className="flex flex-wrap items-center gap-3">
      <bdi>{row.email}</bdi><strong>{text[row.status]}</strong><span>{text.expires} {new Date(row.expires_at).toLocaleDateString(locale)}</span>
      <button type="button" className={buttonClass} disabled={busy} onClick={() => void revoke(row.id)}>{text.revoke}</button>
    </li>)}</ul>
  </section>;
}

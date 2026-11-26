"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { fetchCase, hasUnsavedChanges, type Case } from "@/api/case";
import { listSavedCases, openSavedCase, OPEN_CONFLICT, type SavedCase } from "@/api/saved-cases";
import type { Messages } from "@/i18n/messages";
import { listReceived, type Received } from "@/api/invites";
import { casesPath, loginHref, receivedPath } from "@/i18n/paths";
import { useAuthState } from "../use-session";
import { buttonClass } from "../interview/form-bits";
export function CasesView({ locale, text }: { locale: string; text: Messages }) {
  const router = useRouter();
  const auth = useAuthState();
  const [rows, setRows] = useState<SavedCase[] | null>(null);
  const [received, setReceived] = useState<Received[] | null>(null);
  const [error, setError] = useState(false);
  const [opening, setOpening] = useState<number | null>(null);
  // The row waiting for the discard answer, and the working copy shown to the visitor (undefined: unreadable).
  const [prompt, setPrompt] = useState<{ id: number; current: Case | null | undefined } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const safe = useRef<HTMLButtonElement>(null);
  const pressed = useRef<HTMLElement | null>(null);
  const mounted = useRef(true);
  const refocus = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // After a failed open the Open button is enabled again: it takes the focus back.
  useEffect(() => {
    if (opening === null && refocus.current) {
      refocus.current = false;
      pressed.current?.focus();
    }
  }, [opening]);
  useEffect(() => {
    if (!prompt || !dialog.current || dialog.current.open) return;
    dialog.current.showModal?.();
    safe.current?.focus();
  }, [prompt]);
  useEffect(() => {
    if (auth !== "authenticated") return;
    const controller = new AbortController();
    listReceived(controller.signal).then(
      (value) => { if (!controller.signal.aborted) setReceived(value); },
      () => { if (!controller.signal.aborted) setError(true); },
    );
    listSavedCases(controller.signal).then(
      (value) => { if (!controller.signal.aborted) setRows(value); },
      () => { if (!controller.signal.aborted) setError(true); },
    );
    return () => controller.abort();
  }, [auth]);
  function closePrompt() {
    if (dialog.current?.open) dialog.current.close();
    setPrompt(null);
    pressed.current?.focus();
  }
  async function begin(id: number, conflicted = false) {
    setOpening(id);
    setError(false);
    let current: Case | null | undefined;
    try { current = await fetchCase(new AbortController().signal); } catch { current = undefined; }
    if (!mounted.current) return;
    // Unreadable state asks as well, and after a conflict it always asks again: never open on its own.
    if (conflicted || current === undefined || hasUnsavedChanges(current)) { setPrompt({ id, current }); setOpening(null); return; }
    await go(id, current);
  }
  async function go(id: number, current: Case | null | undefined) {
    if (!mounted.current) return;
    setOpening(id);
    const check = current === undefined ? undefined : { caseId: current?.id ?? null, revision: current?.revision ?? null };
    const result = await openSavedCase(new AbortController().signal, id, check ? { check } : {});
    if (!mounted.current) return;
    if (result === OPEN_CONFLICT) { setPrompt(null); await begin(id, true); return; }
    if (result) router.push(`/${locale}/interview/`);
    else { refocus.current = true; setError(true); setOpening(null); }
  }
  async function confirm() {
    if (!prompt) return;
    const { id, current } = prompt;
    if (dialog.current?.open) dialog.current.close();
    setPrompt(null);
    await go(id, current);
  }
  function open(id: number, button: HTMLElement) {
    pressed.current = button;
    void begin(id);
  }
  if (auth === "loading") return <p role="status">{text.checking}</p>;
  if (auth !== "authenticated") return (
    <p>
      {auth === "error" && <span role="alert">{text.unavailable} </span>}
      <a className={buttonClass} href={loginHref(casesPath(locale))}>{text.cases.signIn}</a>
    </p>
  );
  return (
    <>
      <p role="alert">{error ? text.cases.error : ""}</p>
      {!rows && !error && <p role="status">{text.checking}</p>}
      {rows?.length === 0 && <p>{text.cases.empty}</p>}
      <ul className="flex flex-col gap-4">
        {rows?.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-4 rounded border p-4">
            {row.name ? <span className="font-semibold"><bdi dir="auto">{row.name}</bdi></span> : null}
            <span id={`saved-${row.id}`}>{text.cases.updated}: {new Date(row.updated_at).toLocaleString(locale)}</span>
            <span>{row.madhab ? text.interview.madhabs[row.madhab].name : text.interview.schoolsAgree}</span>
            <span>{text.cases.heirs}: {row.heir_count}</span>
            <span>{row.status === "draft" ? text.cases.draft : row.status}</span>
            {/* Every row has an Open button; the date tells screen-reader users which case it opens. */}
            <button type="button" aria-describedby={`saved-${row.id}`} className={buttonClass} disabled={opening !== null} onClick={(event) => open(row.id, event.currentTarget)}>
              {text.cases.open}
            </button>
          </li>
        ))}
      </ul>
      <dialog ref={dialog} aria-labelledby="discard-title" aria-describedby="discard-body" className="m-auto max-w-md rounded border bg-white p-6 text-black backdrop:bg-black/50" onCancel={(event) => { event.preventDefault(); closePrompt(); }} onClose={() => { if (prompt && !dialog.current?.open) { setPrompt(null); pressed.current?.focus(); } }}>
        {prompt && (
          <>
            <h2 id="discard-title" className="text-xl font-semibold">{text.cases.discardTitle}</h2>
            <p id="discard-body" className="my-4">{text.cases.discardBody}</p>
            <div className="flex flex-wrap gap-3">
              <button type="button" ref={safe} className={buttonClass} onClick={closePrompt}>{text.cases.discardNo}</button>
              <button type="button" className={buttonClass} onClick={() => void confirm()}>{text.cases.discardYes}</button>
            </div>
          </>
        )}
      </dialog>
      <h2 className="text-xl font-semibold">{text.invites.received}</h2>
      {received?.length === 0 && <p>{text.invites.empty}</p>}
      <ul className="flex flex-col gap-4">{received?.map((row) => <li key={row.id} className="flex flex-wrap items-center gap-4 rounded border p-4">
        <span>{text.invites.owner}: <bdi>{row.owner}</bdi></span>
        <span>{text.cases.updated}: {new Date(row.updated_at).toLocaleString(locale)}</span>
        <span>{text.invites.expires}: {new Date(row.expires_at).toLocaleDateString(locale)}</span>
        <span>{text.cases.draft}</span><a href={receivedPath(locale, row.id)} className={buttonClass}>{text.invites.open}</a>
      </li>)}</ul>
    </>
  );
}

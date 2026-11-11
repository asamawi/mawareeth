"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { saveCase } from "@/api/saved-cases";
import type { Messages } from "@/i18n/messages";
import { loginHref, signupHref, resultsResumePath } from "@/i18n/paths";
import { buttonClass } from "../interview/form-bits";
import { useAuthState } from "../use-session";
import { authorizedAction, decide, parseResume, type Action } from "./auth-gate-state";

export function AuthGate({ locale, text, caseId }: { caseId: string; locale: string; text: Messages["results"] }) {
  const auth = useAuthState();
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const saving = useRef(false);
  const runSave = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    setSaveState("saving");
    const result = await saveCase(new AbortController().signal, caseId);
    setSaveState(result ? "saved" : "error");
    saving.current = false;
  }, [caseId]);
  const [action, setAction] = useState<Action | null>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const [notice, setNotice] = useState<Action | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const save = useRef<HTMLButtonElement>(null);
  const share = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const title = useId();
  const resume = useRef<Action | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const parsed = parseResume(url.search);
    if (parsed.action) resume.current = parsed.action;
    if (url.searchParams.has("resume")) {
      window.history.replaceState(window.history.state, "", url.pathname + parsed.search + url.hash);
    }
    const timer = window.setTimeout(() => { if (resume.current) setPending(resume.current); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!pending || auth === "loading") return;
    const timer = window.setTimeout(() => {
      trigger.current = pending === "save" ? save.current : share.current;
      const decision = authorizedAction(auth, pending);
      if (decision === "save") void runSave();
      else if (decision === "notice") setNotice(pending);
      else setAction(pending);
      setPending(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [auth, pending, runSave]);

  useEffect(() => {
    if (action) dialog.current?.showModal();
  }, [action]);

  useEffect(() => {
    // Closing fires onClose, which completes the interrupted action.
    if (decide(auth) === "notice" && action) dialog.current?.close();
  }, [auth, action]);

  function activate(value: Action, button: HTMLButtonElement) {
    trigger.current = button;
    setNotice(null);
    if (value === "share") setSaveState("idle");
    const decision = authorizedAction(auth, value);
    if (decision === "save") void runSave();
    else if (decision === "notice") setNotice(value);
    else setAction(value);
  }

  const path = resultsResumePath(locale, action ?? "save");
  return (
    <div className="flex flex-col gap-3" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="flex flex-wrap gap-3">
        <button ref={save} disabled={saveState === "saving"} type="button" className={buttonClass} onClick={(event) => activate("save", event.currentTarget)}>{saveState === "saving" ? text.saving : text.save}</button>
        <button ref={share} type="button" className={buttonClass} onClick={(event) => activate("share", event.currentTarget)}>{text.shareAction}</button>
      </div>
      <p role="status">{saveState === "error" ? text.saveError : saveState === "saved" ? text.saved : notice === "share" ? text.shareSoon : ""}</p>
      <dialog ref={dialog} aria-labelledby={title} className="m-auto max-w-md rounded border bg-white p-6 text-black backdrop:bg-black/50" onClose={() => { if (action && decide(auth) === "notice") { if (action === "save") void runSave(); else setNotice(action); } setAction(null); trigger.current?.focus(); }}>
        <div className="flex flex-col gap-4">
          <h2 id={title} className="text-xl font-semibold">{text.authTitle}</h2>
          <a autoFocus className={buttonClass} href={loginHref(path)}>{text.signIn}</a>
          <a className={buttonClass} href={signupHref(locale, path)}>{text.createAccount}</a>
          <button type="button" className={buttonClass} onClick={() => dialog.current?.close()}>{text.close}</button>
        </div>
      </dialog>
    </div>
  );
}

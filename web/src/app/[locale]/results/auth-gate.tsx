"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { NAME_INVALID, NAME_TOO_LONG, SAVE_CONFLICT, SCHOOL_REQUIRED, saveCase } from "@/api/saved-cases";
import { createShare, type CreatedShare } from "@/api/shares";
import type { Messages } from "@/i18n/messages";
import { loginHref, signupHref, resultsResumePath, shareUrl } from "@/i18n/paths";
import { buttonClass } from "../interview/form-bits";
import { useAuthState } from "../use-session";
import { authorizedAction, decide, parseResume, type Action } from "./auth-gate-state";
import { InvitePanel } from "./invite-panel";
import { NameDialog } from "./name-dialog";
import { WhatsappPanel } from "./whatsapp-panel";
import { SharePanel } from "./share-panel";
import { directionOf } from "@/i18n/messages";

/** `linked`: the case already has a Saved case, so Save does not ask for a name. */
export function AuthGate({ locale, text, share: shareText, caseId, linked = false, onSchoolRequired }: { caseId: string; locale: string; text: Messages["results"]; share: Messages["share"]; linked?: boolean; onSchoolRequired?: () => void }) {
  const auth = useAuthState();
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error" | "school" | "conflict">("idle");
  const [savedId, setSavedId] = useState<number | null>(null);
  const saving = useRef(false);
  const [naming, setNaming] = useState(false);
  // What the visitor typed in the naming dialog: kept across a failed save, so Retry and the next Save reuse it.
  const [typedName, setTypedName] = useState<string | null>(null);
  // The server refused the typed name: the dialog reopens with it and says why.
  const [nameError, setNameError] = useState<string | null>(null);
  // Exactly the arguments of the save that failed, so Retry resends that request and nothing else.
  const [retry, setRetry] = useState<{ name?: string } | null>(null);
  const save = useRef<HTMLButtonElement>(null);
  const runSave = useCallback(async (name?: string) => {
    if (saving.current) return;
    saving.current = true;
    setSaveState("saving");
    setRetry(null);
    const result = await saveCase(new AbortController().signal, caseId, { locale, ...(name === undefined ? {} : { name }) });
    if (result === NAME_TOO_LONG || result === NAME_INVALID) {
      setNameError(result === NAME_TOO_LONG ? text.nameTooLong : text.nameInvalid);
      setTypedName(name ?? null);
      setSaveState("idle");
      setNaming(true);
    } else if (result === SCHOOL_REQUIRED) {
      setSaveState("school");
      onSchoolRequired?.();
    } else if (result === SAVE_CONFLICT) {
      setSaveState("conflict");
    } else {
      if (result) setSavedId(result.id);
      setSaveState(result ? "saved" : "error");
      if (!result) setRetry({ name });
    }
    saving.current = false;
    // The disabled Save button cannot keep focus while saving; give it back once the save has settled.
    window.setTimeout(() => { if (document.activeElement === document.body || document.activeElement === null) save.current?.focus(); }, 0);
  }, [caseId, locale, text.nameTooLong, text.nameInvalid, onSchoolRequired]);
  // Only a first save asks for a name; a linked or already saved case keeps its own.
  const startSave = useCallback(() => {
    if (!linked && savedId === null) setNaming(true);
    else void runSave();
  }, [linked, savedId, runSave]);
  const [shareState, setShareState] = useState<{ status: "creating" | "error" } | { status: "ready"; savedId: number; created: CreatedShare; via: "share" | "whatsapp" } | null>(null);
  const runShare = useCallback(async (via: "share" | "whatsapp" = "share") => {
    // One guard for every action that saves, so Save and Share never write at the same time.
    if (saving.current) return;
    saving.current = true;
    setShareState({ status: "creating" });
    const signal = new AbortController().signal;
    const saved = await saveCase(signal, caseId, { locale });
    if (saved === SCHOOL_REQUIRED || saved === SAVE_CONFLICT) {
      setShareState(null);
      setSaveState(saved === SCHOOL_REQUIRED ? "school" : "conflict");
      if (saved === SCHOOL_REQUIRED) onSchoolRequired?.();
      saving.current = false;
      return;
    }
    const savedCase = typeof saved === "object" && saved !== null ? saved : null;
    if (savedCase) setSavedId(savedCase.id);
    const created = savedCase ? await createShare(signal, savedCase.id) : null;
    setShareState(savedCase && created ? { status: "ready", savedId: savedCase.id, created, via } : { status: "error" });
    saving.current = false;
  }, [caseId, locale, onSchoolRequired]);
  const [action, setAction] = useState<Action | null>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const share = useRef<HTMLButtonElement>(null);
  const whatsapp = useRef<HTMLButtonElement>(null);
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
      trigger.current = pending === "save" ? save.current : pending === "whatsapp" ? whatsapp.current : share.current;
      const decision = authorizedAction(auth, pending);
      if (decision === "save") startSave();
      else if (decision === "share" || decision === "whatsapp") void runShare(decision);
      else setAction(pending);
      setPending(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [auth, pending, startSave, runShare]);

  useEffect(() => {
    if (action) dialog.current?.showModal();
  }, [action]);

  useEffect(() => {
    // Closing fires onClose, which completes the interrupted action.
    if (decide(auth) === "notice" && action) dialog.current?.close();
  }, [auth, action]);

  function activate(value: Action, button: HTMLButtonElement) {
    trigger.current = button;
    if (value !== "save") setSaveState("idle");
    const decision = authorizedAction(auth, value);
    if (decision === "save") startSave();
    else if (decision === "share" || decision === "whatsapp") void runShare(decision);
    else setAction(value);
  }

  const path = resultsResumePath(locale, action ?? "save");
  return (
    <div className="flex flex-col gap-3" dir={directionOf(locale)}>
      <div className="flex flex-wrap gap-3">
        <button ref={save} disabled={saveState === "saving" || shareState?.status === "creating"} type="button" className={buttonClass} onClick={(event) => activate("save", event.currentTarget)}>{saveState === "saving" ? text.saving : text.save}</button>
        <button ref={share} type="button" disabled={shareState?.status === "creating" || saveState === "saving"} className={buttonClass} onClick={(event) => activate("share", event.currentTarget)}>{text.shareAction}</button>
        <button ref={whatsapp} type="button" disabled={shareState?.status === "creating" || saveState === "saving"} className={buttonClass} onClick={(event) => activate("whatsapp", event.currentTarget)}>{text.whatsappAction}</button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <p role="status" className="text-sm text-muted">{saveState === "saving" ? text.saving : saveState === "error" ? text.saveError : saveState === "conflict" ? text.saveConflict : saveState === "school" ? text.saveNeedsSchool : saveState === "saved" ? text.saved : ""}</p>
        {saveState === "error" && retry && <button type="button" className={buttonClass} onClick={() => void runSave(retry.name)}>{text.saveRetry}</button>}
      </div>
      {naming && <NameDialog locale={locale} text={text} initial={typedName} error={nameError} onCancel={() => { setNaming(false); setNameError(null); save.current?.focus(); }} onSubmit={(name) => { setTypedName(name); setNameError(null); setNaming(false); void runSave(name); }} />}
      {shareState?.status === "creating" && <p role="status">{shareText.preparing}</p>}
      {shareState?.status === "error" && <p role="alert">{shareText.createError}</p>}
      {shareState?.status === "ready" && <SharePanel key={shareState.created.id} savedId={shareState.savedId} created={shareState.created} locale={locale} text={shareText} />}
      {shareState?.status === "ready" && shareState.via === "whatsapp" && <WhatsappPanel key={`wa-${shareState.created.id}`} url={shareUrl(window.location.origin, locale, shareState.created.token)} locale={locale} text={shareText} />}
      {savedId !== null && <InvitePanel key={savedId} savedId={savedId} locale={locale} />}
      <dialog ref={dialog} aria-labelledby={title} className="m-auto max-w-md rounded border bg-white p-6 text-black backdrop:bg-black/50" onClose={() => { if (action && decide(auth) === "notice") { if (action === "save") startSave(); else void runShare(action); } setAction(null); trigger.current?.focus(); }}>
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

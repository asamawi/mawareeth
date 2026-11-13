"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { SCHOOL_REQUIRED, saveCase } from "@/api/saved-cases";
import { createShare, type CreatedShare } from "@/api/shares";
import type { Messages } from "@/i18n/messages";
import { loginHref, signupHref, resultsResumePath, shareUrl } from "@/i18n/paths";
import { buttonClass } from "../interview/form-bits";
import { useAuthState } from "../use-session";
import { authorizedAction, decide, parseResume, type Action } from "./auth-gate-state";
import { InvitePanel } from "./invite-panel";
import { WhatsappPanel } from "./whatsapp-panel";
import { SharePanel } from "./share-panel";

export function AuthGate({ locale, text, share: shareText, caseId, onSchoolRequired }: { caseId: string; locale: string; text: Messages["results"]; share: Messages["share"]; onSchoolRequired?: () => void }) {
  const auth = useAuthState();
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error" | "school">("idle");
  const [savedId, setSavedId] = useState<number | null>(null);
  const saving = useRef(false);
  const runSave = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    setSaveState("saving");
    const result = await saveCase(new AbortController().signal, caseId);
    if (result === SCHOOL_REQUIRED) {
      setSaveState("school");
      onSchoolRequired?.();
    } else {
      if (result) setSavedId(result.id);
      setSaveState(result ? "saved" : "error");
    }
    saving.current = false;
  }, [caseId, onSchoolRequired]);
  const [shareState, setShareState] = useState<{ status: "creating" | "error" } | { status: "ready"; savedId: number; created: CreatedShare; via: "share" | "whatsapp" } | null>(null);
  const sharing = useRef(false);
  const runShare = useCallback(async (via: "share" | "whatsapp" = "share") => {
    if (sharing.current) return;
    sharing.current = true;
    setShareState({ status: "creating" });
    const signal = new AbortController().signal;
    const saved = await saveCase(signal, caseId);
    if (saved === SCHOOL_REQUIRED) {
      setShareState(null);
      setSaveState("school");
      onSchoolRequired?.();
      sharing.current = false;
      return;
    }
    const savedCase = saved;
    if (savedCase) setSavedId(savedCase.id);
    const created = savedCase ? await createShare(signal, savedCase.id) : null;
    setShareState(savedCase && created ? { status: "ready", savedId: savedCase.id, created, via } : { status: "error" });
    sharing.current = false;
  }, [caseId, onSchoolRequired]);
  const [action, setAction] = useState<Action | null>(null);
  const [pending, setPending] = useState<Action | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const save = useRef<HTMLButtonElement>(null);
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
      if (decision === "save") void runSave();
      else if (decision === "share" || decision === "whatsapp") void runShare(decision);
      else setAction(pending);
      setPending(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [auth, pending, runSave, runShare]);

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
    if (decision === "save") void runSave();
    else if (decision === "share" || decision === "whatsapp") void runShare(decision);
    else setAction(value);
  }

  const path = resultsResumePath(locale, action ?? "save");
  return (
    <div className="flex flex-col gap-3" dir={locale === "ar" ? "rtl" : "ltr"}>
      <div className="flex flex-wrap gap-3">
        <button ref={save} disabled={saveState === "saving"} type="button" className={buttonClass} onClick={(event) => activate("save", event.currentTarget)}>{saveState === "saving" ? text.saving : text.save}</button>
        <button ref={share} type="button" disabled={shareState?.status === "creating"} className={buttonClass} onClick={(event) => activate("share", event.currentTarget)}>{text.shareAction}</button>
        <button ref={whatsapp} type="button" disabled={shareState?.status === "creating"} className={buttonClass} onClick={(event) => activate("whatsapp", event.currentTarget)}>{text.whatsappAction}</button>
      </div>
      <p role="status">{saveState === "error" ? text.saveError : saveState === "school" ? text.saveNeedsSchool : saveState === "saved" ? text.saved : ""}</p>
      {shareState?.status === "creating" && <p role="status">{shareText.preparing}</p>}
      {shareState?.status === "error" && <p role="alert">{shareText.createError}</p>}
      {shareState?.status === "ready" && <SharePanel key={shareState.created.id} savedId={shareState.savedId} created={shareState.created} locale={locale} text={shareText} />}
      {shareState?.status === "ready" && shareState.via === "whatsapp" && <WhatsappPanel key={`wa-${shareState.created.id}`} url={shareUrl(window.location.origin, locale, shareState.created.token)} locale={locale} text={shareText} />}
      {savedId !== null && <InvitePanel key={savedId} savedId={savedId} locale={locale} />}
      <dialog ref={dialog} aria-labelledby={title} className="m-auto max-w-md rounded border bg-white p-6 text-black backdrop:bg-black/50" onClose={() => { if (action && decide(auth) === "notice") { if (action === "save") void runSave(); else void runShare(action); } setAction(null); trigger.current?.focus(); }}>
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

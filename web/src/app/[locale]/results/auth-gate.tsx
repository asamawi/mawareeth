"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { NAME_INVALID, NAME_LIMIT, NAME_TOO_LONG, SAVE_CONFLICT, SCHOOL_REQUIRED, createSavedCase, cutGraphemes, graphemeCount, openSavedCase, saveCase, type SaveConflict } from "@/api/saved-cases";
import { createShare, type CreatedShare } from "@/api/shares";
import { autosave } from "@/interview/autosave";
import type { Messages } from "@/i18n/messages";
import { loginHref, signupHref, resultsResumePath, shareUrl } from "@/i18n/paths";
import { buttonClass } from "../interview/form-bits";
import { useAuthState } from "../use-session";
import { authorizedAction, decide, newestLine, nextSeq, parseResume, type Action } from "./auth-gate-state";
import { InvitePanel } from "./invite-panel";
import { NameDialog } from "./name-dialog";
import { WhatsappPanel } from "./whatsapp-panel";
import { SharePanel } from "./share-panel";
import { directionOf } from "@/i18n/messages";

/** The save conflict prompt after Save, Share or WhatsApp: what the visitor was shown, and which action it interrupted. */
type Conflict = { data: SaveConflict; source: Action };
/** Exactly the arguments of the choice that failed, so Retry resends that request and nothing else. */
type Choice = { kind: "open"; data: SaveConflict } | { kind: "create"; data: SaveConflict; name: string; key: string };
const isConflict = (value: unknown): value is SaveConflict => typeof value === "object" && value !== null && (value as { code?: unknown }).code === SAVE_CONFLICT;

/**
 * `linked`: the case already has a Saved case, so Save does not ask for a name.
 * `onReplaced`: the working copy was replaced by the stored version, so the page must load it again.
 */
export function AuthGate({ locale, text, share: shareText, caseId, linked = false, onSchoolRequired, onReplaced, pdf }: { caseId: string; locale: string; text: Messages["results"]; share: Messages["share"]; linked?: boolean; onSchoolRequired?: () => void; onReplaced?: () => void; pdf?: { text: string | null; seq: number } }) {
  const auth = useAuthState();
  const [saveState, setSaveStateRaw] = useState<"idle" | "saving" | "saved" | "error" | "school" | "conflict">("idle");
  // Every save, share, copy and PDF event is numbered; the one status line shows the newest event's message.
  const [saveSeq, setSaveSeq] = useState(0);
  const [note, setNote] = useState<{ text: string; seq: number } | null>(null);
  const setSaveState = useCallback((value: "idle" | "saving" | "saved" | "error" | "school" | "conflict") => { setSaveStateRaw(value); setSaveSeq(nextSeq()); }, []);
  const say = useCallback((text: string) => setNote({ text, seq: nextSeq() }), []);
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
  // The conflict prompt: null without a conflict, and for a conflict that offers no choice (text only).
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [busy, setBusyRaw] = useState<Choice["kind"] | null>(null);
  const [choiceError, setChoiceErrorRaw] = useState<Choice | null>(null);
  const setBusy = useCallback((value: Choice["kind"] | null) => { setBusyRaw(value); setSaveSeq(nextSeq()); }, []);
  const setChoiceError = useCallback((value: Choice | null) => { setChoiceErrorRaw(value); setSaveSeq(nextSeq()); }, []);
  // Naming the copy: where the field starts (null: the server's suggestion) and why the server refused the last name.
  const [copying, setCopying] = useState<{ initial: string | null; error: string | null } | null>(null);
  const openLatest = useRef<HTMLButtonElement>(null);
  const saveAsNew = useRef<HTMLButtonElement>(null);
  const runSave = useCallback(async (name?: string) => {
    if (saving.current) return;
    saving.current = true;
    setSaveState("saving");
    setRetry(null);
    // A pending autosave is sent (or fails) first, so two writes never race.
    await autosave.flush();
    const result = await saveCase(new AbortController().signal, caseId, { locale, ...(name === undefined ? {} : { name }) });
    if (result === NAME_TOO_LONG || result === NAME_INVALID) {
      setNameError(result === NAME_TOO_LONG ? text.nameTooLong : text.nameInvalid);
      setTypedName(name ?? null);
      setSaveState("idle");
      setNaming(true);
    } else if (result === SCHOOL_REQUIRED) {
      setSaveState("school");
      onSchoolRequired?.();
    } else if (isConflict(result)) {
      setSaveState("conflict");
      setConflict({ data: result, source: "save" });
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
  }, [caseId, locale, text.nameTooLong, text.nameInvalid, onSchoolRequired, setSaveState]);
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
    say(shareText.preparing);
    const signal = new AbortController().signal;
    await autosave.flush();
    const saved = await saveCase(signal, caseId, { locale });
    if (saved === SCHOOL_REQUIRED || saved === SAVE_CONFLICT || isConflict(saved)) {
      setShareState(null);
      setSaveState(saved === SCHOOL_REQUIRED ? "school" : "conflict");
      if (isConflict(saved)) setConflict({ data: saved, source: via });
      if (saved === SCHOOL_REQUIRED) onSchoolRequired?.();
      saving.current = false;
      return;
    }
    const savedCase = typeof saved === "object" && saved !== null && !isConflict(saved) ? saved : null;
    if (savedCase) setSavedId(savedCase.id);
    const created = savedCase ? await createShare(signal, savedCase.id) : null;
    setShareState(savedCase && created ? { status: "ready", savedId: savedCase.id, created, via } : { status: "error" });
    if (!(savedCase && created)) say(shareText.createError);
    saving.current = false;
  }, [caseId, locale, onSchoolRequired, say, setSaveState, shareText.preparing, shareText.createError]);
  // The two choices share the guard of Save, Share and WhatsApp, so two presses send one request.
  const showAgain = useCallback((next: Conflict | null, failed: Choice | null, focus: { current: HTMLButtonElement | null }) => {
    setConflict(next);
    setChoiceError(failed);
    setBusy(null);
    saving.current = false;
    if (next) window.setTimeout(() => focus.current?.focus(), 0);
  }, [setBusy, setChoiceError]);
  const replaced = useCallback(() => {
    setConflict(null);
    setChoiceError(null);
    setBusy(null);
    setSaveState("idle");
    saving.current = false;
    onReplaced?.();
  }, [onReplaced, setBusy, setChoiceError, setSaveState]);
  const runOpen = useCallback(async (current: Conflict) => {
    if (saving.current) return;
    saving.current = true;
    setBusy("open");
    setChoiceError(null);
    const { data } = current;
    const result = await openSavedCase(new AbortController().signal, data.savedId, { check: { caseId: data.workingCaseId, revision: data.workingRevision }, returnStale: true });
    if (result && typeof result === "object" && "kind" in result) {
      // The working copy changed since the prompt: nothing was replaced; ask again about the copy as it is now.
      // Another working Case (or none) is not what the prompt was about: leave it and show what is there.
      // Same Case: no reload here, since reloading remounts this gate and would drop the prompt.
      if (result.case && result.case.id === data.workingCaseId && result.case.revision !== null) {
        showAgain({ ...current, data: { ...data, workingRevision: result.case.revision } }, null, openLatest);
      } else replaced();
    } else if (result && typeof result === "object") {
      replaced();
    } else {
      showAgain(current, { kind: "open", data }, openLatest);
    }
  }, [showAgain, replaced, setBusy, setChoiceError]);
  const runCreate = useCallback(async (current: Conflict, name: string, key: string) => {
    if (saving.current) return;
    saving.current = true;
    setBusy("create");
    setChoiceError(null);
    const { data } = current;
    const signal = new AbortController().signal;
    const result = await createSavedCase(signal, { caseId: data.workingCaseId, expectedRevision: data.workingRevision, savedId: data.savedId, savedRevision: data.savedRevision, requestKey: key, name, locale });
    if (result === NAME_TOO_LONG || result === NAME_INVALID) {
      setCopying({ initial: name, error: result === NAME_TOO_LONG ? text.nameTooLong : text.nameInvalid });
      showAgain(current, null, saveAsNew);
      saving.current = true;
    } else if (result === SCHOOL_REQUIRED) {
      showAgain(null, null, saveAsNew);
      setSaveState("school");
      onSchoolRequired?.();
    } else if (result && "stale" in result) {
      // The stored case or the working copy changed since the prompt: nothing was written.
      if (result.stale && result.case?.id === data.workingCaseId) {
        showAgain({ ...current, data: result.stale }, null, saveAsNew);
      } else replaced();
    } else if (result) {
      setSavedId(result.id);
      setSaveState("saved");
      setConflict(null);
      setBusy(null);
      // A panel left from an earlier share still holds the original case's link.
      setShareState(null);
      if (current.source === "save") {
        saving.current = false;
        return;
      }
      // An interrupted Share or WhatsApp continues with the new case.
      setShareState({ status: "creating" });
      say(shareText.preparing);
      const created = await createShare(signal, result.id);
      setShareState(created ? { status: "ready", savedId: result.id, created, via: current.source === "whatsapp" ? "whatsapp" : "share" } : { status: "error" });
      if (!created) say(shareText.createError);
      saving.current = false;
    } else {
      showAgain(current, { kind: "create", data, name, key }, saveAsNew);
    }
  }, [locale, text.nameTooLong, text.nameInvalid, onSchoolRequired, showAgain, replaced, say, setBusy, setChoiceError, setSaveState, shareText.preparing, shareText.createError]);
  function chooseCreate(current: Conflict) {
    if (saving.current) return;
    // The guard stays set while the visitor names the copy; Cancel clears it.
    saving.current = true;
    setChoiceError(null);
    const old = current.data.savedName.trim();
    const [before, after = ""] = text.copyName.split("{name}");
    const room = Math.max(NAME_LIMIT - graphemeCount(before + after, locale), 0);
    setCopying({ initial: old === "" ? null : before + cutGraphemes(old, room, locale) + after, error: null });
  }
  function retryChoice(failed: Choice) {
    if (!conflict) return;
    if (failed.kind === "open") void runOpen({ ...conflict, data: failed.data });
    else void runCreate({ ...conflict, data: failed.data }, failed.name, failed.key);
  }
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

  const saveLine = busy ? text.conflictBusy : choiceError ? (choiceError.kind === "open" ? text.conflictOpenFailed : text.conflictCreateFailed) : saveState === "saving" ? text.saving : saveState === "error" ? text.saveError : saveState === "conflict" ? text.saveConflict : saveState === "school" ? text.saveNeedsSchool : saveState === "saved" ? text.saved : "";
  const path = resultsResumePath(locale, action ?? "save");
  return (
    <div className="flex flex-col gap-3" dir={directionOf(locale)}>
      <div className="flex flex-wrap gap-3">
        <button ref={save} disabled={saveState === "saving" || shareState?.status === "creating" || conflict !== null || busy !== null} type="button" className={buttonClass} onClick={(event) => activate("save", event.currentTarget)}>{saveState === "saving" ? text.saving : text.save}</button>
        <button ref={share} type="button" disabled={shareState?.status === "creating" || saveState === "saving" || conflict !== null || busy !== null} className={buttonClass} onClick={(event) => activate("share", event.currentTarget)}>{text.shareAction}</button>
        <button ref={whatsapp} type="button" disabled={shareState?.status === "creating" || saveState === "saving" || conflict !== null || busy !== null} className={buttonClass} onClick={(event) => activate("whatsapp", event.currentTarget)}>{text.whatsappAction}</button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <p role="status" aria-live="polite" className="text-sm text-muted">{newestLine([{ text: saveLine, seq: saveSeq }, note, pdf ?? null])}</p>
        {saveState === "error" && retry && <button type="button" className={buttonClass} onClick={() => void runSave(retry.name)}>{text.saveRetry}</button>}
        {choiceError && !busy && <button type="button" className={buttonClass} onClick={() => retryChoice(choiceError)}>{text.saveRetry}</button>}
      </div>
      {conflict && (
        <div className="flex flex-wrap gap-3" role="group" aria-label={text.saveConflict}>
          <button ref={openLatest} type="button" disabled={busy !== null} className={buttonClass} onClick={() => void runOpen(conflict)}>{text.conflictOpenLatest}</button>
          <button ref={saveAsNew} type="button" disabled={busy !== null} className={buttonClass} onClick={() => chooseCreate(conflict)}>{text.conflictSaveAsNew}</button>
        </div>
      )}
      {conflict && copying && <NameDialog locale={locale} text={text} initial={copying.initial} error={copying.error} onCancel={() => { setCopying(null); saving.current = false; saveAsNew.current?.focus(); }} onSubmit={(name) => { setCopying(null); saving.current = false; void runCreate(conflict, name, globalThis.crypto.randomUUID()); }} />}
      {naming && <NameDialog locale={locale} text={text} initial={typedName} error={nameError} onCancel={() => { setNaming(false); setNameError(null); save.current?.focus(); }} onSubmit={(name) => { setTypedName(name); setNameError(null); setNaming(false); void runSave(name); }} />}
      {shareState?.status === "ready" && <SharePanel key={shareState.created.id} savedId={shareState.savedId} created={shareState.created} locale={locale} text={shareText} onStatus={(event) => say(event === "created" ? shareText.created : event === "copied" ? shareText.copied : event === "cleared" ? "" : shareText.copyFailed)} />}
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

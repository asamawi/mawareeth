"use client";

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";

import { NAME_INVALID, NAME_LIMIT, NAME_TOO_LONG, SCHOOL_REQUIRED, createSavedCase, cutGraphemes, graphemeCount, openSavedCase, type SaveConflict } from "@/api/saved-cases";
import { autosave } from "@/interview/autosave";
import { directionOf, type Messages } from "@/i18n/messages";
import { loginHref, signupHref } from "@/i18n/paths";
import { NameDialog } from "../results/name-dialog";
import { buttonClass } from "./form-bits";

const AUTOSAVE_RESUME_KEY = "mawareeth.autosave.resume";

/** The arguments of the choice that failed, so Retry resends that request and nothing else. */
type Choice = { kind: "open" } | { kind: "create"; name: string; key: string };

/**
 * The two choices after a save conflict: "Open latest version" or "Save as a new case". Nothing is merged or
 * overwritten and nothing is discarded until one is chosen. Both act on the working copy as it is at click
 * time, so editing may continue while the conflict is showing.
 */
export function ConflictChoices({ locale, text, conflict, getWorking, onReplaced, onResolved, onSchoolRequired }: {
  locale: string;
  text: Messages["results"];
  conflict: SaveConflict;
  /** The working Case now: its id and newest accepted revision. */
  getWorking: () => { caseId: string; revision: number } | null;
  /** The stored version replaced the working copy: the page must load it again. */
  onReplaced: () => void;
  /** The working copy was saved as a new Saved case and is linked to it at `revision`. */
  onResolved: (revision: number) => void;
  onSchoolRequired: () => void;
}) {
  const [current, setCurrent] = useState(conflict);
  const [busy, setBusy] = useState<Choice["kind"] | null>(null);
  const [failed, setFailed] = useState<Choice | null>(null);
  const [copying, setCopying] = useState<{ initial: string | null; error: string | null } | null>(null);
  const guard = useRef(false);
  const openLatest = useRef<HTMLButtonElement>(null);
  const saveAsNew = useRef<HTMLButtonElement>(null);

  const runOpen = useCallback(async () => {
    if (guard.current) return;
    guard.current = true;
    setBusy("open");
    setFailed(null);
    const working = getWorking();
    const result = await openSavedCase(new AbortController().signal, current.savedId, {
      check: { caseId: current.workingCaseId, revision: working?.revision ?? current.workingRevision }, returnStale: true });
    guard.current = false;
    setBusy(null);
    if (result && typeof result === "object" && "kind" in result) {
      // The working copy moved since the click: nothing was replaced, and pressing again uses the newer revision.
      if (!(result.case && result.case.id === current.workingCaseId)) onReplaced();
      else window.setTimeout(() => openLatest.current?.focus(), 0);
    } else if (result && typeof result === "object") onReplaced();
    else setFailed({ kind: "open" });
  }, [current, getWorking, onReplaced]);

  const runCreate = useCallback(async (name: string, key: string) => {
    if (guard.current) return;
    guard.current = true;
    setBusy("create");
    setFailed(null);
    const working = getWorking();
    const expected = working?.revision ?? current.workingRevision;
    const result = await createSavedCase(new AbortController().signal, {
      caseId: current.workingCaseId, expectedRevision: expected, savedId: current.savedId, savedRevision: current.savedRevision, requestKey: key, name, locale });
    guard.current = false;
    setBusy(null);
    if (result === NAME_TOO_LONG || result === NAME_INVALID) {
      setCopying({ initial: name, error: result === NAME_TOO_LONG ? text.nameTooLong : text.nameInvalid });
    } else if (result === SCHOOL_REQUIRED) {
      onSchoolRequired();
    } else if (result && "stale" in result) {
      if (result.stale && result.case?.id === current.workingCaseId) { setCurrent(result.stale); window.setTimeout(() => saveAsNew.current?.focus(), 0); }
      else onReplaced();
    } else if (result) {
      onResolved(expected);
    } else {
      setFailed({ kind: "create", name, key });
    }
  }, [current, getWorking, locale, onReplaced, onResolved, onSchoolRequired, text.nameInvalid, text.nameTooLong]);

  function chooseCreate() {
    if (guard.current) return;
    guard.current = true;
    setFailed(null);
    const old = current.savedName.trim();
    const [before, after = ""] = text.copyName.split("{name}");
    const room = Math.max(NAME_LIMIT - graphemeCount(before + after, locale), 0);
    setCopying({ initial: old === "" ? null : before + cutGraphemes(old, room, locale) + after, error: null });
  }

  const line = busy ? text.conflictBusy : failed ? (failed.kind === "open" ? text.conflictOpenFailed : text.conflictCreateFailed) : "";
  return (
    <div className="flex flex-col gap-3" data-autosave-conflict>
      <div className="flex flex-wrap gap-3" role="group" aria-label={text.saveConflict}>
        <button ref={openLatest} type="button" disabled={busy !== null} className={buttonClass} onClick={() => void runOpen()}>{text.conflictOpenLatest}</button>
        <button ref={saveAsNew} type="button" disabled={busy !== null} className={buttonClass} onClick={chooseCreate}>{text.conflictSaveAsNew}</button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <p role="status" aria-live="polite" className="text-sm text-muted">{line}</p>
        {failed && !busy && (
          <button type="button" className={buttonClass} onClick={() => { if (failed.kind === "open") void runOpen(); else void runCreate(failed.name, failed.key); }}>{text.saveRetry}</button>
        )}
      </div>
      {copying && <NameDialog locale={locale} text={text} initial={copying.initial} error={copying.error}
        onCancel={() => { setCopying(null); guard.current = false; saveAsNew.current?.focus(); }}
        onSubmit={(name) => { setCopying(null); guard.current = false; void runCreate(name, globalThis.crypto.randomUUID()); }} />}
    </div>
  );
}

/** The sign-in dialog of an expired session: it returns to this Interview, where the unsaved changes are sent once. */
function SignInDialog({ locale, text, caseId, onClose }: { locale: string; text: Messages["results"]; caseId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const path = `/${locale}/interview/`;
  useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal?.(); }, []);
  function rememberCase() {
    try {
      sessionStorage.setItem(AUTOSAVE_RESUME_KEY, caseId);
    } catch {
      // The authentication links still work when browser storage is unavailable.
    }
  }
  return (
    <dialog ref={dialog} aria-labelledby={title} className="m-auto max-w-md rounded border bg-white p-6 text-black backdrop:bg-black/50" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <h2 id={title} className="text-xl font-semibold">{text.authTitle}</h2>
        <a autoFocus className={buttonClass} href={loginHref(path)} onClick={rememberCase}>{text.signIn}</a>
        <a className={buttonClass} href={signupHref(locale, path)} onClick={rememberCase}>{text.createAccount}</a>
        <button type="button" className={buttonClass} onClick={() => dialog.current?.close()}>{text.close}</button>
      </div>
    </dialog>
  );
}

/**
 * The Interview's autosave status line for a Case linked to a Saved case: one `role="status"` that changes only
 * when a save settles, with Retry, sign-in and the conflict choices. A Case that is not tracked shows nothing.
 */
export function AutosaveLine({ locale, messages, text, caseId, getWorking, onReplaced, onChanged }: {
  locale: string;
  messages: Messages["interview"];
  text: Messages["results"];
  caseId: string;
  getWorking: () => { caseId: string; revision: number } | null;
  onReplaced: () => void;
  /** The conflict was settled by saving a new Saved case. */
  onChanged: () => void;
}) {
  const snap = useSyncExternalStore(autosave.subscribe, autosave.getSnapshot, autosave.getSnapshot);
  const [dialogFor, setDialogFor] = useState<number | null>(null);
  const [schoolNote, setSchoolNote] = useState(false);
  const shown = snap.caseId === caseId ? snap.state : null;
  const seq = snap.seq;
  useEffect(() => {
    if (shown !== "unsaved") return;
    try {
      if (sessionStorage.getItem(AUTOSAVE_RESUME_KEY) !== caseId) return;
      sessionStorage.removeItem(AUTOSAVE_RESUME_KEY);
    } catch {
      return;
    }
    void autosave.retry();
  }, [caseId, shown]);
  useEffect(() => {
    if (shown === "signed-out") { const timer = window.setTimeout(() => setDialogFor(seq), 0); return () => window.clearTimeout(timer); }
  }, [shown, seq]);
  if (shown === null) return null;
  const line =
    shown === "saving" ? text.saving
    : shown === "saved" ? text.saved
    : shown === "needs-heirs" ? messages.autosaveNeedsHeirs
    : shown === "needs-school" || schoolNote ? text.saveNeedsSchool
    : shown === "failed" || shown === "signed-out" ? text.saveError
    : shown === "unavailable" ? messages.autosaveUnavailable
    : shown === "conflict" ? text.saveConflict
    : shown === "unsaved" ? messages.unsavedNotice
    : "";
  const results = `/${locale}/results/`;
  return (
    <div className="flex flex-col gap-3" dir={directionOf(locale)} data-autosave-state={shown}>
      <div className="flex flex-wrap items-center gap-3">
        <p role="status" aria-live="polite" className="text-sm" {...(shown === "unsaved" ? { "data-unsaved-notice": "" } : {})}>{line}</p>
        {(shown === "unsaved" || shown === "unavailable") && (
          <Link href={results} prefetch={false} className="inline-flex min-h-11 items-center underline">{messages.unsavedLink}</Link>
        )}
        {shown === "failed" && <button type="button" className={buttonClass} onClick={() => void autosave.retry()}>{text.saveRetry}</button>}
        {shown === "signed-out" && <button type="button" className={buttonClass} onClick={() => setDialogFor(seq)}>{text.signIn}</button>}
      </div>
      {shown === "conflict" && snap.conflict && (
        <ConflictChoices key={`${snap.conflict.savedId}:${snap.conflict.savedRevision}:${snap.conflict.workingRevision}`} locale={locale} text={text} conflict={snap.conflict} getWorking={getWorking}
          onReplaced={onReplaced}
          onResolved={(revision) => { autosave.relinked(caseId, revision); setSchoolNote(false); onChanged(); }}
          onSchoolRequired={() => setSchoolNote(true)} />
      )}
      {dialogFor === seq && shown === "signed-out" && <SignInDialog locale={locale} text={text} caseId={caseId} onClose={() => setDialogFor(null)} />}
    </div>
  );
}

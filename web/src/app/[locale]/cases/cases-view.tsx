"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchCase, hasUnsavedChanges, startCase, type Case } from "@/api/case";
import { fetchSession, PROBE_TIMEOUT_MS } from "@/api/session";
import { writeOpenHandoff } from "@/interview/open-handoff";
import { listSavedCases, openSavedCase, renameSavedCase, NAME_INVALID, NAME_LIMIT, NAME_TOO_LONG, OPEN_AUTH, OPEN_CONFLICT, graphemeCount, type SavedCase } from "@/api/saved-cases";
import type { Messages } from "@/i18n/messages";
import { listReceived, type Received } from "@/api/invites";
import { casesPath, loginHref, receivedPath } from "@/i18n/paths";
import { useAuthState } from "../use-session";
import { buttonClass } from "../interview/form-bits";
import { CaseNameField } from "../results/case-name-field";

type Sort = "recent" | "name";
/** What waits behind the discard question: opening a Saved case, or starting a new one. */
type Pending = { kind: "open"; id: number } | { kind: "new" };
const OPEN_PARAM = "open";
/** A positive whole number, or null: anything else in the `open` parameter is ignored. */
function parseOpenParam(search: string): number | null {
  const raw = new URLSearchParams(search).get(OPEN_PARAM);
  if (raw === null || !/^[1-9]\d{0,14}$/.test(raw)) return null;
  return Number(raw);
}
type Editing = { id: number; value: string; saving: boolean; error: string | null };
const byRecent = (a: SavedCase, b: SavedCase) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.id - a.id;
export function CasesView({ locale, text }: { locale: string; text: Messages }) {
  const router = useRouter();
  const auth = useAuthState();
  const [rows, setRows] = useState<SavedCase[] | null>(null);
  const [received, setReceived] = useState<Received[] | null>(null);
  const [error, setError] = useState(false);
  const [newFailed, setNewFailed] = useState(false);
  const [listError, setListError] = useState(false);
  const [reload, setReload] = useState(0);
  const [sort, setSort] = useState<Sort>("recent");
  const [editing, setEditing] = useState<Editing | null>(null);
  const submitting = useRef(false);
  const editingId = useRef<number | null>(null);
  const refocusRename = useRef<number | null>(null);
  const [opening, setOpening] = useState<number | "new" | null>(null);
  // The row waiting for the discard answer, and the working copy shown to the visitor (undefined: unreadable).
  const [prompt, setPrompt] = useState<{ action: Pending; current: Case | null | undefined } | null>(null);
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
    return () => controller.abort();
  }, [auth]);
  useEffect(() => {
    if (auth !== "authenticated") return;
    const controller = new AbortController();
    listSavedCases(controller.signal).then(
      (value) => { if (!controller.signal.aborted) setRows(value); },
      () => { if (!controller.signal.aborted) setListError(true); },
    );
    return () => controller.abort();
  }, [auth, reload]);
  // After Save or Cancel the Rename button comes back and takes the focus.
  useEffect(() => {
    if (editing === null && refocusRename.current !== null) {
      document.getElementById(`rename-${refocusRename.current}`)?.focus();
      refocusRename.current = null;
    }
  }, [editing]);
  editingId.current = editing?.id ?? null;
  const saving = editing?.saving === true;
  const label = (row: SavedCase) => row.name || text.cases.untitled;
  const shown = useMemo(() => {
    if (!rows) return null;
    if (sort === "recent") return [...rows].sort(byRecent);
    const collator = new Intl.Collator(locale);
    return [...rows].sort((a, b) => collator.compare(a.name || text.cases.untitled, b.name || text.cases.untitled) || byRecent(a, b));
  }, [rows, sort, locale, text.cases.untitled]);
  function retry() {
    setRows(null);
    setListError(false);
    setReload((count) => count + 1);
  }
  function stopEditing(id: number) {
    if (submitting.current) return;
    refocusRename.current = id;
    setEditing(null);
  }
  async function submitRename(row: SavedCase) {
    if (!editing || editing.id !== row.id || submitting.current || row.revision === undefined) return;
    const name = editing.value.trim();
    if (graphemeCount(name, locale) > NAME_LIMIT) return;
    submitting.current = true;
    setEditing({ ...editing, saving: true, error: null });
    const result = await renameSavedCase(new AbortController().signal, row.id, { name, expectedRevision: row.revision, locale });
    submitting.current = false;
    if (!mounted.current) return;
    if (result && typeof result === "object" && "conflict" in result) {
      const { revision, name: stored } = result.conflict;
      setRows((all) => all && all.map((item) => (item.id === row.id ? { ...item, name: stored, revision } : item)));
      setEditing((now) => (now && now.id === row.id ? { ...now, saving: false, error: text.cases.renameConflict } : now));
      return;
    }
    if (result && typeof result === "object") {
      const done = result;
      setRows((all) => all && all.map((item) => (item.id === row.id ? { ...item, name: done.name, revision: done.revision, updated_at: done.updated_at } : item)));
      // Only an editor that still belongs to this row is closed; another row's text is never discarded.
      if (editingId.current === row.id) refocusRename.current = row.id;
      setEditing((now) => (now && now.id === row.id ? null : now));
      return;
    }
    const why = result === NAME_TOO_LONG ? text.results.nameTooLong : result === NAME_INVALID ? text.results.nameInvalid : text.cases.renameFailed;
    setEditing((now) => (now && now.id === row.id ? { ...now, saving: false, error: why } : now));
  }
  function closePrompt() {
    if (dialog.current?.open) dialog.current.close();
    setPrompt(null);
    pressed.current?.focus();
  }
  async function begin(action: Pending, conflicted = false) {
    setOpening(action.kind === "new" ? "new" : action.id);
    setError(false);
    setNewFailed(false);
    let current: Case | null | undefined;
    try { current = await fetchCase(new AbortController().signal); } catch { current = undefined; }
    if (!mounted.current) return;
    // Unreadable state asks as well, and after a conflict it always asks again: never act on its own.
    if (conflicted || current === undefined || hasUnsavedChanges(current)) { setPrompt({ action, current }); setOpening(null); return; }
    await go(action, current);
  }
  function failed(action: Pending) {
    refocus.current = true;
    if (action.kind === "new") setNewFailed(true); else setError(true);
    setOpening(null);
  }
  async function go(action: Pending, current: Case | null | undefined) {
    if (!mounted.current) return;
    setOpening(action.kind === "new" ? "new" : action.id);
    if (action.kind === "new") {
      const result = await startCase(new AbortController().signal, current === undefined ? { replace: true } : current ? { replace: true, caseId: current.id, revision: current.revision } : {});
      if (!mounted.current) return;
      if (result.kind === "exists") { setPrompt(null); await begin(action, true); return; }
      if (result.kind === "started") { writeOpenHandoff(result.case.id); router.push(`/${locale}/interview/`); } else failed(action);
      return;
    }
    const { id } = action;
    const check = current === undefined ? undefined : { caseId: current?.id ?? null, revision: current?.revision ?? null };
    const result = await openSavedCase(new AbortController().signal, id, check ? { check } : {});
    if (!mounted.current) return;
    if (result === OPEN_CONFLICT) { setPrompt(null); await begin(action, true); return; }
    if (result === OPEN_AUTH) {
      // Only a signed-out session goes to sign-in; a refusal while still signed in is the generic failure.
      let signedOut = false;
      try { signedOut = !(await fetchSession(AbortSignal.timeout(PROBE_TIMEOUT_MS))).authenticated; } catch { signedOut = false; }
      if (!mounted.current) return;
      if (signedOut) { router.push(loginHref(`${casesPath(locale)}?${OPEN_PARAM}=${id}`)); return; }
      failed(action);
      return;
    }
    if (result && typeof result === "object" && "id" in result) { writeOpenHandoff(result.id); router.push(`/${locale}/interview/`); }
    else failed(action);
  }
  async function confirm() {
    if (!prompt) return;
    const { action, current } = prompt;
    if (dialog.current?.open) dialog.current.close();
    setPrompt(null);
    await go(action, current);
  }
  function open(id: number, button: HTMLElement) {
    pressed.current = button;
    void begin({ kind: "open", id });
  }
  function startNew(button: HTMLElement) {
    pressed.current = button;
    void begin({ kind: "new" });
  }
  // After sign-in the login page returns here with ?open=<id>: that Open resumes once, through the same discard prompt.
  const resumed = useRef(false);
  useEffect(() => {
    if (auth !== "authenticated" || resumed.current) return;
    resumed.current = true;
    const id = parseOpenParam(window.location.search);
    if (new URLSearchParams(window.location.search).has(OPEN_PARAM)) {
      const params = new URLSearchParams(window.location.search);
      params.delete(OPEN_PARAM);
      const query = params.toString();
      try { window.history.replaceState(window.history.state, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`); } catch {}
    }
    if (id !== null) void Promise.resolve().then(() => begin({ kind: "open", id }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth]);
  // The sign-in link keeps a valid ?open= so the Open resumes after sign-in.
  function signInQuery() {
    const id = typeof window === "undefined" ? null : parseOpenParam(window.location.search);
    return id === null ? "" : `?${OPEN_PARAM}=${id}`;
  }
  if (auth === "loading") return <p role="status">{text.checking}</p>;
  if (auth !== "authenticated") return (
    <p>
      {auth === "error" && <span role="alert">{text.unavailable} </span>}
      <a className={buttonClass} href={loginHref(casesPath(locale) + signInQuery())}>{text.cases.signIn}</a>
    </p>
  );
  return (
    <>
      <p role="alert">{newFailed ? text.cases.newCaseFailed : error || listError ? text.cases.error : ""}</p>
      <p><button type="button" className={buttonClass} disabled={opening !== null} onClick={(event) => startNew(event.currentTarget)}>{text.cases.newCase}</button></p>
      {listError && <p><button type="button" className={buttonClass} onClick={retry}>{text.cases.retry}</button></p>}
      {!rows && !listError && (
        <div data-skeleton aria-busy="true" className="flex flex-col gap-4">
          <p className="sr-only" role="status">{text.cases.loading}</p>
          {[0, 1, 2].map((index) => (
            <div key={index} aria-hidden="true" className="flex flex-col gap-3 rounded border p-4">
              <div className="h-3 w-1/2 animate-pulse rounded-full bg-surface motion-reduce:animate-none" />
              <div className="h-3 w-2/3 animate-pulse rounded-full bg-surface motion-reduce:animate-none" />
            </div>
          ))}
        </div>
      )}
      {rows?.length === 0 && <p>{text.cases.empty}</p>}
      {rows && rows.length >= 2 && (
        <p className="flex flex-wrap items-center gap-3">
          <label htmlFor="cases-sort" className="font-semibold">{text.cases.sortLabel}</label>
          <select id="cases-sort" value={sort} onChange={(event) => setSort(event.target.value === "name" ? "name" : "recent")} className="min-h-11 rounded-md border border-current bg-transparent px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
            <option value="recent">{text.cases.sortRecent}</option>
            <option value="name">{text.cases.sortName}</option>
          </select>
        </p>
      )}
      <ul className="flex flex-col gap-4">
        {shown?.map((row) => {
          const edit = editing?.id === row.id ? editing : null;
          return (
          <li key={row.id} className="flex flex-wrap items-center gap-4 rounded border p-4">
            <div className="flex min-w-0 flex-1 basis-48 flex-col gap-1">
              <span id={`name-${row.id}`} className="font-semibold [overflow-wrap:anywhere]"><bdi dir="auto">{label(row)}</bdi></span>
              {edit && (
                <form className="flex flex-col gap-2" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); stopEditing(row.id); } }} onSubmit={(event) => { event.preventDefault(); void submitRename(row); }}>
                  <CaseNameField locale={locale} text={text.results} value={edit.value} error={edit.error} autoFocus readOnly={edit.saving}
                    onChange={(value) => setEditing((now) => (now ? { ...now, value } : now))} />
                  <p role="status" className="text-sm">{edit.saving ? text.cases.renameSaving : ""}</p>
                  <div className="flex flex-wrap gap-3">
                    <button type="submit" aria-disabled={edit.saving || graphemeCount(edit.value.trim(), locale) > NAME_LIMIT} className={buttonClass}>{text.cases.renameSave}</button>
                    <button type="button" disabled={edit.saving} className={buttonClass} onClick={() => stopEditing(row.id)}>{text.cases.renameCancel}</button>
                  </div>
                </form>
              )}
              <span id={`saved-${row.id}`}>{text.cases.updated}: {new Date(row.updated_at).toLocaleString(locale)}</span>
            </div>
            <span>{row.madhab ? text.interview.madhabs[row.madhab].name : text.interview.schoolsAgree}</span>
            <span>{text.cases.heirs}: {row.heir_count}</span>
            <span>{row.status === "draft" ? text.cases.draft : row.status}</span>
            {/* Every row has an Open button; the date tells screen-reader users which case it opens. */}
            <button type="button" aria-describedby={`name-${row.id} saved-${row.id}`} className={buttonClass} disabled={opening !== null} onClick={(event) => open(row.id, event.currentTarget)}>
              {text.cases.open}
            </button>
            {row.revision !== undefined && !edit && (
              <button type="button" id={`rename-${row.id}`} className={`${buttonClass} max-w-full [overflow-wrap:anywhere]`} disabled={opening !== null || saving} onClick={() => setEditing({ id: row.id, value: row.name ?? "", saving: false, error: null })}>
                {text.cases.rename.split("{name}").join(label(row))}
              </button>
            )}
          </li>
          );
        })}
      </ul>
      <dialog ref={dialog} aria-labelledby="discard-title" aria-describedby="discard-body" className="m-auto max-w-md rounded border bg-white p-6 text-black backdrop:bg-black/50" onCancel={(event) => { event.preventDefault(); closePrompt(); }} onClose={() => { if (prompt && !dialog.current?.open) { setPrompt(null); pressed.current?.focus(); } }}>
        {prompt && (
          <>
            <h2 id="discard-title" className="text-xl font-semibold">{text.cases.discardTitle}</h2>
            <p id="discard-body" className="my-4">{text.cases.discardBody}</p>
            <div className="flex flex-wrap gap-3">
              <button type="button" ref={safe} className={buttonClass} onClick={closePrompt}>{text.cases.discardNo}</button>
              <button type="button" className={buttonClass} onClick={() => void confirm()}>{prompt.action.kind === "new" ? text.cases.discardConfirmNew : text.cases.discardYes}</button>
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

import { write, parseCase, isMadhabId, CASE_TIMEOUT_MS, type Case, type MadhabId, type WriteOptions } from "./case.ts";

/** `madhab` is null for a case saved with no school, because all four Sunni schools agree. */
export type SavedCase = { id: number; name?: string; updated_at: string; revision?: number; madhab: MadhabId | null; heir_count: number; status: string };
const url = "/api/v1/saved-cases/";
/** `school_required`: the schools differ for this family and none is chosen, so it cannot be saved yet. */
export const SCHOOL_REQUIRED = "school_required";
/** `saved_case_conflict`: the linked Saved case changed elsewhere, so nothing was written. */
export const SAVE_CONFLICT = "saved_case_conflict";
export type Saved = { id: number; name: string; updated_at: string };
/** The server refused the name (400 `errors.name`); nothing was stored and retrying the same name cannot work. */
export const NAME_TOO_LONG = "name_too_long";
export const NAME_INVALID = "name_invalid";
/** The conflict as the server states it: the Saved case the working copy is linked to and the working Case it was shown against. */
export type SaveConflict = { code: typeof SAVE_CONFLICT; savedId: number; savedName: string; savedRevision: number; workingCaseId: string; workingRevision: number };
/** A conflict body counts as actionable only when every field is present and well typed; anything else is no choice at all. */
export function parseConflict(body: unknown): SaveConflict | null {
  if (typeof body !== "object" || body === null) return null;
  const value = body as Record<string, unknown>;
  const whole = (field: unknown): field is number => typeof field === "number" && Number.isInteger(field) && field >= 1;
  if (value.code !== SAVE_CONFLICT || !whole(value.saved_id) || !whole(value.revision) || !whole(value.working_revision) || typeof value.working_case_id !== "string" || typeof value.saved_name !== "string") return null;
  return { code: SAVE_CONFLICT, savedId: value.saved_id, savedName: value.saved_name, savedRevision: value.revision, workingCaseId: value.working_case_id, workingRevision: value.working_revision };
}
export type SaveResult = Saved | SaveConflict | typeof SCHOOL_REQUIRED | typeof SAVE_CONFLICT | typeof NAME_TOO_LONG | typeof NAME_INVALID | null;
/** The Case name rule: user-perceived characters (extended grapheme clusters), as the server counts them. */
export const NAME_LIMIT = 100;
export function graphemeCount(name: string, locale?: string): number {
  // Without Intl.Segmenter, count code points; the server stays the authority.
  if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") return Array.from(name).length;
  return [...new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(name)].length;
}
/** The first `limit` user-perceived characters of `name`. */
export function cutGraphemes(name: string, limit: number, locale?: string): string {
  if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") return Array.from(name).slice(0, limit).join("");
  return [...new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(name)].slice(0, limit).map((part) => part.segment).join("");
}
/** Success is claimed only for a 200 or 201 whose answer carries the stored name. */
export async function saveCase(signal: AbortSignal, caseId: string, options: WriteOptions & { name?: string; locale?: string } = {}): Promise<SaveResult> {
  const { name, locale, ...rest } = options;
  const body = JSON.stringify({ case_id: caseId, ...(name === undefined ? {} : { name }) });
  return write(signal, rest, { method: "POST", url, body, ...(locale ? { headers: { "Accept-Language": locale } } : {}) }, async (response) => {
    if (response.status === 400) {
      const refused = await response.json().catch(() => null);
      if (refused && refused.code === SCHOOL_REQUIRED) return SCHOOL_REQUIRED;
      const refusedName = refused?.errors?.name;
      return refusedName === "too_long" ? NAME_TOO_LONG : refusedName === "invalid" ? NAME_INVALID : null;
    }
    if (response.status === 409) {
      const refused = await response.json().catch(() => null);
      return refused && refused.code === SAVE_CONFLICT ? parseConflict(refused) ?? SAVE_CONFLICT : null;
    }
    if (response.status !== 200 && response.status !== 201) return null;
    const body = await response.json();
    return Number.isInteger(body.id) && body.id > 0 && typeof body.updated_at === "string" && typeof body.name === "string" ? { id: body.id, name: body.name, updated_at: body.updated_at } : null;
  });
}
/** Save as a new case answered 409: the stored case or the working copy changed since the prompt. `stale` is the conflict as it holds now (null when none holds any more), `case` the current working copy (null when there is none). */
export type CreateStale = { stale: SaveConflict | null; case: Case | null };
export type CreateResult = (Saved & { revision: number }) | CreateStale | typeof SCHOOL_REQUIRED | typeof NAME_TOO_LONG | typeof NAME_INVALID | null;
/** Saves the working copy as a new Saved case after a conflict. The same `requestKey` makes a retry return the same row. */
export async function createSavedCase(signal: AbortSignal, args: { caseId: string; expectedRevision: number; savedId: number; savedRevision: number; requestKey: string; name?: string; locale?: string }, options: WriteOptions = {}): Promise<CreateResult> {
  const body = JSON.stringify({ case_id: args.caseId, expected_revision: args.expectedRevision, saved_id: args.savedId, saved_revision: args.savedRevision, request_key: args.requestKey, ...(args.name === undefined ? {} : { name: args.name }) });
  return write<CreateResult>(signal, options, { method: "POST", url: `${url}create/`, body, ...(args.locale ? { headers: { "Accept-Language": args.locale } } : {}) }, async (response) => {
    if (response.status === 400) {
      const refused = await response.json().catch(() => null);
      if (refused?.code === SCHOOL_REQUIRED) return SCHOOL_REQUIRED;
      const refusedName = refused?.errors?.name;
      return refusedName === "too_long" ? NAME_TOO_LONG : refusedName === "invalid" ? NAME_INVALID : null;
    }
    if (response.status === 409) {
      const refused = await response.json().catch(() => null);
      if (!refused || refused.code !== "resolve_stale") return null;
      return { stale: parseConflict(refused.conflict), case: parseCase(refused) };
    }
    if (response.status !== 200 && response.status !== 201) return null;
    const saved = await response.json().catch(() => null);
    return saved && Number.isInteger(saved.id) && saved.id > 0 && Number.isInteger(saved.revision) && saved.revision >= 1 && typeof saved.updated_at === "string" && typeof saved.name === "string" ? { id: saved.id, name: saved.name, updated_at: saved.updated_at, revision: saved.revision } : null;
  });
}
/** The suggested name for a first save, in the page's Locale; null when it cannot be read. */
export async function suggestedName(signal: AbortSignal, locale: string): Promise<string | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, CASE_TIMEOUT_MS);
  try {
    const response = await fetch(`${url}name-suggestion/`, { credentials: "same-origin", cache: "no-store", signal: controller.signal, headers: { Accept: "application/json", "Accept-Language": locale } });
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body.name === "string" && body.name !== "" ? body.name : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}
/** A rename answered 409: the row changed since it was listed. `revision` and `name` are as stored now. */
export type RenameConflict = { conflict: { revision: number; name: string } };
export type Renamed = Saved & { revision: number };
export type RenameResult = Renamed | RenameConflict | typeof NAME_TOO_LONG | typeof NAME_INVALID | null;
/** Renames a Saved case, guarded by the revision the row was listed at. Success is claimed only for a 200 that carries the stored name and revision. */
export async function renameSavedCase(signal: AbortSignal, id: number, args: { name: string; expectedRevision: number; locale?: string }, options: WriteOptions = {}): Promise<RenameResult> {
  if (!Number.isInteger(id) || id < 1) return null;
  const body = JSON.stringify({ name: args.name, expected_revision: args.expectedRevision });
  return write<RenameResult>(signal, options, { method: "POST", url: `${url}${id}/rename/`, body, ...(args.locale ? { headers: { "Accept-Language": args.locale } } : {}) }, async (response) => {
    if (response.status === 400) {
      const refused = await response.json().catch(() => null);
      const refusedName = refused?.errors?.name;
      return refusedName === "too_long" ? NAME_TOO_LONG : refusedName === "invalid" ? NAME_INVALID : null;
    }
    if (response.status === 409) {
      const refused = await response.json().catch(() => null);
      if (refused?.code !== "rename_conflict" || !Number.isInteger(refused.revision) || refused.revision < 1 || typeof refused.name !== "string") return null;
      return { conflict: { revision: refused.revision, name: refused.name } };
    }
    if (response.status !== 200) return null;
    const saved = await response.json().catch(() => null);
    return saved && Number.isInteger(saved.id) && saved.id > 0 && Number.isInteger(saved.revision) && saved.revision >= 1 && typeof saved.updated_at === "string" && typeof saved.name === "string" ? { id: saved.id, name: saved.name, updated_at: saved.updated_at, revision: saved.revision } : null;
  });
}
/** `conflict`: the working copy changed since the prompt, so nothing was replaced. */
export const OPEN_CONFLICT = "conflict";
export type OpenResult = Case | typeof OPEN_CONFLICT | { kind: "stale"; case: Case | null } | null;
/** With `check`, the server refuses (409) when the working copy is no longer that Case at that revision; a null `caseId` means none. With `returnStale`, that refusal comes back as `{ kind: "stale", case }` carrying the current working copy instead of the bare conflict. */
export async function openSavedCase(signal: AbortSignal, id: number, options: WriteOptions & { check?: { caseId: string | null; revision: number | null }; returnStale?: boolean } = {}): Promise<OpenResult> {
  if (!Number.isInteger(id) || id < 1) return null;
  const { check, returnStale, ...rest } = options;
  const body = check ? JSON.stringify({ case_id: check.caseId, ...(check.revision === null ? {} : { expected_revision: check.revision }) }) : "{}";
  return write(signal, rest, { method: "POST", url: `${url}${id}/open/`, body }, async (response) => {
    if (response.status === 409) {
      if (!returnStale) return OPEN_CONFLICT;
      const stale = await response.json().catch(() => null);
      try { return { kind: "stale", case: parseCase(stale) }; } catch { return null; }
    }
    return response.ok ? parseCase(await response.json()) : null;
  });
}
export async function listSavedCases(signal: AbortSignal): Promise<SavedCase[]> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, CASE_TIMEOUT_MS);
  try {
    const response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Saved cases unavailable");
    const body = await response.json();
    if (!Array.isArray(body.cases) || !body.cases.every((row: SavedCase) => row && Number.isInteger(row.id) && row.id > 0 && typeof row.updated_at === "string" && (row.name === undefined || typeof row.name === "string") && (row.madhab === null || isMadhabId(row.madhab)) && Number.isInteger(row.heir_count) && row.heir_count >= 0 && typeof row.status === "string")) throw new Error("Invalid saved cases");
    // A revision counts only as a positive integer; without one the row cannot be renamed (an older server).
    return body.cases.map((row: SavedCase) => {
      const { revision, ...rest } = row;
      return Number.isInteger(revision) && (revision as number) >= 1 ? { ...rest, revision } : rest;
    });
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

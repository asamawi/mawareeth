import { write, parseCase, isMadhabId, CASE_TIMEOUT_MS, type Case, type MadhabId, type WriteOptions } from "./case.ts";

/** `madhab` is null for a case saved with no school, because all four Sunni schools agree. */
export type SavedCase = { id: number; name?: string; updated_at: string; madhab: MadhabId | null; heir_count: number; status: string };
const url = "/api/v1/saved-cases/";
/** `school_required`: the schools differ for this family and none is chosen, so it cannot be saved yet. */
export const SCHOOL_REQUIRED = "school_required";
/** `saved_case_conflict`: the linked Saved case changed elsewhere, so nothing was written. */
export const SAVE_CONFLICT = "saved_case_conflict";
export type Saved = { id: number; name: string; updated_at: string };
/** The server refused the name (400 `errors.name`); nothing was stored and retrying the same name cannot work. */
export const NAME_TOO_LONG = "name_too_long";
export const NAME_INVALID = "name_invalid";
export type SaveResult = Saved | typeof SCHOOL_REQUIRED | typeof SAVE_CONFLICT | typeof NAME_TOO_LONG | typeof NAME_INVALID | null;
/** Conflict details returned with SAVE_CONFLICT. */
export type SaveConflict = { code: typeof SAVE_CONFLICT; savedId: number; savedRevision: number; savedName: string; workingCaseId: string; workingRevision: number };
/** The Case name rule: user-perceived characters (extended grapheme clusters), as the server counts them. */
export const NAME_LIMIT = 100;
export function graphemeCount(name: string, locale?: string): number {
  // Without Intl.Segmenter, count code points; the server stays the authority.
  if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") return Array.from(name).length;
  return [...new Intl.Segmenter(locale, { granularity: "grapheme" }).segment(name)].length;
}
/** Success is claimed only for a 200 or 201 whose answer carries the stored name. */
export async function saveCase(signal: AbortSignal, caseId: string, options: WriteOptions & { name?: string; locale?: string } = {}): Promise<SaveResult | SaveConflict> {
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
      if (refused && refused.code === SAVE_CONFLICT) {
        return { code: SAVE_CONFLICT, savedId: refused.saved_id, savedRevision: refused.revision, savedName: refused.saved_name, workingCaseId: caseId, workingRevision: refused.working_revision ?? 0 };
      }
      return null;
    }
    if (response.status !== 200 && response.status !== 201) return null;
    const body = await response.json();
    return Number.isInteger(body.id) && body.id > 0 && typeof body.updated_at === "string" && typeof body.name === "string" ? { id: body.id, name: body.name, updated_at: body.updated_at } : null;
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
/** `conflict`: the working copy changed since the prompt, so nothing was replaced. */
export const OPEN_CONFLICT = "conflict";
export type OpenResult = Case | typeof OPEN_CONFLICT | null;
/** With `check`, the server refuses (409) when the working copy is no longer that Case at that revision; a null `caseId` means none. */
export async function openSavedCase(signal: AbortSignal, id: number, options: WriteOptions & { check?: { caseId: string | null; revision: number | null } } = {}): Promise<OpenResult> {
  if (!Number.isInteger(id) || id < 1) return null;
  const { check, ...rest } = options;
  const body = check ? JSON.stringify({ case_id: check.caseId, ...(check.revision === null ? {} : { expected_revision: check.revision }) }) : "{}";
  return write(signal, rest, { method: "POST", url: `${url}${id}/open/`, body }, async (response) => {
    if (response.status === 409) return OPEN_CONFLICT;
    return response.ok ? parseCase(await response.json()) : null;
  });
}

/** Create a new SavedCase from the working copy, bypassing the conflict check.
 * The `requestKey` (a client-generated UUID) provides idempotency: retrying with the same key returns the same row.
 * The `name` is optional; blank or missing falls back to the server's suggestion. */
export async function createSavedCase(signal: AbortSignal, caseId: string, options: WriteOptions & { name?: string; locale?: string; requestKey: string }): Promise<SaveResult> {
  const { name, locale, requestKey, ...rest } = options;
  const body = JSON.stringify({ case_id: caseId, request_key: requestKey, ...(name === undefined ? {} : { name }) });
  return write(signal, rest, { method: "POST", url: `${url}create/`, body, ...(locale ? { headers: { "Accept-Language": locale } } : {}) }, async (response) => {
    if (response.status === 400) {
      const refused = await response.json().catch(() => null);
      if (refused && refused.code === SCHOOL_REQUIRED) return SCHOOL_REQUIRED;
      const refusedName = refused?.errors?.name;
      return refusedName === "too_long" ? NAME_TOO_LONG : refusedName === "invalid" ? NAME_INVALID : null;
    }
    if (response.status !== 200 && response.status !== 201) return null;
    const body = await response.json();
    return Number.isInteger(body.id) && body.id > 0 && typeof body.updated_at === "string" && typeof body.name === "string" ? { id: body.id, name: body.name, updated_at: body.updated_at } : null;
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
    return body.cases;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

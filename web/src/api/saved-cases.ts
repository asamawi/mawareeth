import { write, parseCase, isMadhabId, CASE_TIMEOUT_MS, type Case, type MadhabId, type WriteOptions } from "./case.ts";

/** `madhab` is null for a case saved with no school, because all four Sunni schools agree. */
export type SavedCase = { id: number; updated_at: string; madhab: MadhabId | null; heir_count: number; status: string };
const url = "/api/v1/saved-cases/";
/** `school_required`: the schools differ for this family and none is chosen, so it cannot be saved yet. */
export const SCHOOL_REQUIRED = "school_required";
export type SaveResult = { id: number; updated_at: string } | typeof SCHOOL_REQUIRED | null;
export async function saveCase(signal: AbortSignal, caseId: string, options: WriteOptions = {}): Promise<SaveResult> {
  return write(signal, options, { method: "POST", url, body: JSON.stringify({ case_id: caseId }) }, async (response) => {
    if (response.status === 400) {
      const refused = await response.json().catch(() => null);
      return refused && refused.code === SCHOOL_REQUIRED ? SCHOOL_REQUIRED : null;
    }
    if (!response.ok) return null;
    const body = await response.json();
    return Number.isInteger(body.id) && body.id > 0 && typeof body.updated_at === "string" ? { id: body.id, updated_at: body.updated_at } : null;
  });
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
    if (!Array.isArray(body.cases) || !body.cases.every((row: SavedCase) => row && Number.isInteger(row.id) && row.id > 0 && typeof row.updated_at === "string" && (row.madhab === null || isMadhabId(row.madhab)) && Number.isInteger(row.heir_count) && row.heir_count >= 0 && typeof row.status === "string")) throw new Error("Invalid saved cases");
    return body.cases;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

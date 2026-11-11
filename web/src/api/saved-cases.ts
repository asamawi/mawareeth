import { write, parseCase, isMadhabId, CASE_TIMEOUT_MS, type Case, type MadhabId, type WriteOptions } from "./case.ts";

export type SavedCase = { id: number; updated_at: string; madhab: MadhabId; heir_count: number; status: string };
const url = "/api/v1/saved-cases/";
export async function saveCase(signal: AbortSignal, caseId: string, options: WriteOptions = {}): Promise<{ id: number; updated_at: string } | null> {
  return write(signal, options, { method: "POST", url, body: JSON.stringify({ case_id: caseId }) }, async (response) => {
    if (!response.ok) return null;
    const body = await response.json();
    return Number.isInteger(body.id) && body.id > 0 && typeof body.updated_at === "string" ? { id: body.id, updated_at: body.updated_at } : null;
  });
}
export async function openSavedCase(signal: AbortSignal, id: number, options: WriteOptions = {}): Promise<Case | null> {
  if (!Number.isInteger(id) || id < 1) return null;
  return write(signal, options, { method: "POST", url: `${url}${id}/open/`, body: "{}" }, async (response) => response.ok ? parseCase(await response.json()) : null);
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
    if (!Array.isArray(body.cases) || !body.cases.every((row: SavedCase) => row && Number.isInteger(row.id) && row.id > 0 && typeof row.updated_at === "string" && isMadhabId(row.madhab) && Number.isInteger(row.heir_count) && row.heir_count >= 0 && typeof row.status === "string")) throw new Error("Invalid saved cases");
    return body.cases;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

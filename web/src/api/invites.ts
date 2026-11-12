import { write, parseCase, parsePreview, CASE_TIMEOUT_MS, type Case, type Preview, type DraftReportResult, type WriteOptions } from "./case.ts";

export type Invite = { id: number; email: string; status: "pending" | "accepted" | "expired"; expires_at: string; created_at?: string; accepted_by?: string | null };
export type Received = { id: number; owner: string; updated_at: string; expires_at: string };
export type ReceivedView = { status: string; owner: string; kase: Case; preview: Preview };
type Failure = { kind: "sign_in" | "unavailable" | "throttled" | "failed" };
export type ReceivedResult = Failure | { kind: "view"; view: ReceivedView };
export type AcceptResult = Failure | { kind: "accepted"; id: number };
const base = "/api/v1/";
const validId = (id: unknown): id is number => Number.isSafeInteger(id) && (id as number) > 0;

function parseInvite(body: unknown): Invite | null {
  if (!body || typeof body !== "object") return null;
  const row = body as Record<string, unknown>;
  if (!validId(row.id) || typeof row.email !== "string" || typeof row.expires_at !== "string" || !["pending", "accepted", "expired"].includes(row.status as string)) return null;
  return row as Invite;
}

async function getRows<T>(signal: AbortSignal, url: string, key: string, parse: (value: unknown) => T | null): Promise<T[]> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, CASE_TIMEOUT_MS);
  try {
    const response = await fetch(base + url, { credentials: "same-origin", cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Invitations unavailable");
    const body = await response.json();
    if (!Array.isArray(body[key])) throw new Error("Invalid invitations");
    const rows = body[key].map(parse) as (T | null)[];
    if (rows.some((row) => row === null)) throw new Error("Invalid invitation");
    return rows as T[];
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

export function listInvites(signal: AbortSignal, savedId: number): Promise<Invite[]> {
  return getRows(signal, `saved-cases/${savedId}/invites/`, "invites", parseInvite);
}
export async function createInvite(signal: AbortSignal, savedId: number, email: string, locale: string, options: WriteOptions = {}): Promise<Invite | null> {
  if (!validId(savedId)) return null;
  return write(signal, options, { method: "POST", url: `${base}saved-cases/${savedId}/invites/`, body: JSON.stringify({ email }), headers: { "Accept-Language": locale } }, async (response) => response.status === 201 ? parseInvite(await response.json()) : null);
}
export async function revokeInvite(signal: AbortSignal, id: number, options: WriteOptions = {}): Promise<boolean> {
  if (!validId(id)) return false;
  return (await write(signal, options, { method: "DELETE", url: `${base}invites/${id}/` }, async (response) => response.status === 204 ? true : null)) === true;
}
async function failure(response: Response): Promise<Failure | null> {
  if (response.status === 404) return { kind: "unavailable" };
  if (response.status === 429) return { kind: "throttled" };
  if (response.status === 403) {
    const body = await response.json().catch(() => null);
    return { kind: body?.code === "sign_in_required" ? "sign_in" : "failed" };
  }
  return response.ok ? null : { kind: "failed" };
}
export async function acceptInvite(signal: AbortSignal, token: string, options: WriteOptions = {}): Promise<AcceptResult> {
  return (await write<AcceptResult>(signal, options, { method: "POST", url: `${base}invites/accept/`, body: JSON.stringify({ token }) }, async (response) => {
    const error = await failure(response);
    if (error) return error;
    const body = await response.json();
    return validId(body.id) ? { kind: "accepted", id: body.id } : { kind: "failed" };
  })) ?? { kind: "failed" };
}
export function listReceived(signal: AbortSignal): Promise<Received[]> {
  return getRows(signal, "received/", "received", (value) => {
    if (!value || typeof value !== "object") return null;
    const row = value as Record<string, unknown>;
    return validId(row.id) && typeof row.owner === "string" && typeof row.updated_at === "string" && typeof row.expires_at === "string" ? row as Received : null;
  });
}
export async function viewReceived(signal: AbortSignal, id: number, locale: string, options: WriteOptions = {}): Promise<ReceivedResult> {
  if (!validId(id)) return { kind: "unavailable" };
  return (await write<ReceivedResult>(signal, options, { method: "POST", url: `${base}received/${id}/view/`, body: "{}", headers: { "Accept-Language": locale } }, async (response) => {
    const error = await failure(response);
    if (error) return error;
    const body = await response.json();
    const kase = parseCase(body);
    const preview = parsePreview(body.preview);
    return kase && preview && typeof body.status === "string" && typeof body.owner === "string" ? { kind: "view", view: { status: body.status, owner: body.owner, kase, preview } } : { kind: "failed" };
  })) ?? { kind: "failed" };
}
export async function downloadReceivedReport(id: number, locale: string, options: WriteOptions & { signal?: AbortSignal } = {}): Promise<DraftReportResult> {
  if (!validId(id)) return { kind: "gone" };
  return (await write<DraftReportResult>(options.signal ?? new AbortController().signal, { ...options, timeoutMs: options.timeoutMs ?? 30_000 }, { method: "POST", url: `${base}received/${id}/report/`, body: "{}", headers: { Accept: "application/pdf", "Accept-Language": locale } }, async (response) => {
    if (response.status === 404 || response.status === 403) return { kind: "gone" };
    if (response.status === 429) return { kind: "throttled" };
    if (response.status === 409) return { kind: "unavailable" };
    if (!response.ok || response.headers.get("Content-Type")?.split(";")[0].trim() !== "application/pdf") return { kind: "failed" };
    const blob = await response.blob();
    return blob.size ? { kind: "download", blob } : { kind: "failed" };
  })) ?? { kind: "failed" };
}

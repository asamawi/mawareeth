import { write, parseCase, parsePreview, CASE_TIMEOUT_MS, type Case, type Preview, type DraftReportResult, type WriteOptions } from "./case.ts";

export type Visibility = "private" | "public";
export type Share = { id: number; visibility: Visibility; created_at: string; expires_at: string; expired: boolean };
export type CreatedShare = Share & { token: string };
export type SharedView = { status: string; visibility: Visibility; kase: Case; preview: Preview };
export type SharedViewResult =
  | { kind: "view"; view: SharedView }
  | { kind: "sign_in" | "unavailable" | "throttled" | "failed" };

const saved = "/api/v1/saved-cases/";
const shares = "/api/v1/shares/";

function parseShare(body: unknown): Share | null {
  if (typeof body !== "object" || body === null) return null;
  const value = body as Record<string, unknown>;
  const visibility = value.visibility;
  if (!Number.isInteger(value.id) || (value.id as number) < 1) return null;
  if (visibility !== "private" && visibility !== "public") return null;
  if (typeof value.created_at !== "string" || typeof value.expires_at !== "string" || typeof value.expired !== "boolean") return null;
  return { id: value.id as number, visibility, created_at: value.created_at, expires_at: value.expires_at, expired: value.expired };
}

const consent = (visibility: Visibility, accepted: boolean) =>
  JSON.stringify(visibility === "public" ? { visibility, accept_public_warning: accepted } : { visibility });

/** The owner creates a link for a saved case. The raw token is in this answer only. */
export async function createShare(signal: AbortSignal, savedId: number, visibility: Visibility = "private", accepted = false, options: WriteOptions = {}): Promise<CreatedShare | null> {
  if (!Number.isInteger(savedId) || savedId < 1) return null;
  return write(signal, options, { method: "POST", url: `${saved}${savedId}/shares/`, body: consent(visibility, accepted) }, async (response) => {
    if (!response.ok) return null;
    const body = await response.json();
    const share = parseShare(body);
    return share && typeof body.token === "string" && body.token ? { ...share, token: body.token } : null;
  });
}

export async function listShares(signal: AbortSignal, savedId: number): Promise<Share[]> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const timer = setTimeout(abort, CASE_TIMEOUT_MS);
  try {
    const response = await fetch(`${saved}${savedId}/shares/`, { credentials: "same-origin", cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Shares unavailable");
    const body = await response.json();
    const rows = Array.isArray(body.shares) ? body.shares.map(parseShare) : null;
    if (!rows || rows.some((row: Share | null) => row === null)) throw new Error("Invalid shares");
    return rows;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

/** Change visibility. Public needs `accepted`, the owner's explicit consent to the warning. */
export async function updateShare(signal: AbortSignal, id: number, visibility: Visibility, accepted = false, options: WriteOptions = {}): Promise<Share | null> {
  if (!Number.isInteger(id) || id < 1) return null;
  return write(signal, options, { method: "PATCH", url: `${shares}${id}/`, body: consent(visibility, accepted) }, async (response) => response.ok ? parseShare(await response.json()) : null);
}

export async function revokeShare(signal: AbortSignal, id: number, options: WriteOptions = {}): Promise<boolean> {
  if (!Number.isInteger(id) || id < 1) return false;
  return (await write(signal, options, { method: "DELETE", url: `${shares}${id}/` }, async (response) => response.status === 204 ? true : null)) === true;
}

/** The token travels in a POST body only, never in a URL. */
export async function viewShare(signal: AbortSignal, token: string, locale: string, options: WriteOptions = {}): Promise<SharedViewResult> {
  const result = await write<SharedViewResult>(signal, options, { method: "POST", url: `${shares}view/`, body: JSON.stringify({ token }), headers: { "Accept-Language": locale } }, async (response) => {
    if (response.status === 404) return { kind: "unavailable" };
    if (response.status === 429) return { kind: "throttled" };
    if (response.status === 403) {
      const body = await response.json().catch(() => null);
      return body && body.code === "sign_in_required" ? { kind: "sign_in" } : { kind: "failed" };
    }
    if (!response.ok) return { kind: "failed" };
    const body = await response.json();
    const kase = parseCase(body);
    const preview = parsePreview(body.preview);
    if (!kase || !preview || typeof body.status !== "string" || (body.visibility !== "private" && body.visibility !== "public")) return { kind: "failed" };
    return { kind: "view", view: { status: body.status, visibility: body.visibility, kase, preview } };
  });
  return result ?? { kind: "failed" };
}

export async function downloadSharedReport(token: string, locale: string, options: WriteOptions & { signal?: AbortSignal } = {}): Promise<DraftReportResult> {
  const controller = new AbortController();
  const result = await write<DraftReportResult>(options.signal ?? controller.signal, { ...options, timeoutMs: options.timeoutMs ?? 30_000 }, { method: "POST", url: `${shares}report/`, body: JSON.stringify({ token }), headers: { Accept: "application/pdf", "Accept-Language": locale } }, async (response) => {
    if (response.status === 404 || response.status === 403) return { kind: "gone" };
    if (response.status === 429) return { kind: "throttled" };
    if (response.status === 409) return { kind: "unavailable" };
    if (!response.ok || response.headers.get("Content-Type")?.split(";")[0].trim() !== "application/pdf") return { kind: "failed" };
    const blob = await response.blob();
    return blob.size ? { kind: "download", blob } : { kind: "failed" };
  });
  return result ?? { kind: "failed" };
}

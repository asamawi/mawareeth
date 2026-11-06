import { fetchSession } from "./session.ts";

/** In display order. The server accepts exactly these. */
export const MADHAB_IDS = ["hanafi", "maliki", "shafii", "hanbali", "jafari"] as const;

export type MadhabId = (typeof MADHAB_IDS)[number];

export function isMadhabId(value: unknown): value is MadhabId {
  return typeof value === "string" && (MADHAB_IDS as readonly string[]).includes(value);
}

export type Case = {
  id: string;
  started_at: string;
  /** Null until the visitor continues from the selector. */
  madhab: MadhabId | null;
};

export type MadhabResult =
  | { kind: "updated"; case: Case }
  /** There is no live case any more. */
  | { kind: "gone" }
  /** The case this tab meant was replaced; `case` is the live one. */
  | { kind: "replaced"; case: Case }
  | { kind: "throttled" }
  | { kind: "failed" };

export type StartResult =
  | { kind: "started"; case: Case }
  /** A case already exists and the visitor has not chosen to replace it. */
  | { kind: "exists"; case: Case }
  | { kind: "throttled" }
  | { kind: "failed" };

export const CASE_TIMEOUT_MS = 10_000;

const CASE_URL = "/api/v1/case/";

type CaseBody = { id: string; started_at: string; madhab?: unknown };

function isCaseBody(value: unknown): value is CaseBody {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CaseBody).id === "string" &&
    typeof (value as CaseBody).started_at === "string"
  );
}

function parseCase(body: unknown): Case | null {
  const value =
    typeof body === "object" && body !== null ? (body as { case?: unknown }).case : undefined;
  if (value === null) return null;
  if (!isCaseBody(value)) throw new Error("Case endpoint returned an unexpected body");
  // A missing or unknown madhab (an older shape) reads as none chosen.
  return {
    id: value.id,
    started_at: value.started_at,
    madhab: isMadhabId(value.madhab) ? value.madhab : null,
  };
}

export function readCsrfToken(cookie: string = document.cookie): string | undefined {
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "csrftoken") return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/** Rejects when the API cannot be reached, is too slow, or does not answer with a case. */
export async function fetchCase(
  signal: AbortSignal,
  options: { timeoutMs?: number } = {},
): Promise<Case | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, options.timeoutMs ?? CASE_TIMEOUT_MS);
  signal.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(CASE_URL, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Case read failed with status ${response.status}`);
    }
    return parseCase(await response.json());
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

type WriteOptions = { timeoutMs?: number; cookie?: () => string };

/**
 * Makes exactly one write attempt and never throws; `null` means it failed. The session
 * probe issues the CSRF cookie, so it runs first when the browser has none. `handle`
 * turns the response into a result, and may throw to report a failure.
 */
async function write<T>(
  signal: AbortSignal,
  options: WriteOptions,
  init: { method: string; body: string },
  handle: (response: Response) => Promise<T | null>,
): Promise<T | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, options.timeoutMs ?? CASE_TIMEOUT_MS);
  signal.addEventListener("abort", abort, { once: true });
  const cookie = options.cookie ?? (() => document.cookie);
  try {
    let token = readCsrfToken(cookie());
    if (!token) {
      await fetchSession(controller.signal);
      token = readCsrfToken(cookie());
    }
    if (!token) return null;

    const response = await fetch(CASE_URL, {
      method: init.method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRFToken": token,
      },
      body: init.body,
      signal: controller.signal,
    });
    return await handle(response);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export async function startCase(
  signal: AbortSignal,
  options: WriteOptions & { replace?: boolean } = {},
): Promise<StartResult> {
  const result = await write<StartResult>(
    signal,
    options,
    { method: "POST", body: JSON.stringify(options.replace ? { replace: true } : {}) },
    async (response) => {
      if (response.status === 429) return { kind: "throttled" };
      if (response.status === 409) {
        const existing = parseCase(await response.json());
        return existing ? { kind: "exists", case: existing } : null;
      }
      if (!response.ok) return null;
      const started = parseCase(await response.json());
      return started ? { kind: "started", case: started } : null;
    },
  );
  return result ?? { kind: "failed" };
}

/** Stores the madhab on the case this tab is showing. One attempt; never throws. */
export async function setMadhab(
  signal: AbortSignal,
  madhab: MadhabId,
  /** Required: it is what lets the server refuse a write from a tab on a replaced case. */
  caseId: string,
  options: WriteOptions = {},
): Promise<MadhabResult> {
  const result = await write<MadhabResult>(
    signal,
    options,
    { method: "PATCH", body: JSON.stringify({ madhab, case_id: caseId }) },
    async (response) => {
      if (response.status === 429) return { kind: "throttled" };
      if (response.status === 404) return { kind: "gone" };
      if (response.status === 409) {
        const live = parseCase(await response.json());
        return live ? { kind: "replaced", case: live } : null;
      }
      if (!response.ok) return null;
      const updated = parseCase(await response.json());
      return updated ? { kind: "updated", case: updated } : null;
    },
  );
  return result ?? { kind: "failed" };
}

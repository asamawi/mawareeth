import { fetchSession } from "./session.ts";

export type Case = {
  id: string;
  started_at: string;
};

export type StartResult =
  | { kind: "started"; case: Case }
  /** A case already exists and the visitor has not chosen to replace it. */
  | { kind: "exists"; case: Case }
  | { kind: "throttled" }
  | { kind: "failed" };

export const CASE_TIMEOUT_MS = 10_000;

const CASE_URL = "/api/v1/case/";

function isCase(value: unknown): value is Case {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Case).id === "string" &&
    typeof (value as Case).started_at === "string"
  );
}

function parseCase(body: unknown): Case | null {
  const value =
    typeof body === "object" && body !== null ? (body as { case?: unknown }).case : undefined;
  if (value === null) return null;
  if (!isCase(value)) throw new Error("Case endpoint returned an unexpected body");
  return { id: value.id, started_at: value.started_at };
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

/**
 * Makes exactly one write attempt and never throws. The session probe issues the CSRF
 * cookie, so it runs first when the browser has none.
 */
export async function startCase(
  signal: AbortSignal,
  options: { replace?: boolean; timeoutMs?: number; cookie?: () => string } = {},
): Promise<StartResult> {
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
    if (!token) return { kind: "failed" };

    const response = await fetch(CASE_URL, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRFToken": token,
      },
      body: JSON.stringify(options.replace ? { replace: true } : {}),
      signal: controller.signal,
    });
    if (response.status === 429) return { kind: "throttled" };
    if (response.status === 409) {
      const existing = parseCase(await response.json());
      return existing ? { kind: "exists", case: existing } : { kind: "failed" };
    }
    if (!response.ok) return { kind: "failed" };
    const started = parseCase(await response.json());
    return started ? { kind: "started", case: started } : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

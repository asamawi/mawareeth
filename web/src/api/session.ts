export type Session = {
  authenticated: boolean;
};

/** Rejects when the API cannot be reached or does not answer with a session. */
export async function fetchSession(signal: AbortSignal): Promise<Session> {
  const response = await fetch("/api/v1/session/", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Session probe failed with status ${response.status}`);
  }
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Session).authenticated !== "boolean"
  ) {
    throw new Error("Session probe returned an unexpected body");
  }
  return { authenticated: (body as Session).authenticated };
}

export type ProbeResult = "connected" | "unavailable";

export const PROBE_TIMEOUT_MS = 10_000;

/** Makes exactly one attempt: any failure or timeout is reported, never retried or thrown. */
export async function probeSession(
  signal: AbortSignal,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<ProbeResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, timeoutMs);
  signal.addEventListener("abort", abort, { once: true });
  try {
    await fetchSession(controller.signal);
    return "connected";
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

/** Recovery from a script chunk that failed to load (a tab left open across a deploy, a flaky network). */

const CHUNK_MESSAGE =
  /Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

export const RELOAD_KEY = "mawareeth.chunk-reload-at";
export const RELOAD_WINDOW_MS = 30_000;

export function isChunkLoadError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  return (
    (typeof name === "string" && name === "ChunkLoadError") ||
    (typeof message === "string" && CHUNK_MESSAGE.test(message))
  );
}

/** True (and recorded) only when no automatic reload happened in the last 30 s; false if storage fails. */
export function shouldAutoReload(storage: Pick<Storage, "getItem" | "setItem"> | undefined, now: number): boolean {
  try {
    if (!storage) return false;
    const last = Number(storage.getItem(RELOAD_KEY));
    // A stored time in the future (clock skew) is stale: allow the reload and overwrite it.
    if (Number.isFinite(last) && last > 0 && last <= now && now - last < RELOAD_WINDOW_MS) return false;
    storage.setItem(RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

/** Reloads once for a chunk-load error; returns whether it did. */
export function reloadForChunkError(error: unknown): boolean {
  if (!isChunkLoadError(error)) return false;
  let storage: Storage | undefined;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = undefined;
  }
  if (!shouldAutoReload(storage, Date.now())) return false;
  window.location.reload();
  return true;
}

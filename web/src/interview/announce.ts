/**
 * One restrained polite status for the Interview: messages of four kinds are coalesced into a single
 * sentence spoken after a quiet period. A post replaces any pending message of the same kind and
 * restarts the timer; on expiry the pending parts are joined in a fixed order and cleared. The
 * timer is injected so the rules are testable. Posting never touches the request or the visual update.
 */
export type AnnounceKind = "action" | "zoom" | "preview" | "progress";

const ORDER: readonly AnnounceKind[] = ["action", "zoom", "preview", "progress"];

export const ANNOUNCE_DELAY = 800;

export function createCoalescer<T = ReturnType<typeof setTimeout>>(
  emit: (text: string) => void,
  schedule: (fn: () => void, ms: number) => T = setTimeout as unknown as (fn: () => void, ms: number) => T,
  cancel: (handle: T) => void = clearTimeout as unknown as (handle: T) => void,
  delay = ANNOUNCE_DELAY,
) {
  const pending = new Map<AnnounceKind, string>();
  let timer: T | undefined;
  let waiting = false;
  const stop = () => {
    if (waiting) cancel(timer as T);
    waiting = false;
  };
  return {
    post(kind: AnnounceKind, text: string) {
      pending.set(kind, text);
      stop();
      waiting = true;
      timer = schedule(() => {
        waiting = false;
        const sentence = ORDER.flatMap((k) => pending.get(k) ?? []).filter((part) => part !== "").join(" ");
        pending.clear();
        if (sentence !== "") emit(sentence);
      }, delay);
    },
    /** Drops the pending messages of these kinds, such as a request that is over. */
    drop(...kinds: AnnounceKind[]) {
      for (const kind of kinds) pending.delete(kind);
    },
    /** Drops everything pending, such as when the page goes away. */
    cancel() {
      stop();
      pending.clear();
    },
  };
}

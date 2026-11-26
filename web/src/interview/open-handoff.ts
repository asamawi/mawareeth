/**
 * A one-shot hand-off from My cases to the Interview, kept per tab: the working Case id the
 * visitor expects to land on after a successful Open or New Case. Storage errors are swallowed.
 */
const HANDOFF_KEY = "mawareeth.open-handoff";

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function writeOpenHandoff(caseId: string, storage?: () => Store): void {
  try {
    (storage ?? (() => sessionStorage))().setItem(HANDOFF_KEY, caseId);
  } catch {}
}

/** Reads and removes the hand-off; null when there is none or storage is unavailable. */
export function takeOpenHandoff(storage?: () => Store): string | null {
  try {
    const open = (storage ?? (() => sessionStorage))();
    const value = open.getItem(HANDOFF_KEY);
    open.removeItem(HANDOFF_KEY);
    return value === null || value === "" ? null : value;
  } catch {
    return null;
  }
}

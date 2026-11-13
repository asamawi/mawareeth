import { isMadhabId, MADHAB_IDS, type Case, type MadhabId } from "../api/case.ts";

export { MADHAB_IDS };
export type { MadhabId };

/** The project owner's chosen default (2026-11-06): the main school in Saudi Arabia. */
export const DEFAULT_MADHAB: MadhabId = "hanbali";

/**
 * A selection in progress, kept per tab so a language switch or reload continues it.
 * `madhab` is null until the visitor picks.
 */
export type Selection = { caseId: string; madhab: MadhabId | null };

export type SelectionStore = {
  get: () => Selection | null;
  set: (selection: Selection | null) => void;
};

const SELECTION_KEY = "mawareeth.madhab-selection";

/** Storage errors (blocked, full, private mode) are swallowed: the page works without it. */
export function selectionStore(storage?: () => Pick<Storage, "getItem" | "setItem" | "removeItem">): SelectionStore {
  const open = storage ?? (() => sessionStorage);
  return {
    get() {
      try {
        const parsed: unknown = JSON.parse(open().getItem(SELECTION_KEY) ?? "null");
        if (typeof parsed !== "object" || parsed === null) return null;
        const { caseId, madhab } = parsed as { caseId?: unknown; madhab?: unknown };
        if (typeof caseId !== "string") return null;
        if (madhab !== null && !isMadhabId(madhab)) return null;
        return { caseId, madhab };
      } catch {
        return null;
      }
    },
    set(selection) {
      try {
        if (selection) open().setItem(SELECTION_KEY, JSON.stringify(selection));
        else open().removeItem(SELECTION_KEY);
      } catch {}
    },
  };
}

/** The record, only when it belongs to this case. */
export function selectionFor(record: Selection | null, caseId: string): Selection | null {
  return record && record.caseId === caseId ? record : null;
}

/** An unsaved pick wins over the stored choice, which wins over the default. */
export function selectedMadhab(stored: MadhabId | null, picked: MadhabId | null): MadhabId {
  return picked ?? stored ?? DEFAULT_MADHAB;
}

/** The default notice shows only while nothing is stored and the visitor has not picked. */
export function showDefaultNotice(stored: MadhabId | null, picked: MadhabId | null): boolean {
  return stored === null && picked === null;
}

/** What the selector starts from for this case. */
export function initialPick(record: Selection | null, kase: Case): MadhabId | null {
  return selectionFor(record, kase.id)?.madhab ?? null;
}

import type { Case, MadhabId, MadhabResult, StartResult } from "../api/case.ts";
import { selectionFor, type SelectionStore } from "./madhabs.ts";

export type Action = "load" | "start" | "startOver" | "resume" | "choose";

/** A write that did not go through; the visitor's selection stays on screen. */
export type Notice = "throttled" | "failed";

export type StartedView = {
  name: "started";
  case: Case;
  resumed: boolean;
  /** The visitor opened the selector although a school is stored. */
  changing: boolean;
  notice: Notice | null;
  saving: boolean;
};

export type View =
  | { name: "loading" }
  | { name: "starting" }
  | { name: "none"; expired: boolean }
  | { name: "existing"; case: Case }
  | StartedView
  /** Over the limit: the visitor can re-check, and resume a case that is still valid. */
  | { name: "throttled"; resumable: Case | null }
  /** The same action can be tried again, one attempt per click. */
  | { name: "failed"; retry: Action; resumable: Case | null };

export type Deps = {
  fetchCase: (signal: AbortSignal) => Promise<Case | null>;
  startCase: (signal: AbortSignal, options: { replace: boolean }) => Promise<StartResult>;
  setMadhab: (signal: AbortSignal, madhab: MadhabId, caseId: string) => Promise<MadhabResult>;
  /** Whether this browser has seen a case before; the only way to tell expired from new. */
  seen: { get: () => boolean; set: (value: boolean) => void };
  /** The selection in progress in this tab. */
  selection: SelectionStore;
};

export type Screen =
  | "loading"
  | "starting"
  | "none"
  | "existing"
  | "selector"
  | "question"
  | "throttled"
  | "failed";

/** Which screen a view shows: a case with no school, or one being changed, shows the selector. */
export function screenOf(view: View): Screen {
  if (view.name !== "started") return view.name;
  return view.case.madhab === null || view.changing ? "selector" : "question";
}

/**
 * Whether to move focus when `next` replaces `previous`. Focus moves only when the screen
 * changes: never while a save is in flight or has failed, and never for an in-place edit
 * such as a pick or a notice being cleared, which would pull focus off the radio.
 */
export function shouldFocus(previous: View | null, next: View): boolean {
  if (next.name === "loading" || next.name === "starting") return false;
  if (next.name === "started") {
    if (next.saving || next.notice !== null) return false;
    if (previous?.name === "started" && previous.case.id === next.case.id) {
      return screenOf(previous) !== screenOf(next);
    }
  }
  return true;
}

/** Remembers the visitor's pick for this case and clears an earlier failure notice. */
export function pick(view: StartedView, madhab: MadhabId, store: SelectionStore): StartedView {
  if (view.saving) return view;
  store.set({ caseId: view.case.id, madhab });
  return view.notice === null ? view : { ...view, notice: null };
}

function started(kase: Case, resumed: boolean, changing = false): StartedView {
  return { name: "started", case: kase, resumed, changing, notice: null, saving: false };
}

/** What to show while the action is in flight. */
export function pendingView(action: Action, current?: View): View {
  if (action === "choose") {
    return current?.name === "started" ? { ...current, notice: null, saving: true } : { name: "loading" };
  }
  return action === "start" || action === "startOver" ? { name: "starting" } : { name: "loading" };
}

/** Opens the selector on the first question, with the current choice selected. */
export function openChange(view: StartedView, deps: Deps): StartedView {
  deps.selection.set({ caseId: view.case.id, madhab: null });
  return { ...view, changing: true, notice: null };
}

/** Closes the selector without writing anything. */
export function cancelChange(view: StartedView, deps: Deps): StartedView {
  deps.selection.set(null);
  return { ...view, changing: false, notice: null };
}

/**
 * Records that a selector is open, so a language switch or reload continues it. Every
 * started view goes through here; an existing record for the case is left alone.
 */
function settle(view: StartedView, deps: Deps): StartedView {
  if (screenOf(view) === "selector" && !selectionFor(deps.selection.get(), view.case.id)) {
    deps.selection.set({ caseId: view.case.id, madhab: null });
  }
  return view;
}

/** A page load or resume goes straight to the selector while one is in progress for the case. */
function startedFor(found: Case, resumed: boolean, deps: Deps): StartedView {
  const inProgress = selectionFor(deps.selection.get(), found.id) !== null;
  return settle(started(found, resumed, inProgress), deps);
}

/**
 * Runs one action and settles on a view; it never throws. It makes one attempt per call,
 * except that a load which finds no case and nothing seen before reads once, then starts once.
 * `existing` is the case the visitor currently has on screen, if any. A choose needs the
 * `choice`: the school and the started view it was made from.
 */
export async function runAction(
  action: Action,
  signal: AbortSignal,
  deps: Deps,
  existing: Case | null = null,
  choice?: { madhab: MadhabId; from: StartedView },
): Promise<View> {
  if (action === "choose") {
    if (!choice) return { name: "failed", retry: "load", resumable: existing };
    return choose(choice.madhab, choice.from, signal, deps);
  }

  if (action === "load" || action === "resume") {
    let found: Case | null;
    try {
      found = await deps.fetchCase(signal);
    } catch {
      return { name: "failed", retry: action, resumable: null };
    }
    if (found) {
      deps.seen.set(true);
      if (action === "resume") return startedFor(found, true, deps);
      // A selection in progress in this tab continues without the resume prompt.
      return selectionFor(deps.selection.get(), found.id)
        ? startedFor(found, found.madhab !== null, deps)
        : { name: "existing", case: found };
    }
    // The notice shows once: the flag is cleared as soon as it has been used.
    const expired = deps.seen.get();
    if (expired) deps.seen.set(false);
    deps.selection.set(null);
    // Arriving from "start a case" with nothing yet: go straight on to start one. An
    // expired case waits for the visitor's choice, and a resume never starts anything.
    if (expired || action === "resume") return { name: "none", expired };
    action = "start";
  }

  const result = await deps.startCase(signal, { replace: action === "startOver" });
  switch (result.kind) {
    case "started":
      deps.seen.set(true);
      deps.selection.set(null);
      return settle(started(result.case, false), deps);
    case "exists":
      deps.seen.set(true);
      return { name: "existing", case: result.case };
    case "throttled":
      return { name: "throttled", resumable: existing };
    default:
      return { name: "failed", retry: action, resumable: existing };
  }
}

async function choose(
  madhab: MadhabId,
  from: StartedView,
  signal: AbortSignal,
  deps: Deps,
): Promise<View> {
  // Continuing with the stored school selected writes nothing.
  if (from.case.madhab === madhab) {
    deps.selection.set(null);
    return { ...from, changing: false, notice: null, saving: false };
  }
  const result = await deps.setMadhab(signal, madhab, from.case.id);
  switch (result.kind) {
    case "updated":
      deps.selection.set(null);
      return { ...started(result.case, from.resumed), changing: false };
    case "gone": {
      deps.selection.set(null);
      deps.seen.set(false);
      return { name: "none", expired: true };
    }
    case "replaced":
      deps.selection.set(null);
      deps.seen.set(true);
      return { name: "existing", case: result.case };
    default:
      return { ...from, notice: result.kind, saving: false };
  }
}

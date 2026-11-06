import type { Case, StartResult } from "../api/case.ts";

export type Action = "load" | "start" | "startOver" | "resume";

export type View =
  | { name: "loading" }
  | { name: "starting" }
  | { name: "none"; expired: boolean }
  | { name: "existing"; case: Case }
  | { name: "started"; case: Case; resumed: boolean }
  /** Over the limit: the visitor can re-check, and resume a case that is still valid. */
  | { name: "throttled"; resumable: Case | null }
  /** The same action can be tried again, one attempt per click. */
  | { name: "failed"; retry: Action; resumable: Case | null };

export type Deps = {
  fetchCase: (signal: AbortSignal) => Promise<Case | null>;
  startCase: (signal: AbortSignal, options: { replace: boolean }) => Promise<StartResult>;
  /** Whether this browser has seen a case before; the only way to tell expired from new. */
  seen: { get: () => boolean; set: (value: boolean) => void };
};

/** What to show while the action is in flight. */
export function pendingView(action: Action): View {
  return action === "start" || action === "startOver" ? { name: "starting" } : { name: "loading" };
}

/**
 * Runs one action and settles on a view; it never throws. It makes one attempt per call,
 * except that a load which finds no case and nothing seen before reads once, then starts once.
 * `existing` is the case the visitor currently has on screen, if any.
 */
export async function runAction(
  action: Action,
  signal: AbortSignal,
  deps: Deps,
  existing: Case | null = null,
): Promise<View> {
  if (action === "load" || action === "resume") {
    let found: Case | null;
    try {
      found = await deps.fetchCase(signal);
    } catch {
      return { name: "failed", retry: action, resumable: null };
    }
    if (found) {
      deps.seen.set(true);
      return action === "resume"
        ? { name: "started", case: found, resumed: true }
        : { name: "existing", case: found };
    }
    // The notice shows once: the flag is cleared as soon as it has been used.
    const expired = deps.seen.get();
    if (expired) deps.seen.set(false);
    // Arriving from "start a case" with nothing yet: go straight on to start one. An
    // expired case waits for the visitor's choice, and a resume never starts anything.
    if (expired || action === "resume") return { name: "none", expired };
    action = "start";
  }

  const result = await deps.startCase(signal, { replace: action === "startOver" });
  switch (result.kind) {
    case "started":
      deps.seen.set(true);
      return { name: "started", case: result.case, resumed: false };
    case "exists":
      deps.seen.set(true);
      return { name: "existing", case: result.case };
    case "throttled":
      return { name: "throttled", resumable: existing };
    default:
      return { name: "failed", retry: action, resumable: existing };
  }
}

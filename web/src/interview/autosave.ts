import type { Case } from "@/api/case";
import { fetchSession, PROBE_TIMEOUT_MS } from "@/api/session";
import { autosaveCase, type AutosaveResult, type SaveConflict } from "@/api/saved-cases";

/**
 * The autosave coordinator of an opened Saved case (story 10.5). Framework-free, so fake timers can drive it.
 *
 * It follows one Case at a time, and only a Case that has a Saved case link: a never-saved Case is never tracked.
 * Accepted changes are debounced; at most one request is in flight; the newest revision is sent next; and
 * "saved" is claimed only when the answer covers the latest accepted revision. It never retries by itself.
 */
export const DEBOUNCE_MS = 1000;

export type AutosaveState =
  | "idle" // linked and covered, nothing to say
  | "unsaved" // linked, behind on arrival, nothing sent yet
  | "saving"
  | "saved"
  | "needs-heirs"
  | "needs-school"
  | "failed"
  | "signed-out"
  | "unavailable"
  | "conflict";

export type AutosaveSnapshot = { caseId: string | null; state: AutosaveState; conflict: SaveConflict | null; seq: number };
export type FlushResult = "saved" | "unsaved";

export type AutosaveDeps = {
  send: (caseId: string, revision: number) => Promise<AutosaveResult>;
  /** After a 403: whether the session probe says the visitor is signed out. */
  signedOut: () => Promise<boolean>;
  setTimer: (run: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
};

const NONE: AutosaveSnapshot = { caseId: null, state: "idle", conflict: null, seq: 0 };

export class Autosave {
  private caseId: string | null = null;
  private latest = 0;
  private lastSaved = 0;
  /** The newest revision a request was started for. */
  private sent = 0;
  private timer: unknown = null;
  private flight: Promise<void> | null = null;
  private state: AutosaveState = "idle";
  private conflict: SaveConflict | null = null;
  private seq = 0;
  private snapshot: AutosaveSnapshot = NONE;
  private readonly listeners = new Set<() => void>();

  private readonly deps: AutosaveDeps;

  constructor(deps: AutosaveDeps) {
    this.deps = deps;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): AutosaveSnapshot => this.snapshot;

  tracks(caseId: string): boolean {
    return this.caseId === caseId;
  }

  /** Whether the tracked Case has a revision the Saved case does not hold. */
  isUnsaved(caseId: string): boolean {
    return this.caseId === caseId && this.lastSaved < this.latest;
  }

  /**
   * A Case read from the server. A linked Case is tracked from its stored revisions; anything else
   * (never saved, or unknown) stops all tracking, so it can never be autosaved.
   */
  attach(value: Case | null): void {
    const saved = value?.saved;
    if (!value || !saved || value.revision === null) {
      this.detach();
      return;
    }
    const stored = saved.revision ?? 0;
    if (this.caseId === value.id) {
      this.lastSaved = Math.max(this.lastSaved, stored);
      if (value.revision > this.latest) this.notify(value.id, value.revision);
      else if (this.lastSaved >= this.latest && this.state !== "saving") this.set("idle");
      return;
    }
    this.cancelTimer();
    this.caseId = value.id;
    this.latest = value.revision;
    this.lastSaved = stored;
    this.sent = stored;
    this.conflict = null;
    this.set(this.lastSaved >= this.latest ? "idle" : "unsaved");
  }

  detach(): void {
    this.cancelTimer();
    this.caseId = null;
    this.latest = this.lastSaved = this.sent = 0;
    this.conflict = null;
    this.state = "idle";
    this.publish();
  }

  /** An accepted command, Undo, School change or name write moved the Case to `revision`. */
  notify(caseId: string, revision: number): void {
    if (this.caseId !== caseId) return;
    if (revision > this.latest) this.latest = revision;
    // Autosave has stopped for this Case, or waits for a conflict choice: the revision is only recorded.
    if (this.state === "unavailable" || this.state === "conflict") return;
    this.set("saving");
    if (this.flight) return;
    this.cancelTimer();
    this.timer = this.deps.setTimer(() => { this.timer = null; void this.start(); }, DEBOUNCE_MS);
  }

  /** Retry after a failure: sends the newest revision now. */
  retry(): Promise<void> {
    return this.start();
  }

  /**
   * After "Save as a new case": the new Saved case holds the Case at `revision`, so autosave resumes from there.
   */
  relinked(caseId: string, revision: number): void {
    if (this.caseId !== caseId) return;
    this.lastSaved = Math.max(this.lastSaved, revision);
    this.sent = Math.max(this.sent, revision);
    this.conflict = null;
    if (this.lastSaved >= this.latest) this.set("saved");
    else { this.state = "idle"; this.notify(caseId, this.latest); }
  }

  /**
   * Sends a pending, debounced or failed revision now (one attempt) and waits for any request in flight.
   * "unsaved" when the newest revision is not held by the Saved case afterwards (a conflict included).
   */
  async flush(): Promise<FlushResult> {
    if (this.caseId === null) return "saved";
    this.cancelTimer();
    let tried = false;
    for (let round = 0; round < 3; round++) {
      if (this.flight) { await this.flight; tried = true; }
      if (this.caseId === null || this.lastSaved >= this.latest) return "saved";
      if (this.state === "conflict" || this.state === "unavailable" || this.state === "signed-out") return "unsaved";
      if ((this.state === "needs-heirs" || this.state === "needs-school" || tried) && this.sent >= this.latest) return "unsaved";
      await this.start();
      tried = true;
    }
    return "unsaved";
  }

  private start(): Promise<void> {
    this.cancelTimer();
    if (this.flight) return this.flight;
    if (this.caseId === null || this.state === "conflict" || this.state === "unavailable") return Promise.resolve();
    const flight = this.drive().finally(() => { if (this.flight === flight) this.flight = null; });
    this.flight = flight;
    return flight;
  }

  private async drive(): Promise<void> {
    for (;;) {
      const caseId = this.caseId;
      if (caseId === null) return;
      const target = this.latest;
      this.sent = target;
      this.set("saving");
      let result: AutosaveResult;
      try { result = await this.deps.send(caseId, target); } catch { result = { kind: "failed" }; }
      // The Case was replaced while the request was out: whatever it said is not about this Case any more.
      if (this.caseId !== caseId) return;
      if (!(await this.settle(result, target))) return;
      this.cancelTimer();
    }
  }

  /** Records the outcome. True when a newer revision must be sent right away. */
  private async settle(result: AutosaveResult, target: number): Promise<boolean> {
    switch (result.kind) {
      case "saved":
        this.lastSaved = Math.max(this.lastSaved, result.caseRevision);
        if (this.lastSaved >= this.latest) { this.set("saved"); return false; }
        if (this.latest > target) return true;
        this.set("failed");
        return false;
      case "stale":
        if (result.caseRevision !== null && result.caseRevision > this.latest) this.latest = result.caseRevision;
        if (this.latest > target) return true;
        this.set("failed");
        return false;
      case "unavailable":
        this.set("unavailable");
        return false;
      case "conflict":
        this.conflict = result.conflict;
        this.set("conflict");
        return false;
      case "incomplete":
        this.set("needs-heirs");
        return this.latest > target;
      case "schoolRequired":
        this.set("needs-school");
        return this.latest > target;
      case "forbidden": {
        let out = false;
        try { out = await this.deps.signedOut(); } catch { out = false; }
        this.set(out ? "signed-out" : "failed");
        return !out && this.latest > target;
      }
      default:
        if (this.latest > target) return true;
        this.set("failed");
        return false;
    }
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  private set(state: AutosaveState): void {
    this.state = state;
    this.publish();
  }

  private publish(): void {
    this.seq += 1;
    this.snapshot = { caseId: this.caseId, state: this.state, conflict: this.conflict, seq: this.seq };
    for (const listener of [...this.listeners]) listener();
  }
}

/** The one coordinator of the page, shared by the Interview, My cases, Full results and the site navigation. */
export const autosave = new Autosave({
  send: (caseId, revision) => autosaveCase(new AbortController().signal, caseId, revision),
  signedOut: async () => {
    try { return !(await fetchSession(AbortSignal.timeout(PROBE_TIMEOUT_MS))).authenticated; } catch { return false; }
  },
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Case } from "@/api/case";
import type { AutosaveResult } from "@/api/saved-cases";
import { Autosave, DEBOUNCE_MS } from "./autosave.ts";

type Call = { caseId: string; revision: number; settle: (result: AutosaveResult) => void };

/** A coordinator on a fake clock whose requests wait until the test answers them. */
function setup(signedOut = false) {
  let now = 0;
  let next = 1;
  const timers = new Map<number, { at: number; run: () => void }>();
  const calls: Call[] = [];
  const probes: number[] = [];
  const coordinator = new Autosave({
    send: (caseId, revision) => new Promise((resolve) => { calls.push({ caseId, revision, settle: resolve }); }),
    signedOut: async () => { probes.push(now); return signedOut; },
    setTimer: (run, ms) => { const id = next++; timers.set(id, { at: now + ms, run }); return id; },
    clearTimer: (handle) => { timers.delete(handle as number); },
  });
  const tick = async (ms: number) => {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.run(); }
    await flushMicrotasks();
  };
  return { coordinator, calls, probes, tick, timers: () => timers.size };
}

const flushMicrotasks = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const linked = (revision: number, saved: number | null = revision, id = "c1"): Case => ({ id, revision, saved: { revision: saved } }) as Case;
const ok = (caseRevision: number): AutosaveResult => ({ kind: "saved", caseRevision, revision: 2 });

test("one request follows the last of several changes after the debounce, and Saved needs the same revision", async () => {
  const { coordinator, calls, tick } = setup();
  coordinator.attach(linked(7));
  assert.equal(coordinator.getSnapshot().state, "idle");
  coordinator.notify("c1", 8);
  await tick(DEBOUNCE_MS - 1);
  coordinator.notify("c1", 9);
  await tick(DEBOUNCE_MS - 1);
  assert.equal(calls.length, 0);
  assert.equal(coordinator.getSnapshot().state, "saving");
  await tick(1);
  assert.deepEqual(calls.map((c) => [c.caseId, c.revision]), [["c1", 9]]);
  calls[0].settle(ok(9));
  await flushMicrotasks();
  assert.equal(coordinator.getSnapshot().state, "saved");
  assert.equal(calls.length, 1);
});

test("an edit during flight sends only the newest revision next and Saved waits for it", async () => {
  const { coordinator, calls, tick } = setup();
  coordinator.attach(linked(7));
  coordinator.notify("c1", 8);
  await tick(DEBOUNCE_MS);
  coordinator.notify("c1", 9);
  coordinator.notify("c1", 10);
  await tick(DEBOUNCE_MS * 3);
  assert.equal(calls.length, 1, "single flight");
  calls[0].settle(ok(8));
  await flushMicrotasks();
  assert.equal(coordinator.getSnapshot().state, "saving", "a stale 200 is progress, not Saved");
  assert.deepEqual(calls.map((c) => c.revision), [8, 10]);
  calls[1].settle(ok(10));
  await flushMicrotasks();
  assert.equal(coordinator.getSnapshot().state, "saved");
});

test("a stale answer is never Saved and the newest revision is sent next", async () => {
  const { coordinator, calls, tick } = setup();
  coordinator.attach(linked(7));
  coordinator.notify("c1", 8);
  await tick(DEBOUNCE_MS);
  calls[0].settle({ kind: "stale", caseRevision: 9 });
  await flushMicrotasks();
  assert.deepEqual(calls.map((c) => c.revision), [8, 9]);
  assert.equal(coordinator.getSnapshot().state, "saving");
  calls[1].settle(ok(9));
  await flushMicrotasks();
  assert.equal(coordinator.getSnapshot().state, "saved");
});

test("a stale answer that names nothing newer is a failure and does not loop", async () => {
  const { coordinator, calls, tick } = setup();
  coordinator.attach(linked(7));
  coordinator.notify("c1", 8);
  await tick(DEBOUNCE_MS);
  calls[0].settle({ kind: "stale", caseRevision: 8 });
  await flushMicrotasks();
  assert.equal(calls.length, 1);
  assert.equal(coordinator.getSnapshot().state, "failed");
});

test("a never-saved Case is never autosaved", async () => {
  const { coordinator, calls, tick, timers } = setup();
  coordinator.attach({ id: "c1", revision: 3, saved: null } as Case);
  coordinator.notify("c1", 4);
  coordinator.attach({ id: "c1", revision: 4 } as Case);
  coordinator.notify("c1", 5);
  await tick(DEBOUNCE_MS * 5);
  assert.equal(calls.length, 0);
  assert.equal(timers(), 0);
  assert.equal(coordinator.getSnapshot().caseId, null);
  assert.equal(await coordinator.flush(), "saved");
});

test("a failure is shown once, never retried by itself, and the next change or Retry sends again", async () => {
  const { coordinator, calls, tick } = setup();
  coordinator.attach(linked(7));
  coordinator.notify("c1", 8);
  await tick(DEBOUNCE_MS);
  calls[0].settle({ kind: "failed" });
  await flushMicrotasks();
  assert.equal(coordinator.getSnapshot().state, "failed");
  await tick(DEBOUNCE_MS * 10);
  assert.equal(calls.length, 1, "no automatic retry");
  void coordinator.retry();
  await flushMicrotasks();
  assert.deepEqual(calls.map((c) => c.revision), [8, 8]);
  calls[1].settle({ kind: "failed" });
  await flushMicrotasks();
  coordinator.notify("c1", 9);
  await tick(DEBOUNCE_MS);
  assert.deepEqual(calls.map((c) => c.revision), [8, 8, 9]);
  calls[2].settle(ok(9));
  await flushMicrotasks();
  assert.equal(coordinator.getSnapshot().state, "saved");
});

test("no heirs and no school keep the edits and try again on the next accepted change", async () => {
  const { coordinator, calls, tick } = setup();
  coordinator.attach(linked(7));
  coordinator.notify("c1", 8);
  await tick(DEBOUNCE_MS);
  calls[0].settle({ kind: "incomplete" });
  await flushMicrotasks();
  assert.equal(coordinator.getSnapshot().state, "needs-heirs");
  coordinator.notify("c1", 9);
  await tick(DEBOUNCE_MS);
  calls[1].settle({ kind: "schoolRequired" });
  await flushMicrotasks();
  assert.equal(coordinator.getSnapshot().state, "needs-school");
  coordinator.notify("c1", 10);
  await tick(DEBOUNCE_MS);
  assert.equal(calls.length, 3);
  calls[2].settle(ok(10));
  await flushMicrotasks();
  assert.equal(coordinator.getSnapshot().state, "saved");
});

test("unavailable stops autosave for the Case", async () => {
  const { coordinator, calls, tick } = setup();
  coordinator.attach(linked(7));
  coordinator.notify("c1", 8);
  await tick(DEBOUNCE_MS);
  calls[0].settle({ kind: "unavailable" });
  await flushMicrotasks();
  assert.equal(coordinator.getSnapshot().state, "unavailable");
  coordinator.notify("c1", 9);
  await tick(DEBOUNCE_MS * 3);
  assert.equal(calls.length, 1);
  assert.equal(await coordinator.flush(), "unsaved");
});

test("a conflict pauses sending while edits continue, and relinking resumes from the new row", async () => {
  const { coordinator, calls, tick } = setup();
  coordinator.attach(linked(7));
  coordinator.notify("c1", 8);
  await tick(DEBOUNCE_MS);
  const conflict = { code: "saved_case_conflict", savedId: 4, savedName: "n", savedRevision: 5, workingCaseId: "c1", workingRevision: 8 } as const;
  calls[0].settle({ kind: "conflict", conflict });
  await flushMicrotasks();
  assert.equal(coordinator.getSnapshot().state, "conflict");
  assert.deepEqual(coordinator.getSnapshot().conflict, conflict);
  coordinator.notify("c1", 9);
  await tick(DEBOUNCE_MS * 3);
  assert.equal(calls.length, 1);
  assert.equal(coordinator.getSnapshot().state, "conflict");
  assert.equal(await coordinator.flush(), "unsaved");
  coordinator.relinked("c1", 9);
  assert.equal(coordinator.getSnapshot().state, "saved");
  assert.equal(coordinator.getSnapshot().conflict, null);
});

test("a 403 with the probe saying signed out shows signed-out; otherwise it is a failure", async () => {
  for (const out of [true, false]) {
    const { coordinator, calls, probes, tick } = setup(out);
    coordinator.attach(linked(7));
    coordinator.notify("c1", 8);
    await tick(DEBOUNCE_MS);
    calls[0].settle({ kind: "forbidden" });
    await flushMicrotasks();
    assert.equal(probes.length, 1);
    assert.equal(coordinator.getSnapshot().state, out ? "signed-out" : "failed");
  }
});

test("flush sends a debounced revision now and resolves saved or unsaved", async () => {
  const { coordinator, calls, tick, timers } = setup();
  coordinator.attach(linked(7));
  coordinator.notify("c1", 8);
  const done = coordinator.flush();
  await flushMicrotasks();
  assert.equal(timers(), 0, "the debounce is spent");
  assert.deepEqual(calls.map((c) => c.revision), [8]);
  calls[0].settle(ok(8));
  assert.equal(await done, "saved");
  await tick(DEBOUNCE_MS * 2);
  assert.equal(calls.length, 1);
  // Nothing pending: no request.
  assert.equal(await coordinator.flush(), "saved");
  assert.equal(calls.length, 1);
});

test("flush awaits a request in flight, then sends the newest revision once", async () => {
  const { coordinator, calls } = setup();
  coordinator.attach(linked(7));
  coordinator.notify("c1", 8);
  const first = coordinator.flush();
  await flushMicrotasks();
  coordinator.notify("c1", 9);
  const second = coordinator.flush();
  calls[0].settle(ok(8));
  await flushMicrotasks();
  assert.deepEqual(calls.map((c) => c.revision), [8, 9]);
  calls[1].settle(ok(9));
  assert.deepEqual(await Promise.all([first, second]), ["saved", "saved"]);
});

test("flush makes one attempt at a failed revision and then says unsaved", async () => {
  const { coordinator, calls, tick } = setup();
  coordinator.attach(linked(7));
  coordinator.notify("c1", 8);
  await tick(DEBOUNCE_MS);
  calls[0].settle({ kind: "failed" });
  await flushMicrotasks();
  const done = coordinator.flush();
  await flushMicrotasks();
  assert.equal(calls.length, 2);
  calls[1].settle({ kind: "failed" });
  assert.equal(await done, "unsaved");
  assert.equal(calls.length, 2);
});

test("a Case that is behind on arrival is unsaved and flush sends it", async () => {
  const { coordinator, calls } = setup();
  coordinator.attach(linked(8, 5));
  assert.equal(coordinator.getSnapshot().state, "unsaved");
  assert.equal(coordinator.isUnsaved("c1"), true);
  const done = coordinator.flush();
  await flushMicrotasks();
  assert.deepEqual(calls.map((c) => c.revision), [8]);
  calls[0].settle(ok(8));
  assert.equal(await done, "saved");
  assert.equal(coordinator.isUnsaved("c1"), false);
});

test("a different Case replaces the tracked one and a late answer for the old one is ignored", async () => {
  const { coordinator, calls, tick } = setup();
  coordinator.attach(linked(7));
  coordinator.notify("c1", 8);
  await tick(DEBOUNCE_MS);
  coordinator.attach(linked(2, 2, "c2"));
  calls[0].settle({ kind: "failed" });
  await flushMicrotasks();
  assert.equal(coordinator.getSnapshot().caseId, "c2");
  assert.equal(coordinator.getSnapshot().state, "idle");
});

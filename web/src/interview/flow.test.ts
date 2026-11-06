import assert from "node:assert/strict";
import { test } from "node:test";

import type { Case, StartResult } from "../api/case.ts";
import { pendingView, runAction, type Deps } from "./flow.ts";

const CASE: Case = { id: "abc12345", started_at: "2026-11-06T10:00:00Z" };
const NEW_CASE: Case = { id: "def67890", started_at: "2026-11-06T11:00:00Z" };
const signal = new AbortController().signal;

function deps(options: {
  read?: () => Promise<Case | null>;
  start?: (replace: boolean) => StartResult;
  seen?: boolean;
}) {
  const log = { reads: 0, starts: [] as boolean[], seen: options.seen ?? false };
  const value: Deps = {
    fetchCase: async () => {
      log.reads += 1;
      return (options.read ?? (async () => null))();
    },
    startCase: async (_signal, { replace }) => {
      log.starts.push(replace);
      return (options.start ?? (() => ({ kind: "failed" }) as StartResult))(replace);
    },
    seen: { get: () => log.seen, set: (next) => (log.seen = next) },
  };
  return { value, log };
}

test("New visitor: one read, then one start that does not replace, ending on started", async () => {
  const { value, log } = deps({ start: () => ({ kind: "started", case: CASE }) });
  assert.deepEqual(await runAction("load", signal, value), { name: "started", case: CASE, resumed: false });
  assert.equal(log.reads, 1);
  assert.deepEqual(log.starts, [false]);
  assert.equal(log.seen, true);
});

test("New visitor: a failed auto-start offers a retry of start", async () => {
  const { value, log } = deps({ start: () => ({ kind: "failed" }) });
  assert.deepEqual(await runAction("load", signal, value), { name: "failed", retry: "start", resumable: null });
  assert.equal(log.reads, 1);
  assert.deepEqual(log.starts, [false]);
});

test("New visitor: a throttled auto-start shows throttled with nothing resumable", async () => {
  const { value } = deps({ start: () => ({ kind: "throttled" }) });
  assert.deepEqual(await runAction("load", signal, value), { name: "throttled", resumable: null });
});

test("New visitor: a case that appears meanwhile is offered, not replaced", async () => {
  const { value, log } = deps({ start: () => ({ kind: "exists", case: CASE }) });
  assert.deepEqual(await runAction("load", signal, value), { name: "existing", case: CASE });
  assert.deepEqual(log.starts, [false]);
});

test("Start: a new case is shown and remembered, and never replaces", async () => {
  const { value, log } = deps({ start: () => ({ kind: "started", case: CASE }) });
  assert.deepEqual(await runAction("start", signal, value), { name: "started", case: CASE, resumed: false });
  assert.deepEqual(log.starts, [false]);
  assert.equal(log.seen, true);
});

test("Returning: a live case offers resume or start over and is remembered", async () => {
  const { value, log } = deps({ read: async () => CASE });
  assert.deepEqual(await runAction("load", signal, value), { name: "existing", case: CASE });
  assert.equal(log.seen, true);
});

test("Returning: resume re-reads the case and says it was resumed", async () => {
  const { value, log } = deps({ read: async () => CASE });
  assert.deepEqual(await runAction("resume", signal, value, CASE), {
    name: "started",
    case: CASE,
    resumed: true,
  });
  assert.equal(log.reads, 1);
  assert.deepEqual(log.starts, []);
});

test("Expired: the notice shows once, then the flag is cleared", async () => {
  const { value, log } = deps({ seen: true, start: () => ({ kind: "started", case: CASE }) });
  assert.deepEqual(await runAction("load", signal, value), { name: "none", expired: true });
  assert.equal(log.seen, false);
  assert.deepEqual(log.starts, [], "an expired case never starts by itself");
  assert.equal((await runAction("load", signal, value)).name, "started");
});

test("Expired: resuming a case that has gone leads to the expired view", async () => {
  const { value, log } = deps({ seen: true, read: async () => null });
  assert.deepEqual(await runAction("resume", signal, value, CASE), { name: "none", expired: true });
  assert.equal(log.seen, false);
  assert.deepEqual(log.starts, []);
});

test("Resume that cannot reach the API offers a retry of the same action", async () => {
  const { value } = deps({
    read: async () => {
      throw new TypeError("fetch failed");
    },
  });
  assert.deepEqual(await runAction("resume", signal, value, CASE), {
    name: "failed",
    retry: "resume",
    resumable: null,
  });
});

test("Start over replaces, and only start over does", async () => {
  const { value, log } = deps({ start: () => ({ kind: "started", case: NEW_CASE }) });
  assert.deepEqual(await runAction("startOver", signal, value, CASE), {
    name: "started",
    case: NEW_CASE,
    resumed: false,
  });
  await runAction("start", signal, value);
  assert.deepEqual(log.starts, [true, false]);
});

test("A start that finds a case already there offers it, and remembers it", async () => {
  const { value, log } = deps({ start: () => ({ kind: "exists", case: CASE }) });
  assert.deepEqual(await runAction("start", signal, value), { name: "existing", case: CASE });
  assert.equal(log.seen, true);
});

test("Over the limit: the visitor can re-check and keeps the case they had", async () => {
  const { value, log } = deps({ start: () => ({ kind: "throttled" }) });
  assert.deepEqual(await runAction("startOver", signal, value, CASE), { name: "throttled", resumable: CASE });
  assert.deepEqual(await runAction("start", signal, value), { name: "throttled", resumable: null });
  assert.equal(log.seen, false);
});

test("API unreachable on load: retry the load, one attempt", async () => {
  const { value, log } = deps({
    read: async () => {
      throw new TypeError("fetch failed");
    },
  });
  assert.deepEqual(await runAction("load", signal, value), { name: "failed", retry: "load", resumable: null });
  assert.equal(log.reads, 1);
});

test("API unreachable on start over: retry the same action and keep resume", async () => {
  const { value, log } = deps({ start: () => ({ kind: "failed" }) });
  assert.deepEqual(await runAction("startOver", signal, value, CASE), {
    name: "failed",
    retry: "startOver",
    resumable: CASE,
  });
  assert.deepEqual(log.starts, [true]);
});

test("pending views match the kind of action", () => {
  assert.equal(pendingView("start").name, "starting");
  assert.equal(pendingView("startOver").name, "starting");
  assert.equal(pendingView("load").name, "loading");
  assert.equal(pendingView("resume").name, "loading");
});

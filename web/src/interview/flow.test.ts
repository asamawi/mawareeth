import assert from "node:assert/strict";
import { test } from "node:test";

import type { Case, MadhabResult, StartResult } from "../api/case.ts";
import {
  cancelChange,
  openChange,
  pick,
  pendingView,
  runAction,
  screenOf,
  shouldFocus,
  type Deps,
  type StartedView,
  type View,
} from "./flow.ts";
import type { Selection } from "./madhabs.ts";

const CASE: Case = { id: "abc12345", started_at: "2026-11-06T10:00:00Z", madhab: null };
const NEW_CASE: Case = { id: "def67890", started_at: "2026-11-06T11:00:00Z", madhab: null };
const signal = new AbortController().signal;

function startedOf(kase: Case, resumed: boolean, extra: Partial<StartedView> = {}): StartedView {
  return { name: "started", case: kase, resumed, changing: false, notice: null, saving: false, ...extra };
}

function deps(options: {
  read?: () => Promise<Case | null>;
  start?: (replace: boolean) => StartResult;
  seen?: boolean;
  choose?: (madhab: string, caseId: string) => MadhabResult;
  selection?: Selection | null;
}) {
  const log = {
    reads: 0,
    starts: [] as boolean[],
    seen: options.seen ?? false,
    chooses: [] as string[],
    chooseCaseIds: [] as string[],
    selection: options.selection ?? (null as Selection | null),
  };
  const value: Deps = {
    fetchCase: async () => {
      log.reads += 1;
      return (options.read ?? (async () => null))();
    },
    startCase: async (_signal, { replace }) => {
      log.starts.push(replace);
      return (options.start ?? (() => ({ kind: "failed" }) as StartResult))(replace);
    },
    setMadhab: async (_signal, madhab, caseId) => {
      log.chooses.push(madhab);
      log.chooseCaseIds.push(caseId);
      return (options.choose ?? (() => ({ kind: "failed" }) as MadhabResult))(madhab, caseId);
    },
    seen: { get: () => log.seen, set: (next) => (log.seen = next) },
    selection: { get: () => log.selection, set: (next) => (log.selection = next) },
  };
  return { value, log };
}

test("New visitor: one read, then one start that does not replace, ending on started", async () => {
  const { value, log } = deps({ start: () => ({ kind: "started", case: CASE }) });
  assert.deepEqual(await runAction("load", signal, value), startedOf(CASE, false));
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
  assert.deepEqual(await runAction("start", signal, value), startedOf(CASE, false));
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
  assert.deepEqual(await runAction("resume", signal, value, CASE), startedOf(CASE, true));
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
  assert.deepEqual(await runAction("startOver", signal, value, CASE), startedOf(NEW_CASE, false));
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

const CHOSEN: Case = { ...CASE, madhab: "hanafi" };
const SELECTOR = startedOf(CASE, false);
const QUESTION = startedOf(CHOSEN, true);

test("screens: a case with no school or one being changed shows the selector", () => {
  const table: [View, string][] = [
    [{ name: "loading" }, "loading"],
    [{ name: "none", expired: false }, "none"],
    [{ name: "existing", case: CASE }, "existing"],
    [SELECTOR, "selector"],
    [startedOf(CHOSEN, false), "question"],
    [startedOf(CHOSEN, false, { changing: true }), "selector"],
    [{ name: "throttled", resumable: null }, "throttled"],
    [{ name: "failed", retry: "load", resumable: null }, "failed"],
  ];
  for (const [view, screen] of table) assert.equal(screenOf(view), screen, JSON.stringify(view));
});

test("focus moves only when the screen changes, never for an in-place edit", () => {
  const failed = startedOf(CASE, false, { notice: "failed" });
  const saving = startedOf(CASE, false, { saving: true });
  const table: [View | null, View, boolean, string][] = [
    [null, SELECTOR, true, "first settled view"],
    [{ name: "loading" }, { name: "starting" }, false, "starting"],
    [SELECTOR, { name: "loading" }, false, "loading"],
    [{ name: "loading" }, SELECTOR, true, "loaded"],
    [{ name: "loading" }, { name: "none", expired: false }, true, "none"],
    [SELECTOR, saving, false, "saving"],
    [saving, failed, false, "failed save keeps focus on the form"],
    [failed, SELECTOR, false, "a pick clears the notice in place"],
    [SELECTOR, startedOf(CASE, false), false, "same screen, same state"],
    [saving, startedOf(CHOSEN, false), true, "saved: selector to first question"],
    [QUESTION, startedOf(CHOSEN, true, { changing: true }), true, "change opens the selector"],
    [startedOf(CHOSEN, true, { changing: true }), QUESTION, true, "cancel closes it"],
    [SELECTOR, startedOf(NEW_CASE, false), true, "another case"],
    [saving, { name: "none", expired: true }, true, "gone"],
  ];
  for (const [previous, next, expected, name] of table) {
    assert.equal(shouldFocus(previous, next), expected, name);
  }
});

test("pick writes the record for the current case and clears a failure notice", () => {
  const { value, log } = deps({});
  const failed = startedOf(CASE, false, { notice: "failed" });
  assert.deepEqual(pick(failed, "maliki", value.selection), SELECTOR);
  assert.deepEqual(log.selection, { caseId: CASE.id, madhab: "maliki" });
  assert.equal(pick(SELECTOR, "jafari", value.selection), SELECTOR, "no notice: same view");
  assert.deepEqual(log.selection, { caseId: CASE.id, madhab: "jafari" });
});

test("pick is ignored while a save is in flight", () => {
  const { value, log } = deps({});
  const saving = startedOf(CASE, false, { saving: true });
  assert.equal(pick(saving, "maliki", value.selection), saving);
  assert.equal(log.selection, null);
});

test("A failed or throttled start over keeps the unsaved selection of the live case", async () => {
  for (const kind of ["failed", "throttled"] as const) {
    const record = { caseId: CASE.id, madhab: "jafari" as const };
    const { value, log } = deps({ start: () => ({ kind }) as StartResult, selection: record });
    await runAction("startOver", signal, value, CASE);
    assert.deepEqual(log.selection, record, kind);
  }
});

test("a new case opens the selector and records it", async () => {
  const { value, log } = deps({ start: () => ({ kind: "started", case: CASE }) });
  await runAction("start", signal, value);
  assert.deepEqual(log.selection, { caseId: CASE.id, madhab: null });
});

test("Choose: the school is stored, the first question shows, and resumed is kept", async () => {
  for (const resumed of [true, false]) {
    const { value, log } = deps({
      choose: () => ({ kind: "updated", case: CHOSEN }),
      selection: { caseId: CASE.id, madhab: "hanafi" },
    });
    const from = startedOf(CASE, resumed);
    assert.deepEqual(
      await runAction("choose", signal, value, CASE, { madhab: "hanafi", from }),
      startedOf(CHOSEN, resumed),
    );
    assert.deepEqual(log.chooses, ["hanafi"]);
    assert.deepEqual(log.chooseCaseIds, [CASE.id], "the write names the case the tab is showing");
    assert.equal(log.selection, null);
  }
});

test("Choose: continuing with the stored school writes nothing and closes the selector", async () => {
  const { value, log } = deps({ selection: { caseId: CHOSEN.id, madhab: null } });
  const from = startedOf(CHOSEN, true, { changing: true });
  assert.deepEqual(
    await runAction("choose", signal, value, CHOSEN, { madhab: "hanafi", from }),
    startedOf(CHOSEN, true),
  );
  assert.deepEqual(log.chooses, []);
  assert.equal(log.selection, null);
});

test("Choose: throttled or failed keeps the selector with a notice and the record", async () => {
  for (const kind of ["throttled", "failed"] as const) {
    const { value, log } = deps({
      choose: () => ({ kind }) as MadhabResult,
      selection: { caseId: CASE.id, madhab: "maliki" },
    });
    assert.deepEqual(
      await runAction("choose", signal, value, CASE, { madhab: "maliki", from: SELECTOR }),
      { ...SELECTOR, notice: kind },
    );
    assert.deepEqual(log.chooses, ["maliki"], "one attempt");
    assert.deepEqual(log.selection, { caseId: CASE.id, madhab: "maliki" });
  }
});

test("Choose: a case that has gone leads to the expired view and clears the record", async () => {
  const { value, log } = deps({
    choose: () => ({ kind: "gone" }),
    seen: true,
    selection: { caseId: CASE.id, madhab: null },
  });
  assert.deepEqual(await runAction("choose", signal, value, CASE, { madhab: "maliki", from: SELECTOR }), {
    name: "none",
    expired: true,
  });
  assert.equal(log.selection, null);
  assert.equal(log.seen, false);
});

test("Choose: a replaced case shows the existing-case view", async () => {
  const { value, log } = deps({
    choose: () => ({ kind: "replaced", case: NEW_CASE }),
    selection: { caseId: CASE.id, madhab: null },
  });
  assert.deepEqual(await runAction("choose", signal, value, CASE, { madhab: "maliki", from: SELECTOR }), {
    name: "existing",
    case: NEW_CASE,
  });
  assert.equal(log.selection, null);
});

test("Choose: pending keeps the selector on screen, saving", () => {
  assert.deepEqual(pendingView("choose", SELECTOR), { ...SELECTOR, saving: true });
  assert.deepEqual(pendingView("choose", { ...SELECTOR, notice: "failed" }), { ...SELECTOR, saving: true });
  assert.equal(pendingView("choose").name, "loading");
});

test("Resume with a school goes to the first question; without one, to the selector", async () => {
  let { value } = deps({ read: async () => CHOSEN });
  assert.equal(screenOf(await runAction("resume", signal, value, CHOSEN)), "question");
  ({ value } = deps({ read: async () => CASE }));
  assert.equal(screenOf(await runAction("resume", signal, value, CASE)), "selector");
});

test("Selection in progress: a load skips the resume prompt, whether or not a school is stored", async () => {
  for (const kase of [CASE, CHOSEN]) {
    const { value, log } = deps({ read: async () => kase, selection: { caseId: kase.id, madhab: "jafari" } });
    const view = await runAction("load", signal, value);
    assert.equal(screenOf(view), "selector");
    assert.equal((view as StartedView).resumed, kase.madhab !== null, "resumed follows the stored school");
    assert.deepEqual(log.selection, { caseId: kase.id, madhab: "jafari" }, "the record survives");
  }
});

test("Selection in progress: resuming does not remove the record", async () => {
  const { value, log } = deps({ read: async () => CHOSEN, selection: { caseId: CHOSEN.id, madhab: "jafari" } });
  assert.equal(screenOf(await runAction("resume", signal, value, CHOSEN)), "selector");
  assert.deepEqual(log.selection, { caseId: CHOSEN.id, madhab: "jafari" });
});

test("A record for another case does not skip the resume prompt", async () => {
  const { value } = deps({ read: async () => CASE, selection: { caseId: "other", madhab: "jafari" } });
  assert.equal((await runAction("load", signal, value)).name, "existing");
});

test("Start over and a vanished case clear the old record", async () => {
  let { value, log } = deps({
    start: () => ({ kind: "started", case: NEW_CASE }),
    selection: { caseId: CASE.id, madhab: "jafari" },
  });
  await runAction("startOver", signal, value, CASE);
  assert.deepEqual(log.selection, { caseId: NEW_CASE.id, madhab: null });
  ({ value, log } = deps({ seen: true, selection: { caseId: CASE.id, madhab: "jafari" } }));
  await runAction("load", signal, value);
  assert.equal(log.selection, null);
});

test("Change opens the selector with a record; cancel closes it with nothing written", () => {
  const { value, log } = deps({});
  const open = openChange(QUESTION, value);
  assert.equal(screenOf(open), "selector");
  assert.deepEqual(log.selection, { caseId: CASE.id, madhab: null });
  const closed = cancelChange({ ...open, notice: "failed" }, value);
  assert.deepEqual(closed, QUESTION);
  assert.equal(log.selection, null);
  assert.deepEqual(log.chooses, []);
});

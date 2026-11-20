import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { AnswerResult, Case, MadhabResult, RelationshipId, StartResult } from "../api/case.ts";
import { noHeirOptions } from "../api/case.ts";
import type { FormRecord } from "./answers.ts";
import {
  askStartOver,
  blurField,
  cancelChange,
  cancelEditDeceased,
  requestCardRemoval,
  cancelEditHeir,
  cancelStartOver,
  caseOf,
  FOCUS_PREFIXES,
  FOCUS_TARGETS,
  heirFormKey,
  openChange,
  openLayer,
  cancelOrder,
  revealOf,
  pick,
  pendingView,
  precheck,
  remember,
  runAction,
  screenOf,
  shouldFocus,
  startEditDeceased,
  startEditHeir,
  type Answer,
  type Deps,
  type StartedView,
  type View,
} from "./flow.ts";
import type { Selection } from "./madhabs.ts";

const CASE: Case = { id: "abc12345", revision: 3, started_at: "2026-11-06T10:00:00Z", madhab: null, deceased: null, heirs: [], heir_options: { blocked: [], invalid: {} }, deaths: [] };
const NEW_CASE: Case = {
  id: "def67890",
  revision: 1,
  started_at: "2026-11-06T11:00:00Z",
  madhab: null,
  deceased: null,
  heirs: [],
  heir_options: { blocked: [], invalid: {} },
  deaths: [],
};
const signal = new AbortController().signal;

function startedOf(kase: Case, resumed: boolean, extra: Partial<StartedView> = {}): StartedView {
  return {
    name: "started",
    case: kase,
    resumed,
    changing: false,
    editingDeceased: false,
    editingHeir: null,
    layer: null,
    ordering: null,
    formEpoch: 0,
    notice: null,
    errors: null,
    focus: null,
    announcement: null,
    saving: false,
    ...extra,
  };
}

function deps(options: {
  read?: () => Promise<Case | null>;
  start?: (replace: boolean) => StartResult;
  seen?: boolean;
  choose?: (madhab: string, caseId: string) => MadhabResult;
  selection?: Selection | null;
  form?: FormRecord | null;
  answer?: (call: string) => AnswerResult;
}) {
  const log = {
    confirmations: [] as boolean[],
    reads: 0,
    starts: [] as boolean[],
    startCaseIds: [] as (string | undefined)[],
    seen: options.seen ?? false,
    chooses: [] as string[],
    chooseCaseIds: [] as string[],
    revisions: [] as (number | null)[],
    startRevisions: [] as (number | null | undefined)[],
    selection: options.selection ?? (null as Selection | null),
    form: options.form ?? (null as FormRecord | null),
    answers: [] as { call: string; caseId: string; fields?: unknown; heirId?: string }[],
  };
  const answerWith = (call: string, caseId: string, extra: { fields?: unknown; heirId?: string }, revision: number | null) => {
    log.revisions.push(revision);
    log.answers.push({ call, caseId, ...extra });
    return (options.answer ?? (() => ({ kind: "failed" }) as AnswerResult))(call);
  };
  const value: Deps = {
    fetchCase: async () => {
      log.reads += 1;
      return (options.read ?? (async () => null))();
    },
    startCase: async (_signal, { replace, caseId, revision }) => {
      log.startRevisions.push(revision);
      log.starts.push(replace);
      log.startCaseIds.push(caseId);
      return (options.start ?? (() => ({ kind: "failed" }) as StartResult))(replace);
    },
    setMadhab: async (_signal, madhab, caseId, revision) => {
      log.chooses.push(madhab);
      log.chooseCaseIds.push(caseId);
      log.revisions.push(revision);
      return (options.choose ?? (() => ({ kind: "failed" }) as MadhabResult))(madhab, caseId);
    },
    saveDeceased: async (_signal, caseId, revision, fields) => answerWith("saveDeceased", caseId, { fields }, revision),
    addHeir: async (_signal, caseId, revision, fields) => answerWith("addHeir", caseId, { fields }, revision),
    addHeirs: async (_signal, caseId, revision, relationship, count, layer) =>
      answerWith("addHeirs", caseId, { fields: { relationship, count, layer } }, revision),
    updateHeir: async (_signal, caseId, revision, heirId, fields) =>
      answerWith("updateHeir", caseId, { heirId, fields }, revision),
    removeHeir: async (_signal, caseId, revision, heirId, confirm) => {
      log.confirmations.push(confirm);
      return answerWith("removeHeir", caseId, { heirId }, revision);
    },
    markDeceased: async (_signal, caseId, revision, heirId, first) =>
      answerWith("markDeceased", caseId, { heirId, ...(first === undefined ? {} : { fields: { first } }) }, revision),
    unmarkDeceased: async (_signal, caseId, revision, heirId) => answerWith("unmarkDeceased", caseId, { heirId }, revision),
    restoreCase: async (_signal, caseId, revision, snapshot) => answerWith("restoreCase", caseId, { fields: snapshot }, revision),
    seen: { get: () => log.seen, set: (next) => (log.seen = next) },
    selection: { get: () => log.selection, set: (next) => (log.selection = next) },
    forms: { get: () => log.form, set: (next) => (log.form = next) },
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
// The selector now opens only for "Change"; a case with no school goes straight to the deceased form.
const SELECTOR = startedOf(CASE, false, { changing: true });
const QUESTION = startedOf(CHOSEN, true);

test("screens: only a case whose school is being changed shows the selector", () => {
  const table: [View, string][] = [
    [{ name: "loading" }, "loading"],
    [{ name: "none", expired: false }, "none"],
    [{ name: "existing", case: CASE }, "existing"],
    [SELECTOR, "selector"],
    [startedOf(CASE, false), "deceased"],
    [startedOf(CHOSEN, false), "deceased"],
    [startedOf(CHOSEN, false, { changing: true }), "selector"],
    [{ name: "throttled", resumable: null }, "throttled"],
    [{ name: "failed", retry: "load", resumable: null }, "failed"],
  ];
  for (const [view, screen] of table) assert.equal(screenOf(view), screen, JSON.stringify(view));
});

test("focus moves only when the screen changes, never for an in-place edit", () => {
  const failed = startedOf(CASE, false, { notice: "failed", changing: true });
  const saving = startedOf(CASE, false, { saving: true, changing: true });
  const table: [View | null, View, boolean, string][] = [
    [null, SELECTOR, true, "first settled view"],
    [{ name: "loading" }, { name: "starting" }, false, "starting"],
    [SELECTOR, { name: "loading" }, false, "loading"],
    [{ name: "loading" }, SELECTOR, true, "loaded"],
    [{ name: "loading" }, { name: "none", expired: false }, true, "none"],
    [SELECTOR, saving, false, "saving"],
    [saving, failed, false, "failed save keeps focus on the form"],
    [failed, SELECTOR, false, "a pick clears the notice in place"],
    [SELECTOR, startedOf(CASE, false, { changing: true }), false, "same screen, same state"],
    [SELECTOR, startedOf(CASE, false), true, "a case with no school skips the selector"],
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
  const failed = startedOf(CASE, false, { notice: "failed", changing: true });
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

test("a new case opens on the deceased form, with no selector record", async () => {
  const { value, log } = deps({ start: () => ({ kind: "started", case: CASE }) });
  const view = await runAction("start", signal, value);
  assert.equal(screenOf(view), "deceased");
  assert.equal(log.selection, null);
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

test("Resume goes to the deceased form, with a school or without one", async () => {
  let { value } = deps({ read: async () => CHOSEN });
  assert.equal(screenOf(await runAction("resume", signal, value, CHOSEN)), "deceased");
  ({ value } = deps({ read: async () => CASE }));
  assert.equal(screenOf(await runAction("resume", signal, value, CASE)), "deceased");
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
  assert.equal(log.selection, null, "the new case opens on the deceased form, not the selector");
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

// Story 1.3: the deceased and the heirs

const WITH_DECEASED: Case = { ...CHOSEN, deceased: { gender: "male", estate: "1000" } };
const SON = { id: "h1", relationship: "son" as const, gender: "male" as const, name: null, edit_options: noHeirOptions() };
const AMAL = { id: "h2", relationship: "daughter" as const, gender: "female" as const, name: "Amal", edit_options: noHeirOptions() };
const WITH_SON: Case = { ...WITH_DECEASED, heirs: [SON] };
const WITH_TWO: Case = { ...WITH_DECEASED, heirs: [SON, AMAL] };
const HEIRS = startedOf(WITH_DECEASED, true);
const BLANK_RECORD = (caseId: string, heirId: string | null = null): FormRecord => ({
  caseId,
  form: "heir", layer: null,
  heirId,
  values: { relationship: "", name: "" },
});

test("screens: deceased form, heir screen, and the selector first", () => {
  assert.equal(screenOf(startedOf(CHOSEN, false)), "deceased");
  assert.equal(screenOf(startedOf(WITH_DECEASED, false)), "heirs");
  assert.equal(screenOf(startedOf(WITH_DECEASED, false, { editingDeceased: true })), "deceased");
  assert.equal(screenOf(startedOf(WITH_DECEASED, false, { changing: true })), "selector");
  assert.equal(screenOf(startedOf(CASE, false, { editingDeceased: true })), "deceased");
  assert.equal(screenOf(startedOf(CASE, false)), "deceased", "a case with no school is not asked for one");
  assert.equal(screenOf({ name: "confirmStartOver", case: CASE }), "confirmStartOver");
});

test("Save deceased: stored, then the heir screen with a blank heir form, focus on the screen", async () => {
  const { value, log } = deps({ answer: () => ({ kind: "saved", case: WITH_DECEASED }) });
  const from = startedOf(CHOSEN, true);
  const view = await runAction("saveDeceased", signal, value, CHOSEN, undefined, {
    kind: "saveDeceased",
    from,
    values: { gender: "male", estate: "١٠٠٠" },
  });
  assert.deepEqual(view, startedOf(WITH_DECEASED, true));
  assert.deepEqual(log.answers, [
    { call: "saveDeceased", caseId: CHOSEN.id, fields: { gender: "male", estate: "1000" } },
  ]);
  assert.deepEqual(log.form, BLANK_RECORD(CHOSEN.id));
  assert.equal(shouldFocus(from, view), true);
});

test("Save deceased without an estate sends null", async () => {
  const { value, log } = deps({ answer: () => ({ kind: "saved", case: WITH_DECEASED }) });
  await runAction("saveDeceased", signal, value, CHOSEN, undefined, {
    kind: "saveDeceased",
    from: startedOf(CHOSEN, true),
    values: { gender: "female", estate: "" },
  });
  assert.deepEqual(log.answers[0].fields, { gender: "female", estate: null });
});

test("Invalid deceased: nothing is sent, the first invalid field gets focus", async () => {
  const { value, log } = deps({});
  const from = startedOf(CHOSEN, true);
  const answer: Answer = { kind: "saveDeceased", from, values: { gender: "", estate: "0" } };
  const view = await runAction("saveDeceased", signal, value, CHOSEN, undefined, answer);
  assert.deepEqual(log.answers, []);
  assert.deepEqual(view, {
    ...from,
    errors: { gender: "required", estate: "not_positive" },
    focus: { target: "gender", seq: 1 },
  });
  assert.deepEqual(precheck(answer), view);
  const second = precheck({ ...answer, from: view as StartedView, values: { gender: "male", estate: "0" } });
  assert.deepEqual(second?.focus, { target: "estate", seq: 2 });
  assert.equal(precheck({ ...answer, values: { gender: "male", estate: "" } }), null);
});

test("Server field errors keep the input, show the codes and focus the first invalid field", async () => {
  const { value } = deps({ answer: () => ({ kind: "invalid", errors: { name: "too_long" } }) });
  const from = startedOf(WITH_DECEASED, true);
  const view = await runAction("addHeir", signal, value, WITH_DECEASED, undefined, {
    kind: "addHeir",
    from,
    values: { relationship: "son", name: "Amal" },
  });
  assert.deepEqual(view, { ...from, errors: { name: "too_long" }, focus: { target: "name", seq: 1 } });
});

test("Add heir: appears in the list, the form is cleared, focus on relationship, announced", async () => {
  const { value, log } = deps({ answer: () => ({ kind: "saved", case: WITH_SON }) });
  const from = startedOf(WITH_DECEASED, true);
  const view = (await runAction("addHeir", signal, value, WITH_DECEASED, undefined, {
    kind: "addHeir",
    from,
    values: { relationship: "son", name: "  " },
  })) as StartedView;
  assert.deepEqual(log.answers, [
    { call: "addHeir", caseId: WITH_DECEASED.id, fields: { relationship: "son", name: null } },
  ]);
  assert.deepEqual(view.case.heirs, [SON]);
  assert.deepEqual(view.announcement, { kind: "added", id: "h1", heir: { name: null, relationship: "son" }, ordinal: null, seq: 1 });
  assert.deepEqual(view.focus, { target: "relationship", seq: 1 });
  assert.equal(screenOf(view), "heirs");
  assert.deepEqual(log.form, BLANK_RECORD(WITH_DECEASED.id));
  assert.equal(shouldFocus(from, view), false, "the screen does not change, so focus is the form's");
});

test("Add heir: a repeat announcement is a new one", async () => {
  const { value } = deps({ answer: () => ({ kind: "saved", case: WITH_TWO }) });
  const from = startedOf(WITH_SON, true, {
    announcement: { kind: "added", id: "h1", heir: { name: null, relationship: "son" }, ordinal: null, seq: 4 },
    focus: { target: "relationship", seq: 4 },
  });
  const view = (await runAction("addHeir", signal, value, WITH_SON, undefined, {
    kind: "addHeir",
    from,
    values: { relationship: "daughter", name: "Amal" },
  })) as StartedView;
  assert.equal(view.announcement?.seq, 5);
  assert.deepEqual(view.announcement?.heir, { name: "Amal", relationship: "daughter" });
  assert.equal(view.focus?.seq, 5);
});

test("The 51st heir is refused before anything is sent, with the input kept", async () => {
  const many = Array.from({ length: 50 }, (_, index) => ({ ...SON, id: `h${index}` }));
  const full: Case = { ...WITH_DECEASED, heirs: many };
  const { value, log } = deps({});
  const from = startedOf(full, true);
  const view = await runAction("addHeir", signal, value, full, undefined, {
    kind: "addHeir",
    from,
    values: { relationship: "son", name: "" },
  });
  assert.deepEqual(log.answers, []);
  assert.deepEqual(view, { ...from, errors: { heirs: "limit" }, focus: { target: "form-error", seq: 1 } });
});

test("The server limit answer is shown the same way", async () => {
  const { value } = deps({ answer: () => ({ kind: "invalid", errors: { heirs: "limit" } }) });
  const from = startedOf(WITH_SON, true);
  const view = await runAction("addHeir", signal, value, WITH_SON, undefined, {
    kind: "addHeir",
    from,
    values: { relationship: "son", name: "" },
  });
  assert.deepEqual(view, { ...from, errors: { heirs: "limit" }, focus: { target: "form-error", seq: 1 } });
});

test("Edit heir: opening focuses name, saving keeps the editor and focuses the changed field", async () => {
  const { value, log } = deps({ answer: () => ({ kind: "saved", case: WITH_TWO }) });
  const editing = startEditHeir(startedOf(WITH_TWO, true), "h2", value);
  assert.equal(editing.editingHeir, "h2");
  assert.deepEqual(log.form, {
    caseId: WITH_TWO.id,
    form: "heir", layer: null,
    heirId: "h2",
    values: { relationship: "daughter", name: "Amal" },
  });
  assert.deepEqual(editing.focus, { target: "name", seq: 1 });
  const view = (await runAction("saveHeir", signal, value, WITH_TWO, undefined, {
    kind: "saveHeir",
    from: editing,
    field: "editRelationship:sister",
    heirId: "h2",
    values: { relationship: "sister", name: "Amal" },
  })) as StartedView;
  assert.deepEqual(log.answers[0], {
    call: "updateHeir",
    caseId: WITH_TWO.id,
    heirId: "h2",
    fields: { relationship: "sister", name: "Amal" },
  });
  assert.equal(view.editingHeir, "h2");
  assert.equal(view.announcement?.kind, "updated");
  assert.deepEqual(view.focus, { target: "editRelationship:sister", seq: 2 });
  assert.equal(log.form?.heirId, "h2");
});

test("saveHeir with a status passes it to updateHeir, and close:true closes onto the opener", async () => {
  const { value, log } = deps({ answer: () => ({ kind: "saved", case: WITH_TWO }) });
  const editing = startEditHeir(startedOf(WITH_TWO, true), "h2", value, "card:h2");
  const view = (await runAction("saveHeir", signal, value, WITH_TWO, undefined, {
    kind: "saveHeir", from: editing, heirId: "h2", field: "editStatus:died_before_or_with",
    status: "died_before_or_with", values: { relationship: "daughter", name: "Amal" },
  })) as StartedView;
  assert.deepEqual(log.answers[0].fields, { relationship: "daughter", name: "Amal", status: "died_before_or_with" });
  assert.equal(view.editingHeir, "h2");
  const closed = (await runAction("saveHeir", signal, value, WITH_TWO, undefined, {
    kind: "saveHeir", from: editing, heirId: "h2", field: "name", close: true,
    values: { relationship: "daughter", name: "Noor" },
  })) as StartedView;
  assert.equal(closed.editingHeir, null);
  assert.equal(closed.focus?.target, "card:h2");
});

test("a status_locked refusal keeps the editor on the status radio with the family unchanged", async () => {
  const { value } = deps({ answer: () => ({ kind: "invalid", errors: { status: "status_locked" } }) });
  const editing = startEditHeir(startedOf(WITH_TWO, true), "h2", value);
  const view = (await runAction("saveHeir", signal, value, WITH_TWO, undefined, {
    kind: "saveHeir", from: editing, heirId: "h2", field: "editStatus:died_before_or_with",
    status: "died_before_or_with", values: { relationship: "daughter", name: "Amal" },
  })) as StartedView;
  assert.equal(view.editingHeir, "h2");
  assert.equal(view.focus?.target, "editStatus:died_before_or_with");
  assert.deepEqual(view.errors, { status: "status_locked" });
  assert.equal(view.case, editing.case);
});

test("a card removal request confirmed unconfirmed-first and answered by cascade shows that impact", async () => {
  const live = { ...WITH_TWO, revision: 8 };
  const impact = { persons: ["h1"], estates: [] as number[] };
  const { value, log } = deps({ answer: () => ({ kind: "cascade", case: live, impact }) });
  const asked = requestCardRemoval(startedOf(WITH_TWO, true), "h2", value);
  const view = (await runAction("removeHeir", signal, value, null, undefined,
    { kind: "removeHeir", from: asked, heirId: "h2", confirm: false })) as StartedView;
  assert.deepEqual(log.confirmations, [false]);
  assert.equal(view.case, live);
  assert.deepEqual(view.confirming?.impact, impact);
  assert.equal(view.editingHeir, "h2");
});

test("Edit heir: an unknown heir changes nothing, and cancel clears the form without writing", () => {
  const { value, log } = deps({});
  const view = startedOf(WITH_TWO, true);
  assert.equal(startEditHeir(view, "nope", value), view);
  const editing = startEditHeir(view, "h1", value);
  const cancelled = cancelEditHeir(editing, value);
  assert.equal(cancelled.editingHeir, null);
  assert.deepEqual(cancelled.focus, { target: "editHeir:h1", seq: 2 });
  assert.deepEqual(log.form?.values, { relationship: "", name: "" });
  assert.deepEqual(log.answers, []);
});

test("Edit deceased: opens the form filled in; cancel returns to the heirs and writes nothing", () => {
  const { value, log } = deps({});
  const editing = startEditDeceased(HEIRS, value);
  assert.equal(screenOf(editing), "deceased");
  assert.deepEqual(log.form, {
    caseId: CHOSEN.id,
    form: "deceased", layer: null,
    heirId: null,
    values: { gender: "male", estate: "1000" },
  });
  const back = cancelEditDeceased(editing, value);
  assert.equal(screenOf(back), "heirs");
  assert.deepEqual(back, { ...HEIRS, formEpoch: 1 });
  assert.deepEqual(log.answers, []);
});

test("Remove heir: gone from the list, announced, focus on its surviving sibling", async () => {
  const { value, log } = deps({ answer: () => ({ kind: "saved", case: WITH_SON }) });
  const from = startedOf(WITH_TWO, true);
  const view = (await runAction("removeHeir", signal, value, WITH_TWO, undefined, {
    kind: "removeHeir",
    from,
    heirId: "h2",
  })) as StartedView;
  assert.deepEqual(log.answers, [{ call: "removeHeir", caseId: WITH_TWO.id, heirId: "h2" }]);
  assert.deepEqual(view.case.heirs, [SON]);
  assert.deepEqual(view.announcement, {
    kind: "removed",
    id: "h2",
    heir: { name: "Amal", relationship: "daughter" },
    ordinal: null,
    seq: 1,
  });
  assert.deepEqual(view.focus, { target: "card:h1", seq: 1 });
});

test("Remove heir: failure keeps the heir and returns focus to its button", async () => {
  const { value } = deps({ answer: () => ({ kind: "failed" }) });
  const from = startedOf(WITH_TWO, true);
  const view = await runAction("removeHeir", signal, value, WITH_TWO, undefined, {
    kind: "removeHeir",
    from,
    heirId: "h2",
  });
  assert.deepEqual(view, { ...from, notice: "failed", focus: { target: "remove:h2", seq: 1 } });
});

test("row removal adopts impact, Keep closes, and a stale Yes reconciles without resending", async () => {
  const from = startedOf(WITH_TWO, true);
  const live = { ...WITH_TWO, revision: 8 };
  const newer = { ...WITH_TWO, revision: 9 };
  const impact = { persons: ["h1"], estates: [2] };
  let result: AnswerResult = { kind: "cascade", case: live, impact };
  const { value, log } = deps({ answer: () => result });
  const remove = async (view: StartedView, confirm: boolean) => await runAction("removeHeir", signal, value, null, undefined,
    { kind: "removeHeir", from: view, heirId: "h2", confirm, fromRow: true }) as StartedView;
  const asked = await remove(from, false);
  assert.equal(asked.case, live);
  assert.deepEqual(asked.confirming, { heirId: "h2", impact, fromRow: true });
  const kept = cancelEditHeir(asked, value);
  assert.equal(kept.editingHeir, null);
  assert.equal(kept.focus?.target, "remove:h2");
  result = { kind: "replaced", case: newer };
  const stale = await remove(asked, true);
  assert.equal(stale.case, newer);
  assert.equal(stale.editingHeir, "h2");
  assert.equal(stale.conflict, true);
  assert.equal(stale.confirming, undefined);
  assert.deepEqual(log.confirmations, [false, true]);
  assert.deepEqual(log.revisions, [from.case.revision, 8]);
});

test("Delete opens a confirmation locally and Escape restores edit then the card", () => {
  const { value, log } = deps({});
  const asked = requestCardRemoval(startedOf(WITH_TWO, true), "h2", value);
  assert.equal(asked.confirming?.impact, null);
  const edit = cancelEditHeir(asked, value);
  assert.equal(edit.editingHeir, "h2");
  assert.equal(edit.confirming, undefined);
  assert.equal(cancelEditHeir(edit, value).focus?.target, "card:h2");
  assert.deepEqual(log.answers, []);
});

test("An heir that no longer exists: the list is refreshed from the response, with a notice", async () => {
  const { value, log } = deps({ answer: () => ({ kind: "missing", case: WITH_SON }) });
  const editing = startEditHeir(startedOf(WITH_TWO, true), "h2", value);
  const view = (await runAction("saveHeir", signal, value, WITH_TWO, undefined, {
    kind: "saveHeir",
    from: editing,
    heirId: "h2",
    values: { relationship: "sister", name: "" },
  })) as StartedView;
  assert.deepEqual(view.case.heirs, [SON]);
  assert.equal(view.notice, "heirGone");
  assert.equal(view.editingHeir, null);
  assert.deepEqual(log.form, BLANK_RECORD(WITH_SON.id));
  const removed = await runAction("removeHeir", signal, value, WITH_TWO, undefined, {
    kind: "removeHeir",
    from: startedOf(WITH_TWO, true),
    heirId: "h2",
  });
  assert.equal((removed as StartedView).notice, "heirGone");
});

test("Throttled or failed writes keep the screen, the input record and show the notice", async () => {
  for (const kind of ["throttled", "failed"] as const) {
    const record: FormRecord = {
      caseId: WITH_DECEASED.id,
      form: "heir", layer: null,
      heirId: null,
      values: { relationship: "son", name: "Secret" },
    };
    const { value, log } = deps({ answer: () => ({ kind }) as AnswerResult, form: record });
    const from = startedOf(WITH_DECEASED, true);
    const view = await runAction("addHeir", signal, value, WITH_DECEASED, undefined, {
      kind: "addHeir",
      from,
      values: { relationship: "son", name: "Secret" },
    });
    assert.deepEqual(view, { ...from, notice: kind }, kind);
    assert.deepEqual(log.form, record, "what the visitor typed is kept");
    assert.equal(log.answers.length, 1, "one attempt");
    assert.equal(shouldFocus(from, view), false);
  }
});

test("No live case: the expired view, and the form record is cleared", async () => {
  const { value, log } = deps({
    answer: () => ({ kind: "gone" }),
    seen: true,
    form: BLANK_RECORD(WITH_DECEASED.id),
    selection: { caseId: WITH_DECEASED.id, madhab: null },
  });
  const view = await runAction("addHeir", signal, value, WITH_DECEASED, undefined, {
    kind: "addHeir",
    from: startedOf(WITH_DECEASED, true),
    values: { relationship: "son", name: "" },
  });
  assert.deepEqual(view, { name: "none", expired: true });
  assert.equal(log.form, null);
  assert.equal(log.selection, null);
  assert.equal(log.seen, false);
});

test("Stale tab: the existing-case view with the live case, and the record is cleared", async () => {
  const { value, log } = deps({
    answer: () => ({ kind: "replaced", case: NEW_CASE }),
    form: { caseId: CHOSEN.id, form: "deceased", layer: null, heirId: null, values: {} },
  });
  const view = await runAction("saveDeceased", signal, value, CHOSEN, undefined, {
    kind: "saveDeceased",
    from: startedOf(CHOSEN, true),
    values: { gender: "male", estate: "" },
  });
  assert.deepEqual(view, { name: "existing", case: NEW_CASE });
  assert.equal(log.form, null);
  assert.equal(log.seen, true);
});

test("An answer action without its answer fails safely", async () => {
  const { value, log } = deps({});
  const view = await runAction("addHeir", signal, value, CASE);
  assert.equal(view.name, "failed");
  assert.deepEqual(log.answers, []);
});

test("Pending view for a save: same screen, saving, announcement kept", () => {
  const announcement = { kind: "added", id: "h1", heir: { name: null, relationship: "son" }, ordinal: null, seq: 2 } as const;
  const current = startedOf(WITH_SON, true, { announcement, errors: { name: "invalid" }, notice: "failed" });
  assert.deepEqual(pendingView("addHeir", current), { ...current, notice: null, errors: null, saving: true });
  assert.equal(pendingView("removeHeir").name, "loading");
});

test("Typing records the form and clears only the changed field error", () => {
  const { value, log } = deps({});
  const view = startedOf(WITH_DECEASED, true, {
    errors: { relationship: "required", name: "too_long" },
    notice: "failed",
  });
  const next = remember(view, "heir", { relationship: "son", name: "x" }, "relationship", value.forms);
  assert.deepEqual(log.form, {
    caseId: WITH_DECEASED.id,
    form: "heir", layer: null,
    heirId: null,
    values: { relationship: "son", name: "x" },
  });
  assert.deepEqual(next.errors, { name: "too_long" });
  assert.equal(next.notice, null);
  const last = remember(next, "heir", { relationship: "son", name: "" }, "name", value.forms);
  assert.equal(last.errors, null);
  const plain = startedOf(WITH_DECEASED, true);
  assert.equal(remember(plain, "heir", { relationship: "", name: "" }, "name", value.forms), plain);
});

test("Blur validates one field and leaves the others alone", () => {
  const view = startedOf(CHOSEN, true, { errors: { gender: "required" } });
  const bad = blurField(view, "deceased", "estate", { gender: "", estate: "1.234" });
  assert.deepEqual(bad.errors, { gender: "required", estate: "decimals" });
  const fixed = blurField(bad, "deceased", "estate", { gender: "", estate: "1.2" });
  assert.deepEqual(fixed.errors, { gender: "required" });
  assert.equal(blurField(fixed, "deceased", "estate", { gender: "", estate: "" }), fixed, "no change, same view");
  assert.equal(blurField(fixed, "deceased", "gender", { gender: "male", estate: "" }).errors, null);
});

test("Change Madhab keeps the answers and returns to the same screen", async () => {
  const jafari: Case = { ...WITH_TWO, madhab: "jafari" };
  const { value, log } = deps({
    choose: () => ({ kind: "updated", case: jafari }),
    selection: { caseId: WITH_TWO.id, madhab: "jafari" },
  });
  const open = openChange(startedOf(WITH_TWO, true, { editingHeir: "h2" }), value);
  assert.equal(screenOf(open), "selector");
  const view = (await runAction("choose", signal, value, WITH_TWO, { madhab: "jafari", from: open })) as StartedView;
  assert.equal(screenOf(view), "heirs");
  assert.equal(view.editingHeir, "h2");
  assert.deepEqual(view.case.heirs, [SON, AMAL]);
  assert.deepEqual(view.case.deceased, WITH_TWO.deceased);
  assert.equal(log.selection, null);
  const editingDeceased = startedOf(WITH_TWO, true, { editingDeceased: true, changing: true });
  const back = (await runAction("choose", signal, value, WITH_TWO, {
    madhab: "jafari",
    from: editingDeceased,
  })) as StartedView;
  assert.equal(screenOf(back), "deceased");
});

test("A form in progress in this tab continues without the resume prompt", async () => {
  const record: FormRecord = {
    caseId: WITH_TWO.id,
    form: "heir", layer: null,
    heirId: null,
    values: { relationship: "son", name: "half" },
  };
  const { value, log } = deps({ read: async () => WITH_TWO, form: record });
  const view = (await runAction("load", signal, value)) as StartedView;
  assert.equal(view.name, "started");
  assert.equal(screenOf(view), "heirs");
  assert.equal(view.resumed, true);
  assert.deepEqual(log.form, record, "the half-filled values survive");
});

test("A form in progress restores which heir or the deceased is being edited", async () => {
  const editHeir: FormRecord = {
    caseId: WITH_TWO.id,
    form: "heir", layer: null,
    heirId: "h2",
    values: { relationship: "sister", name: "A" },
  };
  let { value, log } = deps({ read: async () => WITH_TWO, form: editHeir });
  assert.equal(((await runAction("load", signal, value)) as StartedView).editingHeir, "h2");
  assert.deepEqual(log.form, editHeir);
  ({ value, log } = deps({ read: async () => WITH_TWO, form: { ...editHeir, heirId: "missing" } }));
  const view = (await runAction("load", signal, value)) as StartedView;
  assert.equal(view.editingHeir, null);
  assert.deepEqual(log.form, BLANK_RECORD(WITH_TWO.id));
  const editDeceased: FormRecord = {
    caseId: WITH_TWO.id,
    form: "deceased", layer: null,
    heirId: null,
    values: { gender: "female", estate: "" },
  };
  ({ value, log } = deps({ read: async () => WITH_TWO, form: editDeceased }));
  const deceased = (await runAction("load", signal, value)) as StartedView;
  assert.equal(screenOf(deceased), "deceased");
  assert.deepEqual(log.form, editDeceased);
});

test("A form record for another case does not skip the resume prompt, and resume settles a form", async () => {
  const other: FormRecord = { caseId: "other", form: "heir", layer: null, heirId: null, values: {} };
  const { value, log } = deps({ read: async () => WITH_TWO, form: other });
  assert.equal((await runAction("load", signal, value)).name, "existing");
  const view = await runAction("resume", signal, value, WITH_TWO);
  assert.equal(screenOf(view), "heirs");
  assert.deepEqual(log.form, BLANK_RECORD(WITH_TWO.id));
});

test("Start over and a vanished case clear the form record", async () => {
  const record: FormRecord = { caseId: CASE.id, form: "heir", layer: null, heirId: null, values: { name: "x" } };
  let { value, log } = deps({ start: () => ({ kind: "started", case: NEW_CASE }), form: record });
  await runAction("startOver", signal, value, CASE);
  assert.deepEqual([log.form?.caseId, log.form?.form], [NEW_CASE.id, "deceased"], "the new case opens on the deceased form");
  ({ value, log } = deps({ seen: true, form: record }));
  await runAction("load", signal, value);
  assert.equal(log.form, null);
});

test("A failed or throttled start over keeps the form record of the live case", async () => {
  for (const kind of ["failed", "throttled"] as const) {
    const record: FormRecord = { caseId: CASE.id, form: "heir", layer: null, heirId: null, values: { name: "x" } };
    const { value, log } = deps({ start: () => ({ kind }) as StartResult, form: record });
    await runAction("startOver", signal, value, CASE);
    assert.deepEqual(log.form, record, kind);
  }
});

test("Start over asks first: cancel changes nothing, confirm replaces", async () => {
  const existing: View = { name: "existing", case: WITH_TWO };
  const asking = askStartOver(existing);
  assert.deepEqual(asking, { name: "confirmStartOver", case: WITH_TWO });
  assert.deepEqual(cancelStartOver(asking), existing);
  assert.deepEqual(askStartOver(HEIRS), { name: "confirmStartOver", case: WITH_DECEASED }, "a form screen asks too");
  assert.equal(askStartOver({ name: "loading" }).name, "loading", "other views do not");
  const { value, log } = deps({ start: () => ({ kind: "started", case: NEW_CASE }) });
  assert.deepEqual(log.starts, [], "asking writes nothing");
  assert.equal((await runAction("startOver", signal, value, WITH_TWO)).name, "started");
  assert.deepEqual(log.starts, [true]);
});

test("Focus: the confirmation and the screens it returns to take focus", () => {
  const existing: View = { name: "existing", case: WITH_TWO };
  assert.equal(shouldFocus(existing, askStartOver(existing)), true);
  assert.equal(shouldFocus(askStartOver(existing), existing), true);
  const editing = startEditDeceased(HEIRS, deps({}).value);
  assert.equal(shouldFocus(HEIRS, editing), true);
  assert.equal(shouldFocus(startedOf(CHOSEN, true), HEIRS), true, "deceased saved");
});

// Review patches

test("Start over names the case it showed, so a stale tab cannot replace a newer one", async () => {
  const { value, log } = deps({ start: () => ({ kind: "started", case: NEW_CASE }) });
  await runAction("startOver", signal, value, WITH_TWO);
  await runAction("start", signal, value);
  assert.deepEqual(log.starts, [true, false]);
  assert.deepEqual(log.startCaseIds, [WITH_TWO.id, undefined]);
});

test("A stale start over shows the live case and changes nothing", async () => {
  const { value, log } = deps({ start: () => ({ kind: "exists", case: NEW_CASE }), form: BLANK_RECORD(CASE.id) });
  const view = await runAction("startOver", signal, value, CASE);
  assert.deepEqual(view, { name: "existing", case: NEW_CASE });
  assert.deepEqual(log.form, BLANK_RECORD(CASE.id), "nothing of the old case was cleared");
});

test("A form screen can reach start over, and cancelling returns to the existing-case view", () => {
  const asking = askStartOver(HEIRS);
  assert.equal(asking.name, "confirmStartOver");
  assert.deepEqual(cancelStartOver(asking), { name: "existing", case: WITH_DECEASED });
});

test("caseOf names the case a view is about", () => {
  assert.equal(caseOf({ name: "loading" }), null);
  assert.equal(caseOf(HEIRS), WITH_DECEASED);
  assert.equal(caseOf({ name: "existing", case: CASE }), CASE);
  assert.equal(caseOf({ name: "confirmStartOver", case: CASE }), CASE);
  assert.equal(caseOf({ name: "throttled", resumable: CASE }), CASE);
  assert.equal(caseOf({ name: "failed", retry: "load", resumable: null }), null);
});

test("A failed add reads the case once, shows a stored heir, and keeps the input and the notice", async () => {
  const { value, log } = deps({ answer: () => ({ kind: "failed" }), read: async () => WITH_SON });
  const from = startedOf(WITH_DECEASED, true);
  const view = (await runAction("addHeir", signal, value, WITH_DECEASED, undefined, {
    kind: "addHeir",
    from,
    values: { relationship: "son", name: "" },
  })) as StartedView;
  assert.equal(log.answers.length, 1, "one write");
  assert.equal(log.reads, 1, "one read");
  assert.deepEqual(view.case.heirs, [SON]);
  assert.equal(view.notice, "failed");
  assert.equal(view.editingHeir, null);
  assert.equal(heirFormKey(view), heirFormKey(from), "the form with the typed input is not rebuilt");
});

test("A failed read after a failed add changes nothing else", async () => {
  for (const read of [
    async (): Promise<Case | null> => {
      throw new TypeError("offline");
    },
    async (): Promise<Case | null> => null,
    async (): Promise<Case | null> => ({ ...WITH_SON, id: "other" }),
  ]) {
    const { value } = deps({ answer: () => ({ kind: "failed" }), read });
    const from = startedOf(WITH_DECEASED, true);
    const view = await runAction("addHeir", signal, value, WITH_DECEASED, undefined, {
      kind: "addHeir",
      from,
      values: { relationship: "son", name: "" },
    });
    assert.deepEqual(view, { ...from, notice: "failed" });
  }
});

test("A throttled add, or a failed edit, makes no read", async () => {
  let { value, log } = deps({ answer: () => ({ kind: "throttled" }) });
  await runAction("addHeir", signal, value, WITH_DECEASED, undefined, {
    kind: "addHeir",
    from: startedOf(WITH_DECEASED, true),
    values: { relationship: "son", name: "" },
  });
  assert.equal(log.reads, 0);
  ({ value, log } = deps({ answer: () => ({ kind: "failed" }) }));
  await runAction("saveHeir", signal, value, WITH_TWO, undefined, {
    kind: "saveHeir",
    from: startedOf(WITH_TWO, true, { editingHeir: "h1" }),
    heirId: "h1",
    values: { relationship: "son", name: "" },
  });
  assert.equal(log.reads, 0);
});

test("A failed save does not bring back errors that pendingView cleared", async () => {
  const { value } = deps({ answer: () => ({ kind: "failed" }) });
  const stale = startedOf(WITH_DECEASED, true, { errors: { name: "invalid" } });
  const view = (await runAction("addHeir", signal, value, WITH_DECEASED, undefined, {
    kind: "addHeir",
    from: stale,
    values: { relationship: "son", name: "" },
  })) as StartedView;
  assert.equal(view.errors, null);
  assert.equal(view.notice, "failed");
});

test("An heir that no longer exists gets a focus request on the list", async () => {
  const { value } = deps({ answer: () => ({ kind: "missing", case: WITH_SON }) });
  const view = (await runAction("removeHeir", signal, value, WITH_TWO, undefined, {
    kind: "removeHeir",
    from: startedOf(WITH_TWO, true),
    heirId: "h2",
  })) as StartedView;
  assert.deepEqual(view.focus, { target: "list", seq: 1 });
});

test("Editing an heir with 50 stored is not refused by the client", async () => {
  const many = Array.from({ length: 50 }, (_, index) => ({ ...SON, id: `h${index}` }));
  const full: Case = { ...WITH_DECEASED, heirs: many };
  const { value, log } = deps({ answer: () => ({ kind: "saved", case: full }) });
  const view = await runAction("saveHeir", signal, value, full, undefined, {
    kind: "saveHeir",
    from: startedOf(full, true, { editingHeir: "h0" }),
    heirId: "h0",
    values: { relationship: "wife", name: "" },
  });
  assert.equal(log.answers.length, 1);
  assert.equal((view as StartedView).notice, null);
  assert.equal(precheck({ kind: "saveHeir", from: startedOf(full, true), heirId: "h0", values: { relationship: "wife", name: "" } }), null);
});

test("A half-typed new heir is parked when an heir edit starts, and comes back on cancel", () => {
  const { value, log } = deps({
    form: { caseId: WITH_TWO.id, form: "heir", layer: null, heirId: null, values: { relationship: "wife", name: "Draft" } },
  });
  const editing = startEditHeir(startedOf(WITH_TWO, true), "h1", value);
  assert.deepEqual(log.form, {
    caseId: WITH_TWO.id,
    form: "heir", layer: null,
    heirId: "h1",
    values: { relationship: "son", name: "" },
    parked: { relationship: "wife", name: "Draft" },
  });
  // Typing in the edit keeps the parked draft.
  remember(editing, "heir", { relationship: "son", name: "x" }, "name", value.forms);
  assert.deepEqual(log.form?.parked, { relationship: "wife", name: "Draft" });
  // Switching to another heir keeps the same draft.
  const other = startEditHeir(editing, "h2", value);
  assert.deepEqual(log.form?.parked, { relationship: "wife", name: "Draft" });
  const cancelled = cancelEditHeir(other, value);
  assert.deepEqual(log.form, {
    caseId: WITH_TWO.id,
    form: "heir", layer: null,
    heirId: null,
    values: { relationship: "wife", name: "Draft" },
  });
  assert.equal(cancelled.editingHeir, null);
});

test("The parked draft survives an immediate save until the editor closes", async () => {
  const { value, log } = deps({
    answer: () => ({ kind: "saved", case: WITH_TWO }),
    form: { caseId: WITH_TWO.id, form: "heir", layer: null, heirId: null, values: { relationship: "wife", name: "Draft" } },
  });
  const editing = startEditHeir(startedOf(WITH_TWO, true), "h1", value);
  const saved = await runAction("saveHeir", signal, value, WITH_TWO, undefined, {
    kind: "saveHeir",
    from: editing,
    heirId: "h1",
    values: { relationship: "son", name: "" },
  });
  assert.deepEqual(log.form?.parked, { relationship: "wife", name: "Draft" });
  cancelEditHeir(saved as StartedView, value);
  assert.deepEqual(log.form?.values, { relationship: "wife", name: "Draft" });
  assert.equal(log.form?.parked, undefined);
});

test("The draft survives a deceased edit, saved or cancelled, and view and record agree", async () => {
  const draft = { relationship: "wife", name: "Draft" };
  const record: FormRecord = { caseId: WITH_TWO.id, form: "heir", layer: null, heirId: null, values: draft };
  let { value, log } = deps({ form: record });
  const editing = startEditDeceased(startedOf(WITH_TWO, true, { editingHeir: null }), value);
  assert.equal(log.form?.form, "deceased");
  assert.deepEqual(log.form?.parked, draft);
  const cancelled = cancelEditDeceased(editing, value);
  assert.deepEqual(log.form, { ...BLANK_RECORD(WITH_TWO.id), values: draft });
  assert.equal(cancelled.editingHeir, null);

  ({ value, log } = deps({ form: record, answer: () => ({ kind: "saved", case: WITH_TWO }) }));
  const editHeirFirst = startEditHeir(startedOf(WITH_TWO, true), "h1", value);
  const toDeceased = startEditDeceased(editHeirFirst, value);
  assert.equal(toDeceased.editingHeir, null, "the heir edit was left, so the view says so");
  const saved = (await runAction("saveDeceased", signal, value, WITH_TWO, undefined, {
    kind: "saveDeceased",
    from: toDeceased,
    values: { gender: "male", estate: "" },
  })) as StartedView;
  assert.deepEqual(log.form?.values, draft);
  assert.equal(saved.editingHeir, null);
});

test("The heir form is rebuilt only when it must be cleared", async () => {
  const typing = startedOf(WITH_TWO, true);
  const { value } = deps({ answer: () => ({ kind: "saved", case: WITH_SON }) });
  const afterRemoval = (await runAction("removeHeir", signal, value, WITH_TWO, undefined, {
    kind: "removeHeir",
    from: typing,
    heirId: "h2",
  })) as StartedView;
  assert.equal(heirFormKey(afterRemoval), heirFormKey(typing), "removing another heir keeps a half-typed form");
  const afterAdd = (await runAction("addHeir", signal, deps({ answer: () => ({ kind: "saved", case: WITH_TWO }) }).value, WITH_SON, undefined, {
    kind: "addHeir",
    from: startedOf(WITH_SON, true),
    values: { relationship: "son", name: "" },
  })) as StartedView;
  assert.notEqual(heirFormKey(afterAdd), heirFormKey(startedOf(WITH_SON, true)));
  assert.notEqual(heirFormKey(startedOf(WITH_TWO, true, { editingHeir: "h1" })), heirFormKey(typing));
});

test("Removing the heir being edited ends the edit; removing another keeps it and its typed record", async () => {
  const typed: FormRecord = { caseId: WITH_TWO.id, form: "heir", layer: null, heirId: "h1", values: { relationship: "son", name: "typed" } };
  // Saved path, another heir removed.
  let { value, log } = deps({ answer: () => ({ kind: "saved", case: { ...WITH_TWO, heirs: [SON] } }), form: typed });
  const editingH1 = startedOf(WITH_TWO, true, { editingHeir: "h1" });
  let view = (await runAction("removeHeir", signal, value, WITH_TWO, undefined, {
    kind: "removeHeir",
    from: editingH1,
    heirId: "h2",
  })) as StartedView;
  assert.equal(view.editingHeir, "h1");
  assert.deepEqual(log.form, typed);
  // Saved path, the edited heir removed.
  ({ value, log } = deps({ answer: () => ({ kind: "saved", case: { ...WITH_TWO, heirs: [AMAL] } }), form: typed }));
  view = (await runAction("removeHeir", signal, value, WITH_TWO, undefined, {
    kind: "removeHeir",
    from: editingH1,
    heirId: "h1",
  })) as StartedView;
  assert.equal(view.editingHeir, null);
  assert.deepEqual(log.form, BLANK_RECORD(WITH_TWO.id));
  // Missing path, another heir gone.
  ({ value, log } = deps({ answer: () => ({ kind: "missing", case: { ...WITH_TWO, heirs: [SON] } }), form: typed }));
  view = (await runAction("removeHeir", signal, value, WITH_TWO, undefined, {
    kind: "removeHeir",
    from: editingH1,
    heirId: "h2",
  })) as StartedView;
  assert.equal(view.editingHeir, "h1");
  assert.deepEqual(log.form, typed);
  // Missing path, the edited heir gone.
  ({ value, log } = deps({ answer: () => ({ kind: "missing", case: { ...WITH_TWO, heirs: [AMAL] } }), form: typed }));
  view = (await runAction("removeHeir", signal, value, WITH_TWO, undefined, {
    kind: "removeHeir",
    from: editingH1,
    heirId: "h1",
  })) as StartedView;
  assert.equal(view.editingHeir, null);
  assert.deepEqual(log.form, BLANK_RECORD(WITH_TWO.id));
});

test("every focus target flow.ts can emit is a data-focus value in the components", () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "[locale]", "interview");
  const source = ["family-tree.tsx", "edit-sheet.tsx", "deceased-form.tsx", "heir-form.tsx", "add-relatives.tsx", "heir-list.tsx", "form-bits.tsx", "order-question.tsx", "relatives-question.tsx", "death-breadcrumb.tsx", "add-here.tsx"]
    .map((file) => readFileSync(join(dir, file), "utf8"))
    .join("\n");
  for (const target of FOCUS_TARGETS) {
    assert.ok(new RegExp(`data-focus=(\{[^}]*)?"${target}"`).test(source), target);
  }
  for (const prefix of FOCUS_PREFIXES) {
    assert.ok(source.split("data-focus=").some(part => part.split("}")[0].includes("`" + prefix + ":${")), prefix);
  }
  // The rest of flow.ts only builds targets from these, which the FocusTarget type enforces.
  const flowSource = readFileSync(join(dir, "..", "..", "..", "interview", "flow.ts"), "utf8");
  for (const [, target] of flowSource.matchAll(/nextFocus\([^,]+,\s*"([^"]+)"\)/g)) {
    assert.ok((FOCUS_TARGETS as readonly string[]).includes(target) || FOCUS_PREFIXES.some(p => target.startsWith(p + ":")), target);
  }
});

test("revealOf: add reveals the new heir even when it is not last, edit reveals the edited heir", () => {
  const added = startedOf(WITH_TWO, true, {
    announcement: { kind: "added", id: "h1", heir: { name: null, relationship: "son" }, ordinal: null, seq: 1 },
  });
  assert.equal(revealOf(added), "h1");
  const updated = startedOf(WITH_TWO, true, {
    announcement: { kind: "updated", id: "h2", heir: { name: "Amal", relationship: "daughter" }, ordinal: null, seq: 2 },
  });
  assert.equal(revealOf(updated), "h2");
});

test("revealOf: removal, failed or empty states and other views reveal nothing", async () => {
  const removed = startedOf(WITH_SON, true, {
    announcement: { kind: "removed", id: "h2", heir: { name: "Amal", relationship: "daughter" }, ordinal: null, seq: 1 },
  });
  assert.equal(revealOf(removed), null);
  assert.equal(revealOf(startedOf(WITH_SON, true)), null);
  assert.equal(revealOf({ name: "loading" }), null);
  const { value } = deps({});
  const from = startedOf(WITH_DECEASED, true);
  const failed = (await runAction("addHeir", signal, value, WITH_DECEASED, undefined, {
    kind: "addHeir",
    from,
    values: { relationship: "son", name: "" },
  })) as StartedView;
  assert.equal(revealOf(failed), null);
});

// Story 1.6: the server's rules, read from the case

const WITH_FATHER_OPTIONS: Case = {
  ...WITH_DECEASED,
  heirs: [{ id: "h9", relationship: "father", gender: "male" as const, name: null, edit_options: noHeirOptions() }],
  heir_options: { blocked: ["brother", "sister"], invalid: { father: "second_father" } },
};

test("blur flags a kinship rule from the case's options, never a blocked relative", () => {
  const view = startedOf(WITH_FATHER_OPTIONS, true);
  assert.deepEqual(blurField(view, "heir", "relationship", { relationship: "father", name: "" }).errors, {
    relationship: "second_father",
  });
  // A blocked relative can still be added, so blur has nothing to say.
  assert.equal(blurField(view, "heir", "relationship", { relationship: "brother", name: "" }).errors, null);
  assert.equal(blurField(view, "heir", "relationship", { relationship: "son", name: "" }).errors, null);
  // A required relationship still says so first.
  assert.deepEqual(blurField(view, "heir", "relationship", { relationship: "", name: "" }).errors, {
    relationship: "required",
  });
});

test("picking a relationship flags a kinship rule at once, since a select may never blur", () => {
  const { value } = deps({});
  const view = startedOf(WITH_FATHER_OPTIONS, true);
  const picked = remember(view, "heir", { relationship: "father", name: "" }, "relationship", value.forms);
  assert.deepEqual(picked.errors, { relationship: "second_father" });
  // Picking a possible relative clears it; a blocked one is only labelled.
  const fixed = remember(picked, "heir", { relationship: "brother", name: "" }, "relationship", value.forms);
  assert.equal(fixed.errors, null);
  // Typing a name leaves the relationship's error alone and never adds one.
  assert.deepEqual(
    remember(picked, "heir", { relationship: "father", name: "x" }, "name", value.forms).errors,
    { relationship: "second_father" },
  );
  // Editing an heir that has empty edit_options flags nothing (edit_options.invalid is empty).
  const editing = startedOf(WITH_FATHER_OPTIONS, true, { editingHeir: "h9" });
  assert.equal(
    remember(editing, "heir", { relationship: "father", name: "" }, "relationship", value.forms).errors,
    null,
  );
});

test("submit never refuses on the options: the server decides, and a stale tab is not stuck", async () => {
  const view = startedOf(WITH_FATHER_OPTIONS, true);
  for (const relationship of ["father", "brother"]) {
    assert.equal(precheck({ kind: "addHeir", from: view, values: { relationship, name: "" } }), null);
  }
  const { value, log } = deps({ answer: () => ({ kind: "saved", case: WITH_FATHER_OPTIONS }) });
  await runAction("addHeir", signal, value, WITH_FATHER_OPTIONS, undefined, {
    kind: "addHeir",
    from: view,
    values: { relationship: "father", name: "" },
  });
  assert.equal(log.answers.length, 1, "sent for the server to decide");
});

test("editing an heir with empty edit_options flags nothing on blur, and a case without options flags nothing", () => {
  // h9 has edit_options: noHeirOptions() (empty invalid), so blur finds no issue.
  const editing = startedOf(WITH_FATHER_OPTIONS, true, { editingHeir: "h9" });
  assert.equal(blurField(editing, "heir", "relationship", { relationship: "father", name: "" }).errors, null);
  const older = startedOf({ ...WITH_FATHER_OPTIONS, heir_options: { blocked: [], invalid: {} } }, true);
  assert.equal(blurField(older, "heir", "relationship", { relationship: "father", name: "" }).errors, null);
});

test("editing an heir uses its edit_options for the blur check, not the layer options", () => {
  // h9's edit_options says father is invalid in this family (the heir being edited is excluded).
  const editOptions = { blocked: [], invalid: { father: "second_father" as const } };
  const h9WithEditOptions = { id: "h9", relationship: "father" as const, gender: "male" as const, name: null, edit_options: editOptions };
  const caseWithEditOptions: Case = { ...WITH_FATHER_OPTIONS, heirs: [h9WithEditOptions] };
  const editing = startedOf(caseWithEditOptions, true, { editingHeir: "h9" });
  // Blurring with the same impossible relationship shows the error code from edit_options.
  assert.deepEqual(
    blurField(editing, "heir", "relationship", { relationship: "father", name: "" }).errors,
    { relationship: "second_father" },
  );
  // Blurring with a valid relationship shows no error.
  assert.equal(blurField(editing, "heir", "relationship", { relationship: "son", name: "" }).errors, null);
  // A stale heir (editingHeir set but not found in heirs) falls back to noHeirOptions() — flags nothing.
  const staleEditing = startedOf(caseWithEditOptions, true, { editingHeir: "gone" });
  assert.equal(blurField(staleEditing, "heir", "relationship", { relationship: "father", name: "" }).errors, null);
});

test("the server's refusal of a relationship is shown with all errors, values kept, and the case is fetched again", async () => {
  const live: Case = { ...WITH_FATHER_OPTIONS, heirs: [] };
  const { value, log } = deps({
    answer: () => ({ kind: "invalid", errors: { relationship: "second_father", name: "too_long" } }),
    read: async () => live,
  });
  const view = startedOf(WITH_FATHER_OPTIONS, true);
  const result = (await runAction("addHeir", signal, value, WITH_FATHER_OPTIONS, undefined, {
    kind: "addHeir",
    from: view,
    values: { relationship: "father", name: "Keep" },
  })) as StartedView;
  assert.deepEqual(result.errors, { relationship: "second_father", name: "too_long" });
  assert.equal(result.focus?.target, "relationship");
  assert.equal(log.reads, 1);
  assert.deepEqual(result.case, live);
});

test("a refusal that is not about the relationship does not fetch the case again", async () => {
  const { value, log } = deps({
    answer: () => ({ kind: "invalid", errors: { name: "too_long" } }),
    read: async () => WITH_DECEASED,
  });
  const view = startedOf(WITH_DECEASED, true);
  const result = (await runAction("addHeir", signal, value, WITH_DECEASED, undefined, {
    kind: "addHeir",
    from: view,
    values: { relationship: "son", name: "Keep" },
  })) as StartedView;
  assert.deepEqual(result.errors, { name: "too_long" });
  assert.equal(log.reads, 0);
});

test("a refused gender fetches the case again, so a spouse the tab never saw shows", async () => {
  const live: Case = { ...WITH_DECEASED, heirs: [{ id: "h5", relationship: "husband", gender: "male" as const, name: null, edit_options: noHeirOptions() }] };
  const { value, log } = deps({
    answer: () => ({ kind: "invalid", errors: { gender: "has_husband" } }),
    read: async () => live,
  });
  const view = startedOf(WITH_DECEASED, true);
  const result = (await runAction("saveDeceased", signal, value, WITH_DECEASED, undefined, {
    kind: "saveDeceased",
    from: view,
    values: { gender: "male", estate: "5" },
  })) as StartedView;
  assert.deepEqual(result.errors, { gender: "has_husband" });
  assert.equal(log.reads, 1);
  assert.deepEqual(result.case, live);
});

test("an edit refusal keeps focus on the attempted relationship and preserves the accepted family", async () => {
  const editing = startedOf(WITH_FATHER_OPTIONS, true, { editingHeir: "h9" });
  const live: Case = { ...WITH_DECEASED, heirs: [] };
  const { value } = deps({
    answer: () => ({ kind: "invalid", errors: { relationship: "second_father" } }),
    read: async () => live,
  });
  const result = (await runAction("saveHeir", signal, value, WITH_FATHER_OPTIONS, undefined, {
    kind: "saveHeir",
    from: editing, field: "editRelationship:father",
    heirId: "h9",
    values: { relationship: "father", name: "Keep" },
  })) as StartedView;
  assert.equal(result.editingHeir, "h9");
  assert.equal(result.focus?.target, "editRelationship:father");
  assert.deepEqual(result.errors, { relationship: "second_father" });
  assert.deepEqual(result.case, editing.case);
});

test("a failed or aborted read after a refusal still shows the refusal and throws nothing", async () => {
  for (const read of [
    async (): Promise<Case | null> => {
      throw new Error("offline");
    },
    async (): Promise<Case | null> => {
      throw new DOMException("aborted", "AbortError");
    },
  ]) {
    const editing = startedOf(WITH_FATHER_OPTIONS, true, { editingHeir: "h9" });
    const { value } = deps({ answer: () => ({ kind: "invalid", errors: { relationship: "second_father" } }), read });
    const result = (await runAction("saveHeir", signal, value, WITH_FATHER_OPTIONS, undefined, {
      kind: "saveHeir",
      from: editing,
      heirId: "h9",
      values: { relationship: "father", name: "Keep" },
    })) as StartedView;
    assert.deepEqual(result.errors, { relationship: "second_father" });
    assert.equal(result.editingHeir, "h9");
    assert.deepEqual(result.case, WITH_FATHER_OPTIONS);
  }
});

// Story 1.7b: successive deaths

const W = { id: "w", relationship: "wife" as const, gender: "female" as const, name: "Amal", edit_options: noHeirOptions() };
const S1 = { id: "s1", relationship: "son" as const, gender: "male" as const, name: null, edit_options: noHeirOptions() };
const S2 = { id: "s2", relationship: "son" as const, gender: "male" as const, name: null, edit_options: noHeirOptions() };
const FAMILY: Case = { ...WITH_DECEASED, heirs: [W, S1, S2] };
const S1_DEATH = {
  heir_id: "s1",
  order: 2 as const,
  gender: "male" as const,
  heir_options: { blocked: ["brother" as const], invalid: { husband: "husband_of_male" } },
  heirs: [{ id: "r1", relationship: "mother" as const, gender: "female" as const, name: "Amal", same_as: "w", edit_options: noHeirOptions() }],
};
const TWO_LAYERS: Case = { ...FAMILY, deaths: [S1_DEATH] };

test("marking a death opens the layer of the person, focuses the form and ends any edit", async () => {
  const from = startedOf(FAMILY, true, { editingHeir: "w" });
  const { value, log } = deps({ answer: () => ({ kind: "saved", case: TWO_LAYERS }), form: BLANK_RECORD(FAMILY.id, "w") });
  const view = (await runAction("markDeath", signal, value, FAMILY, undefined, {
    kind: "markDeath",
    from,
    rowId: "s1",
  })) as StartedView;
  assert.deepEqual(log.answers, [{ call: "markDeceased", caseId: FAMILY.id, heirId: "s1" }]);
  assert.equal(view.layer, "s1");
  assert.equal(view.editingHeir, null);
  assert.equal(view.ordering, null);
  assert.equal(view.focus?.target, "relationship");
  assert.equal(view.formEpoch, from.formEpoch + 1);
});

test("marking a linked row opens the layer of the person, not of the row", async () => {
  const withW: Case = {
    ...TWO_LAYERS,
    deaths: [S1_DEATH, { ...S1_DEATH, heir_id: "w", order: 3, heirs: [] }],
  };
  const from = startedOf(TWO_LAYERS, true, { layer: "s1" });
  const { value } = deps({ answer: () => ({ kind: "saved", case: withW }) });
  const view = (await runAction("markDeath", signal, value, TWO_LAYERS, undefined, {
    kind: "markDeath",
    from,
    rowId: "r1",
  })) as StartedView;
  assert.equal(view.layer, "w");
});

test("an order refusal keeps the question open on its row with focus on it, case unchanged", async () => {
  for (const code of ["order_required", "simultaneous", "unknown", "order_conflict"]) {
    const from = startedOf(TWO_LAYERS, true);
    const { value, log } = deps({ answer: () => ({ kind: "invalid", errors: { death: code } }) });
    const view = (await runAction("markDeath", signal, value, TWO_LAYERS, undefined, {
      kind: "markDeath",
      from,
      rowId: "s2",
    })) as StartedView;
    assert.equal(view.ordering, "s2", code);
    assert.deepEqual(view.errors, { death: code });
    assert.equal(view.focus?.target, "death-order");
    assert.deepEqual(view.case, TWO_LAYERS);
    assert.equal(log.reads, 0, "a death refusal reads nothing again");
  }
});

test("the answer to the order question is resent as first", async () => {
  const from = startedOf(TWO_LAYERS, true, { ordering: "s2" });
  const three: Case = { ...TWO_LAYERS, deaths: [S1_DEATH, { ...S1_DEATH, heir_id: "s2", order: 3, heirs: [] }] };
  const { value, log } = deps({ answer: () => ({ kind: "saved", case: three }) });
  const view = (await runAction("markDeath", signal, value, TWO_LAYERS, undefined, {
    kind: "markDeath",
    from,
    rowId: "s2",
    first: "s1",
  })) as StartedView;
  assert.deepEqual(log.answers, [{ call: "markDeceased", caseId: FAMILY.id, heirId: "s2", fields: { first: "s1" } }]);
  assert.equal(view.ordering, null);
  assert.equal(view.layer, "s2");
});

test("a limit or already-deceased refusal closes the question and focuses the button of the row", async () => {
  for (const code of ["limit", "already_deceased"]) {
    const from = startedOf(TWO_LAYERS, true, { ordering: "s2" });
    const { value } = deps({ answer: () => ({ kind: "invalid", errors: { death: code } }) });
    const view = (await runAction("markDeath", signal, value, TWO_LAYERS, undefined, {
      kind: "markDeath",
      from,
      rowId: "s2",
    })) as StartedView;
    assert.equal(view.ordering, null);
    assert.deepEqual(view.errors, { death: code });
    assert.equal(view.focus?.target, "alsoDied:s2");
    assert.equal(view.layer, null);
  }
});

test("taking back a death falls back to the first layer when the active one is gone", async () => {
  const from = startedOf(TWO_LAYERS, true, { layer: "s1" });
  const { value, log } = deps({ answer: () => ({ kind: "saved", case: FAMILY }) });
  const view = (await runAction("unmarkDeath", signal, value, TWO_LAYERS, undefined, {
    kind: "unmarkDeath",
    from,
    heirId: "s1",
    rowId: "s1",
  })) as StartedView;
  assert.deepEqual(log.answers, [{ call: "unmarkDeceased", caseId: FAMILY.id, heirId: "s1" }]);
  assert.equal(view.layer, null);
  assert.equal(view.focus?.target, "alsoDied:s1");
});

test("taking back a deeper death keeps the active layer while it exists", async () => {
  const three: Case = { ...TWO_LAYERS, deaths: [S1_DEATH, { ...S1_DEATH, heir_id: "w", order: 3, heirs: [] }] };
  const from = startedOf(three, true, { layer: "s1" });
  const { value } = deps({ answer: () => ({ kind: "saved", case: TWO_LAYERS }) });
  const view = (await runAction("unmarkDeath", signal, value, three, undefined, {
    kind: "unmarkDeath",
    from,
    heirId: "w",
    rowId: "r1",
  })) as StartedView;
  assert.equal(view.layer, "s1");
});

test("removing the person who owns the active layer falls back after the write", async () => {
  const from = startedOf(TWO_LAYERS, true, { layer: "s1" });
  const { value } = deps({ answer: () => ({ kind: "saved", case: { ...FAMILY, heirs: [W, S2] } }) });
  const view = (await runAction("removeHeir", signal, value, TWO_LAYERS, undefined, {
    kind: "removeHeir",
    from,
    heirId: "s1",
  })) as StartedView;
  assert.equal(view.layer, null);
});

test("adding in a later layer sends the layer, and a link sends same_as with no name", async () => {
  const from = startedOf(TWO_LAYERS, true, { layer: "s1" });
  const { value, log } = deps({ answer: () => ({ kind: "saved", case: TWO_LAYERS }) });
  await runAction("addHeir", signal, value, TWO_LAYERS, undefined, {
    kind: "addHeir",
    from,
    values: { relationship: "brother", name: "ignored", same_as: "s2" },
  });
  assert.deepEqual(log.answers[0].fields, { relationship: "brother", name: null, same_as: "s2", layer: "s1" });
  await runAction("addHeir", signal, value, TWO_LAYERS, undefined, {
    kind: "addHeir",
    from,
    values: { relationship: "wife", name: "Huda" },
  });
  assert.deepEqual(log.answers[1].fields, { relationship: "wife", name: "Huda", layer: "s1" });
  // The first layer sends no layer at all.
  await runAction("addHeir", signal, value, TWO_LAYERS, undefined, {
    kind: "addHeir",
    from: startedOf(TWO_LAYERS, true),
    values: { relationship: "wife", name: "" },
  });
  assert.deepEqual(log.answers[2].fields, { relationship: "wife", name: null });
});

test("a link with nobody picked is refused before anything is sent, focusing the picker", () => {
  const blocked = precheck({
    kind: "addHeir",
    from: startedOf(TWO_LAYERS, true, { layer: "s1" }),
    values: { relationship: "brother", name: "", same_as: "pending" },
  });
  assert.deepEqual(blocked?.errors, { same_as: "required" });
  assert.equal(blocked?.focus?.target, "same_as");
});

test("a refused link is shown on the picker with its code, and nothing entered is lost", async () => {
  const from = startedOf(TWO_LAYERS, true, { layer: "s1" });
  const { value } = deps({ answer: () => ({ kind: "invalid", errors: { same_as: "gender_mismatch", heirs: "limit" } }) });
  const view = (await runAction("addHeir", signal, value, TWO_LAYERS, undefined, {
    kind: "addHeir",
    from,
    values: { relationship: "brother", name: "", same_as: "w" },
  })) as StartedView;
  assert.deepEqual(view.errors, { same_as: "gender_mismatch", heirs: "limit" });
  assert.equal(view.focus?.target, "same_as");
  assert.equal(view.layer, "s1");
});

test("openLayer moves the screen, ends an edit, keeps the draft and refuses a death that is gone", () => {
  const { value, log } = deps({
    form: { caseId: FAMILY.id, form: "heir", layer: null, heirId: "w", values: { relationship: "wife" }, parked: { name: "draft" } },
  });
  const editing = startedOf(TWO_LAYERS, true, { editingHeir: "w", ordering: "s2", errors: { death: "unknown" } });
  const opened = openLayer(editing, "s1", value);
  assert.equal(opened.layer, "s1");
  assert.equal(opened.editingHeir, null);
  assert.equal(opened.ordering, null);
  assert.equal(opened.errors, null);
  assert.equal(opened.focus?.target, "relationship");
  assert.deepEqual(log.form?.values, { ...BLANK_RECORD(FAMILY.id).values, name: "draft", same_as: "" });
  // Not mid-save, and not a layer that does not exist.
  const saving = startedOf(TWO_LAYERS, true, { saving: true });
  assert.equal(openLayer(saving, "s1", value), saving);
  assert.equal(openLayer(startedOf(TWO_LAYERS, true, { layer: "s1" }), "nobody", value).layer, null);
  assert.equal(openLayer(startedOf(TWO_LAYERS, true, { layer: "s1" }), null, value).layer, null);
});

test("cancelOrder closes the question and returns focus to the button of the row", () => {
  const view = cancelOrder(startedOf(TWO_LAYERS, true, { ordering: "s2", errors: { death: "unknown" } }));
  assert.equal(view.ordering, null);
  assert.equal(view.errors, null);
  assert.equal(view.focus?.target, "alsoDied:s2");
  const none = startedOf(TWO_LAYERS, true);
  assert.equal(cancelOrder(none), none);
});

test("the relationship hint on blur and pick reads the options of the active layer", () => {
  const { value } = deps({});
  const first = startedOf(TWO_LAYERS, true);
  assert.equal(blurField(first, "heir", "relationship", { relationship: "husband", name: "" }).errors, null);
  const later = startedOf(TWO_LAYERS, true, { layer: "s1" });
  assert.deepEqual(blurField(later, "heir", "relationship", { relationship: "husband", name: "" }).errors, {
    relationship: "husband_of_male",
  });
  assert.deepEqual(remember(later, "heir", { relationship: "husband", name: "" }, "relationship", value.forms).errors, {
    relationship: "husband_of_male",
  });
});

test("the heir limit counts the layer being added to", () => {
  const rows = Array.from({ length: 50 }, (_, index) => ({ ...S2, id: `x${index}` }));
  const full: Case = { ...TWO_LAYERS, deaths: [{ ...S1_DEATH, heirs: rows }] };
  assert.deepEqual(
    precheck({ kind: "addHeir", from: startedOf(full, true, { layer: "s1" }), values: { relationship: "son", name: "" } })?.errors,
    { heirs: "limit" },
  );
  assert.equal(
    precheck({ kind: "addHeir", from: startedOf(full, true), values: { relationship: "son", name: "" } }),
    null,
  );
});

test("a failed mark keeps the order question and the layer", async () => {
  const from = startedOf(TWO_LAYERS, true, { layer: "s1", ordering: "r1" });
  const { value } = deps({ answer: () => ({ kind: "throttled" }) });
  const view = (await runAction("markDeath", signal, value, TWO_LAYERS, undefined, {
    kind: "markDeath",
    from,
    rowId: "r1",
    first: "unknown",
  })) as StartedView;
  assert.equal(view.notice, "throttled");
  assert.equal(view.ordering, "r1");
  assert.equal(view.layer, "s1");
});

test("editing a row of a later layer finds it there, and a reveal is for the active layer only", () => {
  const { value } = deps({});
  const later = startedOf(TWO_LAYERS, true, { layer: "s1" });
  assert.equal(startEditHeir(later, "r1", value).editingHeir, "r1");
  // r1 is not in the first layer, so editing it from there finds nothing.
  assert.equal(startEditHeir(startedOf(TWO_LAYERS, true), "r1", value).editingHeir, null);
  const note = { kind: "added" as const, id: "r1", heir: { name: null, relationship: "mother" as const }, ordinal: null, seq: 1 };
  assert.equal(revealOf(startedOf(TWO_LAYERS, true, { layer: "s1", announcement: note })), "r1");
  assert.equal(revealOf(startedOf(TWO_LAYERS, true, { announcement: note })), null);
});

test("a case with no deaths keeps its first layer when written to", async () => {
  const from = startedOf(FAMILY, true);
  const { value } = deps({ answer: () => ({ kind: "saved", case: FAMILY }) });
  const view = (await runAction("addHeir", signal, value, FAMILY, undefined, {
    kind: "addHeir",
    from,
    values: { relationship: "daughter", name: "" },
  })) as StartedView;
  assert.equal(view.layer, null);
  assert.equal(view.ordering, null);
});


test("reload restores later-layer drafts and edits and drops drafts whose death is gone", async () => {
  for (const heirId of [null, "r1"]) {
    const from = startedOf(TWO_LAYERS, true, { layer: "s1", editingHeir: heirId });
    const { value, log } = deps({ read: async () => TWO_LAYERS });
    remember(from, "heir", { relationship: "mother", name: "Keep" }, "name", value.forms);
    assert.equal(log.form?.layer, "s1");
    const resumed = await runAction("resume", signal, value) as StartedView;
    assert.equal(resumed.layer, "s1");
    assert.equal(resumed.editingHeir, heirId);
    assert.equal(log.form?.values.name, "Keep");
    value.fetchCase = async () => FAMILY;
    const gone = await runAction("resume", signal, value) as StartedView;
    assert.equal(gone.layer, null);
    assert.equal(gone.editingHeir, null);
    assert.equal(log.form?.values.name, "");
  }
});

test("changing layers clears the layer-specific link but keeps the draft's relationship and name", () => {
  const from = startedOf(TWO_LAYERS, true, { layer: "s1" });
  const { value, log } = deps({});
  remember(from, "heir", { relationship: "mother", name: "Keep", same_as: "w" }, "name", value.forms);
  openLayer(from, null, value);
  assert.deepEqual(log.form?.values, { relationship: "mother", name: "Keep", same_as: "" });
  assert.equal(log.form?.layer, null);
});

test("already deceased refreshes the case and failed reads keep it", async () => {
  for (const [read, expected] of [[async () => TWO_LAYERS, TWO_LAYERS], [async () => { throw new Error("offline"); }, FAMILY]] as const) {
    const from = startedOf(FAMILY, true);
    const { value, log } = deps({ read, answer: () => ({ kind: "invalid", errors: { death: "already_deceased" } }) });
    const view = await runAction("markDeath", signal, value, FAMILY, undefined, { kind: "markDeath", from, rowId: "s1" }) as StartedView;
    assert.equal(log.reads, 1);
    assert.equal(view.case, expected);
    assert.equal(view.errors?.death, "already_deceased");
    assert.equal(view.layer, null);
  }
});

test("every refreshed save drops stale ordering and resets a deleted layer's draft and focus", async () => {
  const results: AnswerResult[] = [
    { kind: "invalid", errors: { relationship: "invalid" } },
    { kind: "missing", case: FAMILY },
    { kind: "failed" },
    { kind: "invalid", errors: { death: "already_deceased" } },
  ];
  for (const result of results) {
    const from = startedOf(TWO_LAYERS, true, { layer: "s1", ordering: "r1", formEpoch: 7 });
    const { value, log } = deps({ read: async () => FAMILY, answer: () => result });
    remember(from, "heir", { relationship: "mother", name: "Do not retry" }, "name", value.forms);
    const answer: Answer = result.kind === "invalid" && result.errors.death
      ? { kind: "markDeath", from, rowId: "r1" }
      : { kind: "addHeir", from, values: { relationship: "mother", name: "Do not retry" } };
    const view = await runAction(answer.kind, signal, value, TWO_LAYERS, undefined, answer) as StartedView;
    assert.equal(view.case, FAMILY);
    assert.equal(view.layer, null);
    assert.equal(view.ordering, null);
    assert.equal(view.formEpoch, 8);
    assert.equal(view.focus?.target, "relationship");
    assert.equal(log.form?.values.name, "");
  }
});

test("marking and unmarking deaths produce dedicated announcements with localized text", async () => {
  const { messages, locales } = await import("../i18n/messages.ts");
  const { fill, heirLabel } = await import("./answers.ts");
  for (const kind of ["markDeath", "unmarkDeath"] as const) {
    const from = startedOf(kind === "markDeath" ? FAMILY : TWO_LAYERS, true);
    const { value } = deps({ answer: () => ({ kind: "saved", case: kind === "markDeath" ? TWO_LAYERS : FAMILY }) });
    const answer: Answer = kind === "markDeath" ? { kind, from, rowId: "s1" } : { kind, from, rowId: "s1", heirId: "s1" };
    const view = await runAction(kind, signal, value, from.case, undefined, answer) as StartedView;
    const note = view.announcement!;
    assert.equal(note.kind, kind === "markDeath" ? "deathMarked" : "deathUnmarked");
    for (const locale of locales) {
      const text = messages[locale].interview;
      const template: string = text[note.kind === "deathMarked" ? "deathMarked" : "deathUnmarked"];
      const label = heirLabel(note.heir, text.relationships, text.heirNumbered, note.ordinal);
      assert.ok(fill(template, label).includes(label));
      assert.ok(!fill(template, label).includes("{heir}"));
    }
    const text = messages.en.interview;
    assert.equal(fill(text[note.kind === "deathMarked" ? "deathMarked" : "deathUnmarked"], "Son"), kind === "markDeath"
      ? "Son is marked as having died; add their heirs."
      : "Son is no longer marked as having died; their heirs were removed.");
  }
});


test("refresh clears a missing order row while retaining a surviving layer and draft", async () => {
  const from = startedOf(TWO_LAYERS, true, { layer: "s1", ordering: "r1", formEpoch: 3 });
  const fresh = { ...TWO_LAYERS, deaths: [{ ...S1_DEATH, heirs: [] }] };
  const { value, log } = deps({ read: async () => fresh, answer: () => ({ kind: "failed" }) });
  remember(from, "heir", { relationship: "mother", name: "Keep" }, "name", value.forms);
  const view = await runAction("addHeir", signal, value, TWO_LAYERS, undefined, {
    kind: "addHeir", from, values: { relationship: "mother", name: "Keep" },
  }) as StartedView;
  assert.equal(view.ordering, null);
  assert.equal(view.layer, "s1");
  assert.equal(view.formEpoch, 3);
  assert.equal(log.form?.values.name, "Keep");
});


test("resume never restores an edit from a different layer, and legacy records use the first", async () => {
  for (const layer of [undefined, "s1"]) {
    const { value } = deps({ read: async () => TWO_LAYERS, form: {
      caseId: TWO_LAYERS.id, form: "heir", heirId: "w", values: { relationship: "wife", name: "Keep" },
      ...(layer === undefined ? {} : { layer }),
    } });
    const view = await runAction("resume", signal, value) as StartedView;
    assert.equal(view.layer, layer ?? null);
    assert.equal(view.editingHeir, layer === undefined ? "w" : null);
  }
});


test("relative and order questions stay together and a single resend carries both answers", async () => {
  const questions = [{ id: "w", person: "w", kind: "relative" as const, options: ["mother", "none"], suggested: "mother" }];
  const { value } = deps({ answer: () => ({ kind: "invalid", errors: { death: "order_required", relatives: "required" }, questions }) });
  const from = startedOf(TWO_LAYERS, true);
  const refused = await runAction("markDeath", signal, value, TWO_LAYERS, undefined, { kind: "markDeath", from, rowId: "s2" }) as StartedView;
  assert.equal(refused.ordering, "s2");
  assert.deepEqual(refused.relativeQuestions, questions);
  assert.equal(refused.deathOrderNeeded, true);
  assert.deepEqual(refused.case, from.case);
  assert.equal(refused.focus?.target, "death-order");
  let sent: unknown;
  value.markDeceased = async (_signal, _caseId, _revision, _heirId, first, answers) => {
    sent = { first, answers };
    return { kind: "saved", case: TWO_LAYERS };
  };
  const answers = { relatives: { w: "mother" } };
  const saved = await runAction("markDeath", signal, value, TWO_LAYERS, undefined, {
    kind: "markDeath", from: { ...refused, deathFirst: "s1" }, rowId: "s2", answers,
  }) as StartedView;
  assert.deepEqual(sent, { first: "s1", answers });
  assert.equal(saved.relativeQuestions, undefined);
  assert.equal(saved.ordering, null);
});

test("a relatives-only refusal focuses the questions, retaining choices on failure", async () => {
  const questions = [{ id: "w", person: "w", kind: "relative" as const, options: ["mother", "none"], suggested: "mother" }];
  const { value } = deps({ answer: () => ({ kind: "invalid", errors: { relatives: "required" }, questions }) });
  const from = startedOf(FAMILY, true);
  const refused = await runAction("markDeath", signal, value, FAMILY, undefined, { kind: "markDeath", from, rowId: "s1" }) as StartedView;
  assert.equal(refused.focus?.target, "relatives");
  assert.equal(refused.ordering, "s1");
  assert.equal(cancelOrder(refused).relativeQuestions, undefined);
});


test("the per-row female answers retain the shared-father answer from the earlier question", async () => {
  const { value } = deps({});
  let sent: unknown;
  value.markDeceased = async (_signal, _caseId, _revision, _heirId, _first, answers) => {
    sent = answers;
    return { kind: "saved", case: TWO_LAYERS };
  };
  const open = [
    { id: "shared_father", person: "s1", kind: "shared_father" as const, options: ["yes", "no"], suggested: "yes" },
    { id: "w", person: "w", kind: "relative" as const, options: ["father", "none"], suggested: "father" },
  ];
  const from = startedOf(FAMILY, true, { ordering: "s1", relativeQuestions: open, deathAnswers: { shared_father: "no" } });
  await runAction("markDeath", signal, value, FAMILY, undefined, {
    kind: "markDeath", from, rowId: "s1", answers: { relatives: { w: "none", s2: "maternal_brother" } },
  });
  assert.deepEqual(sent, { shared_father: "no", relatives: { w: "none", s2: "maternal_brother" } });
});


test("a resend drops stored answers for questions that are no longer open", async () => {
  const { value } = deps({});
  let sent: unknown;
  value.markDeceased = async (_signal, _caseId, _revision, _heirId, _first, answers) => {
    sent = answers;
    return { kind: "saved", case: TWO_LAYERS };
  };
  const open = [{ id: "w", person: "w", kind: "relative" as const, options: ["mother", "none"], suggested: "mother" }];
  const from = startedOf(FAMILY, true, {
    ordering: "s1", relativeQuestions: open,
    deathAnswers: { relatives: { w: "mother", gone: "brother" }, shared_father: "yes" },
  });
  await runAction("markDeath", signal, value, FAMILY, undefined, { kind: "markDeath", from, rowId: "s1" });
  assert.deepEqual(sent, { relatives: { w: "mother" } });
});

test("questions for one death never supply answers to a different person's death", async () => {
  const { value } = deps({});
  let sent: unknown;
  value.markDeceased = async (_signal, _caseId, _revision, heirId, first, answers) => {
    sent = { heirId, first, answers };
    return { kind: "saved", case: TWO_LAYERS };
  };
  const from = startedOf(FAMILY, true, { ordering: "s2", deathFirst: "s2", deathAnswers: { relatives: { w: "none" } } });
  await runAction("markDeath", signal, value, FAMILY, undefined, { kind: "markDeath", from, rowId: "s1" });
  assert.deepEqual(sent, { heirId: "s1", first: undefined, answers: {} });
});

test("every write and the start over carry the revision of the case the page shows", async () => {
  const shown: Case = { ...TWO_LAYERS, revision: 3 };
  const answers: Answer[] = [
    { kind: "saveDeceased", from: startedOf(shown, true), values: { gender: "male", estate: "" } },
    { kind: "addHeir", from: startedOf(shown, true), values: { relationship: "son", name: "Amal" } },
    { kind: "saveHeir", from: startedOf(shown, true), heirId: "w", values: { relationship: "wife", name: "Amal" } },
    { kind: "removeHeir", from: startedOf(shown, true), heirId: "s2" },
    { kind: "markDeath", from: startedOf(shown, true), rowId: "s2" },
    { kind: "unmarkDeath", from: startedOf(shown, true), heirId: "s1", rowId: "s1" },
  ];
  for (const answer of answers) {
    const { value, log } = deps({ answer: () => ({ kind: "failed" }) });
    await runAction(answer.kind, signal, value, shown, undefined, answer);
    assert.deepEqual(log.revisions, [3], answer.kind);
  }
  const choosing = deps({ choose: () => ({ kind: "failed" }) });
  await runAction("choose", signal, choosing.value, shown, { madhab: "jafari", from: startedOf(shown, true) });
  assert.deepEqual(choosing.log.revisions, [3], "choose");
  const starting = deps({ start: () => ({ kind: "failed" }) });
  await runAction("startOver", signal, starting.value, shown);
  assert.deepEqual(starting.log.startRevisions, [3], "startOver");
});

const PANEL_SON = (from: StartedView, count = 1): Answer => ({
  kind: "addHeir",
  from,
  values: { relationship: "son", name: "", same_as: "" },
  origin: "panel",
  count,
});

test("bulk add keeps the form, adopts the returned case and announces the group once", async () => {
  const record: FormRecord = { caseId: WITH_SON.id, form: "heir", layer: null, heirId: SON.id, values: { relationship: "son", name: "Typed" } };
  const returned = { ...WITH_SON, revision: 4, heirs: [SON, { ...SON, id: "new1" }, { ...SON, id: "new2" }] };
  const { value, log } = deps({ answer: () => ({ kind: "saved", case: returned }), form: record });
  const from = startedOf(WITH_SON, true, { editingHeir: SON.id, formEpoch: 2 });
  const view = await runAction("addHeir", signal, value, WITH_SON, undefined, PANEL_SON(from, 2)) as StartedView;
  assert.deepEqual(log.answers, [{ call: "addHeirs", caseId: WITH_SON.id, fields: { relationship: "son", count: 2, layer: undefined } }]);
  assert.deepEqual(log.revisions, [3]);
  assert.equal(view.case, returned);
  assert.equal(view.editingHeir, SON.id);
  assert.equal(view.formEpoch, 2);
  assert.deepEqual(log.form, record);
  assert.equal(view.focus?.target, "add:son");
  assert.equal(view.announcement?.panelCount, 2);
  assert.equal(view.announcement?.seq, 1);
});

test("bulk add checks remaining room in the selected layer before sending", async () => {
  const layer = { ...S1_DEATH, heirs: Array.from({ length: 48 }, (_, i) => ({ ...SON, id: `row${i}` })) };
  const kase = { ...FAMILY, deaths: [layer] };
  const from = startedOf(kase, true, { layer: layer.heir_id });
  const { value, log } = deps({ answer: () => ({ kind: "invalid", errors: { heirs: "limit" } }) });
  for (const count of [3, 2]) {
    const view = await runAction("addHeir", signal, value, kase, undefined, PANEL_SON(from, count)) as StartedView;
    assert.deepEqual(view.panel, { relationship: "son", errors: { heirs: "limit" } });
    assert.equal(view.case, kase);
    assert.equal(view.focus?.target, "add:son");
    assert.equal(log.answers.length, count === 3 ? 0 : 1);
  }
  assert.deepEqual(log.answers[0].fields, { relationship: "son", count: 2, layer: layer.heir_id });
  assert.equal(log.reads, 0);
});

test("panel add: one command at the current revision, no name, focus on the button, form kept", async () => {
  const record: FormRecord = { caseId: WITH_SON.id, form: "heir", layer: null, heirId: "h1", values: { relationship: "son", name: "Typed" } };
  const added = { ...SON, id: "h3" };
  const { value, log } = deps({ answer: () => ({ kind: "saved", case: { ...WITH_SON, revision: 4, heirs: [SON, added] } }), form: record });
  const from = startedOf(WITH_SON, true, { editingHeir: "h1", formEpoch: 2 });
  const view = (await runAction("addHeir", signal, value, WITH_SON, undefined, PANEL_SON(from))) as StartedView;
  assert.equal(log.answers.length, 1);
  assert.deepEqual(log.answers[0].fields, { relationship: "son", name: null });
  assert.deepEqual(log.revisions, [3]);
  assert.equal(view.case.heirs.length, 2);
  assert.equal(view.editingHeir, "h1");
  assert.equal(view.formEpoch, 2);
  assert.equal(view.focus?.target, "add:son");
  assert.equal(view.announcement?.kind, "added");
  assert.equal(view.announcement?.ordinal, 2);
  assert.deepEqual(log.form, record, "the typed text is untouched");
});

test("a form add still resets the form and focuses the relationship", async () => {
  const { value, log } = deps({ answer: () => ({ kind: "saved", case: { ...WITH_SON, heirs: [SON, { ...SON, id: "h3" }] } }) });
  const view = (await runAction("addHeir", signal, value, WITH_SON, undefined, {
    kind: "addHeir",
    from: startedOf(WITH_SON, true),
    values: { relationship: "son", name: "" },
  })) as StartedView;
  assert.equal(view.formEpoch, 1);
  assert.equal(view.focus?.target, "relationship");
  assert.deepEqual(log.form, BLANK_RECORD(WITH_SON.id));
});

test("panel add refused: the case is re-read, the refusal shows in the panel, not the form", async () => {
  const { value, log } = deps({
    answer: () => ({ kind: "invalid", errors: { relationship: "second_father" } }),
    read: async () => WITH_SON,
  });
  const view = (await runAction("addHeir", signal, value, WITH_SON, undefined, PANEL_SON(startedOf(WITH_SON, true)))) as StartedView;
  assert.equal(log.reads, 1);
  assert.equal(view.errors, null);
  assert.deepEqual(view.panel, { relationship: "son", errors: { relationship: "second_father" } });
  assert.equal(view.focus?.target, "add:son");
  assert.equal(view.case.heirs.length, 1);
});

test("panel add: a stale revision with the same case id stays started on the returned case, no resend", async () => {
  const live: Case = { ...WITH_SON, revision: 5, heirs: [SON, AMAL] };
  const { value, log } = deps({ answer: () => ({ kind: "replaced", case: live }) });
  const view = (await runAction("addHeir", signal, value, WITH_SON, undefined, PANEL_SON(startedOf(WITH_SON, true)))) as StartedView;
  assert.equal(view.name, "started");
  assert.equal(view.case.revision, 5);
  assert.deepEqual(view.panel, { relationship: "son", notice: "conflict" });
  assert.equal(view.focus?.target, "add:son");
  assert.equal(log.answers.length, 1);
  // A different case id keeps the existing-case screen.
  const other = deps({ answer: () => ({ kind: "replaced", case: NEW_CASE }) });
  const away = await runAction("addHeir", signal, other.value, WITH_SON, undefined, PANEL_SON(startedOf(WITH_SON, true)));
  assert.deepEqual(away, { name: "existing", case: NEW_CASE });
});

test("panel add: throttled shows the notice in the panel and keeps focus on the button", async () => {
  const { value } = deps({ answer: () => ({ kind: "throttled" }) });
  const view = (await runAction("addHeir", signal, value, WITH_SON, undefined, PANEL_SON(startedOf(WITH_SON, true)))) as StartedView;
  assert.equal(view.notice, null);
  assert.deepEqual(view.panel, { relationship: "son", notice: "throttled" });
  assert.equal(view.focus?.target, "add:son");
});

test("a bulk conflict adopts the returned family without resending or announcing an add", async () => {
  const live = { ...WITH_SON, revision: 5, heirs: [SON, AMAL] };
  const { value, log } = deps({ answer: () => ({ kind: "replaced", case: live }) });
  const from = startedOf(WITH_SON, true);
  const view = await runAction("addHeir", signal, value, WITH_SON, undefined, PANEL_SON(from, 2)) as StartedView;
  assert.deepEqual(log.answers.map(call => call.call), ["addHeirs"]);
  assert.equal(view.case, live);
  assert.deepEqual(view.panel, { relationship: "son", notice: "conflict" });
  assert.equal(view.focus?.target, "add:son");
  assert.equal(view.announcement, null);
});

test("panel add at 50 heirs: the precheck refuses and sends nothing", async () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ ...SON, id: `m${i}` }));
  const full: Case = { ...WITH_DECEASED, heirs: many };
  const { value, log } = deps({});
  const view = (await runAction("addHeir", signal, value, full, undefined, PANEL_SON(startedOf(full, true)))) as StartedView;
  assert.equal(log.answers.length, 0);
  assert.deepEqual(view.panel, { relationship: "son", errors: { heirs: "limit" } });
  assert.equal(view.errors, null);
});

test("pending view clears the panel outcome", () => {
  const current = startedOf(WITH_SON, true, { panel: { relationship: "son", notice: "conflict" } });
  assert.equal((pendingView("addHeir", current) as StartedView).panel, undefined);
});

test("panel add on a later death: announcement from that layer, layer kept, focus on the button", async () => {
  const r0 = { id: "r0", relationship: "brother" as const, gender: "male" as const, name: null, edit_options: noHeirOptions() };
  const r2 = { ...r0, id: "r2" };
  const before: Case = { ...FAMILY, deaths: [{ ...S1_DEATH, heirs: [r0] }] };
  const after: Case = { ...FAMILY, revision: 4, deaths: [{ ...S1_DEATH, heirs: [r0, r2] }] };
  const { value } = deps({ answer: () => ({ kind: "saved", case: after }) });
  const from = startedOf(before, true, { layer: "s1" });
  const view = (await runAction("addHeir", signal, value, before, undefined, {
    kind: "addHeir",
    from,
    values: { relationship: "brother", name: "", same_as: "" },
    origin: "panel",
  })) as StartedView;
  assert.equal(view.layer, "s1");
  assert.equal(view.focus?.target, "add:brother");
  assert.equal(view.announcement?.id, "r2");
  assert.deepEqual(view.announcement?.heir, { name: null, relationship: "brother" });
  assert.equal(view.announcement?.ordinal, 2);
});

test("openLayer clears the panel outcome", () => {
  const { value } = deps({});
  const view = startedOf(TWO_LAYERS, true, { panel: { relationship: "son", notice: "conflict" } });
  const next = openLayer(view, "s1", value);
  assert.equal(next.layer, "s1");
  assert.equal("panel" in next, false);
});

// Story 9.6: Undo
const snap = (tag: string) => ({ tag });
const rev = (kase: Case, revision: number, tag: string): Case => ({ ...kase, revision, snapshot: snap(tag) });
const U0 = rev(WITH_SON, 5, "u0");
const U1 = rev(WITH_TWO, 6, "u1");

test("Undo history: a saved add pushes one entry holding the prior snapshot, with a toast", async () => {
  const { value } = deps({ answer: () => ({ kind: "saved", case: U1 }) });
  const view = (await runAction("addHeir", signal, value, U0, undefined, {
    kind: "addHeir", from: startedOf(U0, true), values: { relationship: "daughter", name: "Amal" },
  })) as StartedView;
  assert.deepEqual(view.history, [{ snapshot: snap("u0") }]);
  assert.equal(view.undoToast?.key, 1);
  assert.equal(view.undoToast?.announcement.kind, "added");
});

test("Undo history: a saved bulk add pushes exactly one entry and one toast", async () => {
  const { value, log } = deps({ answer: () => ({ kind: "saved", case: rev(WITH_TWO, 6, "u1") }) });
  const view = (await runAction("addHeir", signal, value, U0, undefined, {
    kind: "addHeir", from: startedOf(U0, true), origin: "panel", count: 4, values: { relationship: "daughter", name: "", same_as: "" },
  })) as StartedView;
  assert.equal(log.answers[0].call, "addHeirs");
  assert.deepEqual(view.history, [{ snapshot: snap("u0") }]);
  assert.equal(view.undoToast?.key, 1);
});

test("Undo history: edits and removals record the person; deaths record the heir", async () => {
  const { value } = deps({ answer: () => ({ kind: "saved", case: U1 }) });
  const edited = (await runAction("saveHeir", signal, value, U0, undefined, {
    kind: "saveHeir", from: startedOf(U0, true), heirId: "h1", values: { relationship: "son", name: "Ali" },
  })) as StartedView;
  assert.deepEqual(edited.history, [{ snapshot: snap("u0"), person: "h1" }]);
  const removed = (await runAction("removeHeir", signal, value, U0, undefined, {
    kind: "removeHeir", from: startedOf(U0, true, { history: edited.history }), heirId: "h1", confirm: true,
  })) as StartedView;
  assert.equal(removed.history?.length, 2);
  assert.equal(removed.history?.[1].person, "h1");
});

test("Undo history: a prior case without a snapshot pushes nothing", async () => {
  const { value } = deps({ answer: () => ({ kind: "saved", case: U1 }) });
  const view = (await runAction("addHeir", signal, value, WITH_SON, undefined, {
    kind: "addHeir", from: startedOf(WITH_SON, true), values: { relationship: "daughter", name: "" },
  })) as StartedView;
  assert.deepEqual(view.history ?? [], []);
});

test("Undo history: refusals, impact answers and failures push nothing and keep the history", async () => {
  const kept = [{ snapshot: snap("old") }];
  for (const result of [
    { kind: "invalid", errors: { relationship: "x" } },
    { kind: "cascade", impact: { persons: ["h1"], estates: [] }, case: U0 },
    { kind: "failed" },
    { kind: "throttled" },
  ] as AnswerResult[]) {
    const { value } = deps({ answer: () => result, read: async () => U0 });
    const view = (await runAction("removeHeir", signal, value, U0, undefined, {
      kind: "removeHeir", from: startedOf(U0, true, { history: kept }), heirId: "h1",
    })) as StartedView;
    assert.deepEqual(view.history, kept, result.kind);
  }
});

test("Undo history: a conflict, a saved non-family change and the school clear it", async () => {
  const kept = [{ snapshot: snap("old") }];
  const from = startedOf(U0, true, { history: kept });
  const conflict = deps({ answer: () => ({ kind: "replaced", case: rev(WITH_TWO, 9, "x") }) });
  const replaced = (await runAction("saveHeir", signal, conflict.value, U0, undefined, {
    kind: "saveHeir", from, heirId: "h1", values: { relationship: "son", name: "Z" },
  })) as StartedView;
  assert.deepEqual(replaced.history ?? [], []);
  const plain = deps({ answer: () => ({ kind: "saved", case: U1 }) });
  const deceased = (await runAction("saveDeceased", signal, plain.value, U0, undefined, {
    kind: "saveDeceased", from, values: { gender: "male", estate: "10" },
  })) as StartedView;
  assert.deepEqual(deceased.history ?? [], []);
  assert.equal(deceased.undoToast, undefined);
});

test("Undo: one restore at the current revision with the top snapshot; success pops and focuses the person", async () => {
  const entries = [{ snapshot: snap("a") }, { snapshot: snap("u0"), person: "h1" }];
  const { value, log } = deps({ answer: () => ({ kind: "saved", case: rev(WITH_SON, 7, "after") }) });
  const from = startedOf(U1, true, { history: entries, undoToast: { key: 2, announcement: { kind: "added", id: "h2", heir: { name: null, relationship: "son" }, ordinal: null, seq: 1 } } });
  const view = (await runAction("undo", signal, value, U1, undefined, { kind: "undo", from })) as StartedView;
  assert.deepEqual(log.answers, [{ call: "restoreCase", caseId: U1.id, fields: snap("u0") }]);
  assert.deepEqual(log.revisions, [6]);
  assert.deepEqual(view.history, [{ snapshot: snap("a") }]);
  assert.equal(view.undoToast, undefined);
  assert.equal(view.announcement?.kind, "undone");
  assert.equal(view.focus?.target, "card:h1");
  assert.equal(view.case.revision, 7);
});

test("Undo: focus goes to the deceased when the person is not in the restored family", async () => {
  const { value } = deps({ answer: () => ({ kind: "saved", case: rev(WITH_SON, 7, "after") }) });
  const from = startedOf(U1, true, { history: [{ snapshot: snap("u0"), person: "gone" }] });
  const view = (await runAction("undo", signal, value, U1, undefined, { kind: "undo", from })) as StartedView;
  assert.equal(view.focus?.target, "card:root");
});

test("Undo with an empty history sends nothing", async () => {
  const { value, log } = deps({});
  const view = (await runAction("undo", signal, value, U1, undefined, { kind: "undo", from: startedOf(U1, true) })) as StartedView;
  assert.deepEqual(log.answers, []);
  assert.deepEqual(view.history ?? [], []);
});

test("Undo that fails or is throttled keeps the entry and the family and shows the failure", async () => {
  const entries = [{ snapshot: snap("u0") }];
  for (const kind of ["failed", "throttled"] as const) {
    const { value, log } = deps({ answer: () => ({ kind }) });
    const from = startedOf(U1, true, { history: entries });
    const view = (await runAction("undo", signal, value, U1, undefined, { kind: "undo", from })) as StartedView;
    assert.equal(log.answers.length, 1);
    assert.deepEqual(view.history, entries);
    assert.equal(view.undoFailed, true);
    assert.equal(view.case, U1);
  }
});

test("Undo that meets a conflict adopts the live case, says so, clears the history and never resends", async () => {
  const live = rev(WITH_TWO, 9, "live");
  const { value, log } = deps({ answer: () => ({ kind: "replaced", case: live }) });
  const from = startedOf(U1, true, { history: [{ snapshot: snap("u0") }] });
  const view = (await runAction("undo", signal, value, U1, undefined, { kind: "undo", from })) as StartedView;
  assert.equal(log.answers.length, 1);
  assert.equal(view.case, live);
  assert.equal(view.conflict, true);
  assert.deepEqual(view.history ?? [], []);
  assert.equal(view.undoToast, undefined);
});

// Story 9.7: positioned adds
const TREE_ADD = (from: StartedView, anchor = "h1", relationship: RelationshipId = "son_of_son"): Answer => ({
  kind: "addHeir", from, origin: "tree", anchor, values: { relationship, name: "", same_as: "" },
});

test("tree add sends one person with the anchor, adopts the case, pushes one entry and focuses the new card", async () => {
  const grandson = { ...SON, id: "g1", relationship: "son_of_son" as const };
  const saved: Case = { ...U0, revision: 6, snapshot: snap("u1"), heirs: [SON, grandson] };
  const { value, log } = deps({ answer: () => ({ kind: "saved", case: saved }) });
  const view = (await runAction("addHeir", signal, value, U0, undefined, TREE_ADD(startedOf(U0, true)))) as StartedView;
  assert.deepEqual(log.answers.map((a) => [a.call, a.fields]), [["addHeir", { relationship: "son_of_son", name: null, anchor: "h1" }]]);
  assert.equal(view.focus?.target, "card:g1");
  assert.equal(view.announcement?.kind, "added");
  assert.equal(view.announcement?.id, "g1");
  assert.deepEqual(view.history, [{ snapshot: snap("u0") }]);
  assert.equal(view.tree, undefined);
});

test("tree add on a later death carries the layer", async () => {
  const r0 = { id: "r0", relationship: "brother" as const, gender: "male" as const, name: null, edit_options: noHeirOptions() };
  const before: Case = { ...FAMILY, deaths: [{ ...S1_DEATH, heirs: [r0] }] };
  const { value, log } = deps({});
  await runAction("addHeir", signal, value, before, undefined, TREE_ADD(startedOf(before, true, { layer: "s1" }), "r0", "son_of_brother"));
  assert.deepEqual(log.answers[0].fields, { relationship: "son_of_brother", name: null, anchor: "r0", layer: "s1" });
});

test("tree add refusal stays on the view as a tree outcome with focus on the pressed control", async () => {
  const { value } = deps({ answer: () => ({ kind: "invalid", errors: { anchor: "not_allowed" } }) });
  const from = startedOf(U0, true);
  const view = (await runAction("addHeir", signal, value, U0, undefined, TREE_ADD(from))) as StartedView;
  assert.deepEqual(view.tree, { relationship: "son_of_son", anchor: "h1", errors: { anchor: "not_allowed" } });
  assert.equal(view.errors, null);
  assert.equal(view.panel, undefined);
  assert.equal(view.focus?.target, "addHere:son_of_son");
  assert.equal(view.case, U0);
  assert.deepEqual(view.history ?? [], []);
});

test("tree add failure, throttle and conflict are kept as tree outcomes", async () => {
  const failed = deps({ answer: () => ({ kind: "failed" }), read: async () => U0 });
  const one = (await runAction("addHeir", signal, failed.value, U0, undefined, TREE_ADD(startedOf(U0, true)))) as StartedView;
  assert.deepEqual(one.tree, { relationship: "son_of_son", anchor: "h1", notice: "failed" });
  assert.equal(one.notice, null);
  const throttled = deps({ answer: () => ({ kind: "throttled" }) });
  const two = (await runAction("addHeir", signal, throttled.value, U0, undefined, TREE_ADD(startedOf(U0, true)))) as StartedView;
  assert.equal(two.tree?.notice, "throttled");
  const newer = { ...U0, revision: 9 };
  const moved = deps({ answer: () => ({ kind: "replaced", case: newer }) });
  const three = (await runAction("addHeir", signal, moved.value, U0, undefined, TREE_ADD(startedOf(U0, true)))) as StartedView;
  assert.equal(three.tree?.notice, "conflict");
  assert.equal(three.case, newer);
  assert.equal(three.focus?.target, "addHere:son_of_son");
});

test("tree add at 50 heirs is refused before anything is sent, and the next action clears the outcome", async () => {
  const many = Array.from({ length: 50 }, (_, i) => ({ ...SON, id: `m${i}` }));
  const full: Case = { ...WITH_DECEASED, heirs: many };
  const { value, log } = deps({});
  const view = (await runAction("addHeir", signal, value, full, undefined, TREE_ADD(startedOf(full, true), "root", "son"))) as StartedView;
  assert.equal(log.answers.length, 0);
  assert.deepEqual(view.tree?.errors, { heirs: "limit" });
  assert.equal((pendingView("addHeir", view) as StartedView).tree, undefined);
});

test("a tree add that succeeds while the edit sheet is open closes it and focuses the new card", async () => {
  const grandson = { ...SON, id: "g1", relationship: "son_of_son" as const };
  const saved: Case = { ...U0, revision: 6, snapshot: snap("u1"), heirs: [SON, grandson] };
  const { value } = deps({ answer: () => ({ kind: "saved", case: saved }) });
  const from = startedOf(U0, true, { editingHeir: "h1" });
  const view = (await runAction("addHeir", signal, value, U0, undefined, TREE_ADD(from))) as StartedView;
  assert.equal(view.editingHeir, null);
  assert.equal(view.formEpoch, from.formEpoch + 1);
  assert.equal(view.focus?.target, "card:g1");
});

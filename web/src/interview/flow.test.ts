import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { AnswerResult, Case, MadhabResult, StartResult } from "../api/case.ts";
import type { FormRecord } from "./answers.ts";
import {
  askStartOver,
  blurField,
  cancelChange,
  cancelEditDeceased,
  cancelEditHeir,
  cancelStartOver,
  caseOf,
  FOCUS_PREFIXES,
  FOCUS_TARGETS,
  heirFormKey,
  openChange,
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

const CASE: Case = { id: "abc12345", started_at: "2026-11-06T10:00:00Z", madhab: null, deceased: null, heirs: [] };
const NEW_CASE: Case = {
  id: "def67890",
  started_at: "2026-11-06T11:00:00Z",
  madhab: null,
  deceased: null,
  heirs: [],
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
    reads: 0,
    starts: [] as boolean[],
    startCaseIds: [] as (string | undefined)[],
    seen: options.seen ?? false,
    chooses: [] as string[],
    chooseCaseIds: [] as string[],
    selection: options.selection ?? (null as Selection | null),
    form: options.form ?? (null as FormRecord | null),
    answers: [] as { call: string; caseId: string; fields?: unknown; heirId?: string }[],
  };
  const answerWith = (call: string, caseId: string, extra: { fields?: unknown; heirId?: string }) => {
    log.answers.push({ call, caseId, ...extra });
    return (options.answer ?? (() => ({ kind: "failed" }) as AnswerResult))(call);
  };
  const value: Deps = {
    fetchCase: async () => {
      log.reads += 1;
      return (options.read ?? (async () => null))();
    },
    startCase: async (_signal, { replace, caseId }) => {
      log.starts.push(replace);
      log.startCaseIds.push(caseId);
      return (options.start ?? (() => ({ kind: "failed" }) as StartResult))(replace);
    },
    setMadhab: async (_signal, madhab, caseId) => {
      log.chooses.push(madhab);
      log.chooseCaseIds.push(caseId);
      return (options.choose ?? (() => ({ kind: "failed" }) as MadhabResult))(madhab, caseId);
    },
    saveDeceased: async (_signal, caseId, fields) => answerWith("saveDeceased", caseId, { fields }),
    addHeir: async (_signal, caseId, fields) => answerWith("addHeir", caseId, { fields }),
    updateHeir: async (_signal, caseId, heirId, fields) =>
      answerWith("updateHeir", caseId, { heirId, fields }),
    removeHeir: async (_signal, caseId, heirId) => answerWith("removeHeir", caseId, { heirId }),
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
const SELECTOR = startedOf(CASE, false);
const QUESTION = startedOf(CHOSEN, true);

test("screens: a case with no school or one being changed shows the selector", () => {
  const table: [View, string][] = [
    [{ name: "loading" }, "loading"],
    [{ name: "none", expired: false }, "none"],
    [{ name: "existing", case: CASE }, "existing"],
    [SELECTOR, "selector"],
    [startedOf(CHOSEN, false), "deceased"],
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

test("Resume with a school goes to the deceased form; without one, to the selector", async () => {
  let { value } = deps({ read: async () => CHOSEN });
  assert.equal(screenOf(await runAction("resume", signal, value, CHOSEN)), "deceased");
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

// Story 1.3: the deceased and the heirs

const WITH_DECEASED: Case = { ...CHOSEN, deceased: { gender: "male", estate: "1000" } };
const SON = { id: "h1", relationship: "son", gender: "male", name: null } as const;
const AMAL = { id: "h2", relationship: "daughter", gender: "female", name: "Amal" } as const;
const WITH_SON: Case = { ...WITH_DECEASED, heirs: [SON] };
const WITH_TWO: Case = { ...WITH_DECEASED, heirs: [SON, AMAL] };
const HEIRS = startedOf(WITH_DECEASED, true);
const BLANK_RECORD = (caseId: string, heirId: string | null = null): FormRecord => ({
  caseId,
  form: "heir",
  heirId,
  values: { relationship: "", name: "" },
});

test("screens: deceased form, heir screen, and the selector first", () => {
  assert.equal(screenOf(startedOf(CHOSEN, false)), "deceased");
  assert.equal(screenOf(startedOf(WITH_DECEASED, false)), "heirs");
  assert.equal(screenOf(startedOf(WITH_DECEASED, false, { editingDeceased: true })), "deceased");
  assert.equal(screenOf(startedOf(WITH_DECEASED, false, { changing: true })), "selector");
  assert.equal(screenOf(startedOf(CASE, false, { editingDeceased: true })), "selector");
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
  assert.deepEqual(view.announcement, { kind: "added", heir: { name: null, relationship: "son" }, ordinal: null, seq: 1 });
  assert.deepEqual(view.focus, { target: "relationship", seq: 1 });
  assert.equal(screenOf(view), "heirs");
  assert.deepEqual(log.form, BLANK_RECORD(WITH_DECEASED.id));
  assert.equal(shouldFocus(from, view), false, "the screen does not change, so focus is the form's");
});

test("Add heir: a repeat announcement is a new one", async () => {
  const { value } = deps({ answer: () => ({ kind: "saved", case: WITH_TWO }) });
  const from = startedOf(WITH_SON, true, {
    announcement: { kind: "added", heir: { name: null, relationship: "son" }, ordinal: null, seq: 4 },
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

test("Edit heir: filled in, saving announces and returns focus to the row", async () => {
  const { value, log } = deps({ answer: () => ({ kind: "saved", case: WITH_TWO }) });
  const editing = startEditHeir(startedOf(WITH_TWO, true), "h2", value);
  assert.equal(editing.editingHeir, "h2");
  assert.deepEqual(log.form, {
    caseId: WITH_TWO.id,
    form: "heir",
    heirId: "h2",
    values: { relationship: "daughter", name: "Amal" },
  });
  assert.deepEqual(editing.focus, { target: "relationship", seq: 1 });
  const view = (await runAction("saveHeir", signal, value, WITH_TWO, undefined, {
    kind: "saveHeir",
    from: editing,
    heirId: "h2",
    values: { relationship: "sister", name: "Amal" },
  })) as StartedView;
  assert.deepEqual(log.answers[0], {
    call: "updateHeir",
    caseId: WITH_TWO.id,
    heirId: "h2",
    fields: { relationship: "sister", name: "Amal" },
  });
  assert.equal(view.editingHeir, null);
  assert.equal(view.announcement?.kind, "updated");
  assert.deepEqual(view.focus, { target: "editHeir:h2", seq: 2 });
  assert.deepEqual(log.form, BLANK_RECORD(WITH_TWO.id));
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
    form: "deceased",
    heirId: null,
    values: { gender: "male", estate: "1000" },
  });
  const back = cancelEditDeceased(editing, value);
  assert.equal(screenOf(back), "heirs");
  assert.deepEqual(back, { ...HEIRS, formEpoch: 1 });
  assert.deepEqual(log.answers, []);
});

test("Remove heir: gone from the list, announced, focus on the list", async () => {
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
    heir: { name: "Amal", relationship: "daughter" },
    ordinal: null,
    seq: 1,
  });
  assert.deepEqual(view.focus, { target: "list", seq: 1 });
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
      form: "heir",
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
    form: { caseId: CHOSEN.id, form: "deceased", heirId: null, values: {} },
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
  const announcement = { kind: "added", heir: { name: null, relationship: "son" }, ordinal: null, seq: 2 } as const;
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
    form: "heir",
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
    form: "heir",
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
    form: "heir",
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
    form: "deceased",
    heirId: null,
    values: { gender: "female", estate: "" },
  };
  ({ value, log } = deps({ read: async () => WITH_TWO, form: editDeceased }));
  const deceased = (await runAction("load", signal, value)) as StartedView;
  assert.equal(screenOf(deceased), "deceased");
  assert.deepEqual(log.form, editDeceased);
});

test("A form record for another case does not skip the resume prompt, and resume settles a form", async () => {
  const other: FormRecord = { caseId: "other", form: "heir", heirId: null, values: {} };
  const { value, log } = deps({ read: async () => WITH_TWO, form: other });
  assert.equal((await runAction("load", signal, value)).name, "existing");
  const view = await runAction("resume", signal, value, WITH_TWO);
  assert.equal(screenOf(view), "heirs");
  assert.deepEqual(log.form, BLANK_RECORD(WITH_TWO.id));
});

test("Start over and a vanished case clear the form record", async () => {
  const record: FormRecord = { caseId: CASE.id, form: "heir", heirId: null, values: { name: "x" } };
  let { value, log } = deps({ start: () => ({ kind: "started", case: NEW_CASE }), form: record });
  await runAction("startOver", signal, value, CASE);
  assert.equal(log.form, null, "the new case opens on the selector, with no form");
  ({ value, log } = deps({ seen: true, form: record }));
  await runAction("load", signal, value);
  assert.equal(log.form, null);
});

test("A failed or throttled start over keeps the form record of the live case", async () => {
  for (const kind of ["failed", "throttled"] as const) {
    const record: FormRecord = { caseId: CASE.id, form: "heir", heirId: null, values: { name: "x" } };
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
    form: { caseId: WITH_TWO.id, form: "heir", heirId: null, values: { relationship: "wife", name: "Draft" } },
  });
  const editing = startEditHeir(startedOf(WITH_TWO, true), "h1", value);
  assert.deepEqual(log.form, {
    caseId: WITH_TWO.id,
    form: "heir",
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
    form: "heir",
    heirId: null,
    values: { relationship: "wife", name: "Draft" },
  });
  assert.equal(cancelled.editingHeir, null);
});

test("The parked draft comes back when the heir edit is saved", async () => {
  const { value, log } = deps({
    answer: () => ({ kind: "saved", case: WITH_TWO }),
    form: { caseId: WITH_TWO.id, form: "heir", heirId: null, values: { relationship: "wife", name: "Draft" } },
  });
  const editing = startEditHeir(startedOf(WITH_TWO, true), "h1", value);
  await runAction("saveHeir", signal, value, WITH_TWO, undefined, {
    kind: "saveHeir",
    from: editing,
    heirId: "h1",
    values: { relationship: "son", name: "" },
  });
  assert.deepEqual(log.form?.values, { relationship: "wife", name: "Draft" });
  assert.equal(log.form?.parked, undefined);
});

test("The draft survives a deceased edit, saved or cancelled, and view and record agree", async () => {
  const draft = { relationship: "wife", name: "Draft" };
  const record: FormRecord = { caseId: WITH_TWO.id, form: "heir", heirId: null, values: draft };
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
  const typed: FormRecord = { caseId: WITH_TWO.id, form: "heir", heirId: "h1", values: { relationship: "son", name: "typed" } };
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
  const source = ["deceased-form.tsx", "heir-form.tsx", "heir-list.tsx", "form-bits.tsx"]
    .map((file) => readFileSync(join(dir, file), "utf8"))
    .join("\n");
  for (const target of FOCUS_TARGETS) {
    assert.ok(new RegExp(`data-focus=(\{[^}]*)?"${target}"`).test(source), target);
  }
  for (const prefix of FOCUS_PREFIXES) {
    assert.ok(source.includes("data-focus={`" + prefix + ":${"), prefix);
  }
  // The rest of flow.ts only builds targets from these, which the FocusTarget type enforces.
  const flowSource = readFileSync(join(dir, "..", "..", "..", "interview", "flow.ts"), "utf8");
  for (const [, target] of flowSource.matchAll(/nextFocus\([^,]+,\s*"([^"]+)"\)/g)) {
    assert.ok((FOCUS_TARGETS as readonly string[]).includes(target), target);
  }
});

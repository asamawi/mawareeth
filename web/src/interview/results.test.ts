import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePreview, type Case, type Preview, type PreviewResult } from "../api/case.ts";
import { mixedRefusalFixture, previewFixtures as fixtures } from "../test/preview-fixtures.ts";
import { previewForCase, previewKey, reconcile } from "./preview.ts";
import { isLayeredPreview, presentationOf, resultEntries, resultsState } from "./results.ts";
const by = (title: string) => {
  const fixture = fixtures.find((item) => item.title === title);
  assert.ok(fixture, title);
  const kase = { ...fixture.case, heir_options: { blocked: [], invalid: {} }, deaths: fixture.case.deaths ?? [] };
  return { kase, preview: parsePreview(fixture.response) as Preview };
};
const settle = (kase: Case, preview: Preview) =>
  reconcile(previewKey(kase), kase.id, { kind: "preview", preview });

test("no case, an incomplete case and a pending preview have no numbers", () => {
  const { kase } = by("Hanbali wife and son with an estate");
  assert.deepEqual(resultsState(null, null), { kind: "empty" });
  assert.deepEqual(resultsState({ ...kase, heirs: [] }, null), { kind: "incomplete" });
  assert.deepEqual(resultsState({ ...kase, deceased: null }, null), { kind: "incomplete" });
  assert.deepEqual(resultsState({ ...kase, madhab: null }, null), { kind: "loading" });
  assert.deepEqual(resultsState(kase, null), { kind: "loading" });
});

test("failures map to their own state and unsupported keeps its reason", () => {
  const { kase } = by("Hanbali wife and son with an estate");
  for (const kind of ["failed", "throttled", "gone", "replaced"] as const) {
    assert.deepEqual(resultsState(kase, { kind }), { kind: "error", error: kind });
  }
  const refused = by("Jafari is not supported");
  assert.deepEqual(resultsState(refused.kase, settle(refused.kase, refused.preview)), {
    kind: "unavailable",
    reason: "school_not_supported",
  });
  // A "not ready" answer for a ready case means the family changed.
  assert.deepEqual(resultsState(kase, { kind: "preview", preview: { status: "not_ready" } }), {
    kind: "error",
    error: "replaced",
  });
});

test("an answer for another family is never shown as numbers", () => {
  const { kase, preview } = by("Hanbali wife and son with an estate");
  const changed = { ...kase, heirs: kase.heirs.slice(0, 1) };
  const state = resultsState(changed, reconcile(previewKey(changed), changed.id, { kind: "preview", preview }));
  assert.deepEqual(state, { kind: "error", error: "replaced" });
});

test("the results page shows a preview only for the revision of the case it read", () => {
  const { kase, preview } = by("Hanbali wife and son with an estate");
  const read = { ...kase, revision: 4 };
  const at = (revision?: number): PreviewResult => ({ kind: "preview", preview, ...(revision === undefined ? {} : { revision }) });
  assert.equal(resultsState(read, previewForCase(read, at(4))).kind, "available");
  // Another tab renamed an heir in between: same family, newer revision. The old names never get the new numbers.
  assert.deepEqual(resultsState(read, previewForCase(read, at(5))), { kind: "error", error: "replaced" });
  // An answer from before the case read is never shown; it can be retried.
  assert.deepEqual(resultsState(read, previewForCase(read, at(3))), { kind: "error", error: "failed" });
  // A body with no revision (an older server) is still checked against the family.
  assert.equal(resultsState(read, previewForCase(read, at())).kind, "available");
  const changed = { ...read, heirs: read.heirs.slice(0, 1) };
  assert.deepEqual(resultsState(changed, previewForCase(changed, at(4))), { kind: "error", error: "replaced" });
});

test("every available fixture joins each heir to its proof by heir id, layered ones to none", () => {
  let single = 0;
  let layered = 0;
  for (const fixture of fixtures) {
    const { kase, preview } = by(fixture.title);
    if (preview.status !== "available") continue;
    const state = resultsState(kase, settle(kase, preview));
    assert.equal(state.kind, "available", fixture.title);
    if (state.kind !== "available") continue;
    const { entries } = resultEntries(state.preview);
    assert.deepEqual(
      entries.map((entry) => entry.row.heirId),
      state.preview.shares.map((share) => share.heir_id),
    );
    if (isLayeredPreview(state.preview)) {
      layered += 1;
      assert.ok(entries.every((entry) => entry.proof === null), fixture.title);
      continue;
    }
    single += 1;
    for (const entry of entries) {
      assert.ok(entry.proof, fixture.title);
      // A blocked row is worded as blocked by its evidence, and a residuary left with nothing is not.
      if (entry.proof.labels.blocked_by) assert.equal(entry.row.blocked, true, fixture.title);
    }
  }
  assert.ok(single >= 10);
  assert.equal(layered, 13);
});

test("a layered fixture shows kirat for its shares", () => {
  const { kase, preview } = by("Layered two under hanafi");
  const state = resultsState(kase, settle(kase, preview));
  assert.equal(state.kind, "available");
  if (state.kind !== "available") return;
  // 13/48 and 35/48 of 24
  assert.deepEqual(resultEntries(state.preview).entries.map((entry) => entry.row.kirat), ["6.50", "17.50"]);
});

test("a blocked heir keeps its blocked-by label and no share", () => {
  const { kase, preview } = by("Father blocks the brother");
  const state = resultsState(kase, settle(kase, preview));
  assert.equal(state.kind, "available");
  if (state.kind !== "available") return;
  const blocked = resultEntries(state.preview).entries.find((entry) => entry.row.blocked);
  assert.ok(blocked?.proof?.labels.blocked_by);
  assert.equal(blocked.row.kirat, null);
});

test("kirat are the server's own strings, never worked out in the browser", () => {
  const { kase, preview } = by("Hanbali wife and son with an estate");
  const state = resultsState(kase, settle(kase, preview));
  assert.equal(state.kind, "available");
  if (state.kind !== "available") return;
  assert.deepEqual(resultEntries(state.preview).entries.map((entry) => entry.row.kirat), ["3.00", "21.00"]);
});

test("every state without numbers has a presentation, and only failed and replaced offer retry", () => {
  const texts = (state: Parameters<typeof presentationOf>[0]) =>
    presentationOf(state).texts.map((ref) => ref.from === "text" ? `text:${ref.text}` : `${ref.from}:${ref.key}`);
  assert.deepEqual(texts({ kind: "empty" }), ["results:emptyCase"]);
  assert.deepEqual(texts({ kind: "incomplete" }), ["results:incompleteCase"]);
  assert.deepEqual(texts({ kind: "loading" }), ["results:loading"]);
  assert.deepEqual(texts({ kind: "load_failed" }), ["results:loadFailed"]);
  assert.deepEqual(texts({ kind: "unavailable", reason: "malikiyya_disputed" }), [
    "interview:previewUnavailable",
    "reason:malikiyya_disputed",
  ]);
  const errors = { failed: "previewFailed", replaced: "previewGone", throttled: "previewThrottled", gone: "previewExpired" };
  for (const [error, key] of Object.entries(errors)) {
    const presentation = presentationOf({ kind: "error", error: error as keyof typeof errors });
    assert.deepEqual(texts({ kind: "error", error: error as keyof typeof errors }), [`interview:${key}`]);
    assert.equal(presentation.retry, error === "failed" || error === "replaced", error);
    assert.equal(presentation.alert, true);
  }
  for (const state of [{ kind: "empty" }, { kind: "incomplete" }, { kind: "unavailable", reason: "x" }] as const) {
    assert.equal(presentationOf(state).retry, false, state.kind);
  }
  assert.equal(presentationOf({ kind: "load_failed" }).retry, true);
});

test("a case with no school and differing schools asks for a choice, and agreeing schools show the results", () => {
  const differ = by("Differ: grandfather and full brother");
  const state = resultsState(differ.kase, settle(differ.kase, differ.preview));
  assert.equal(state.kind, "choose_school");
  const agree = by("Agree: wife, son and daughter in every school");
  assert.equal(agree.kase.madhab, null);
  const shown = resultsState(agree.kase, settle(agree.kase, agree.preview));
  assert.equal(shown.kind, "available");
  // Another family's answer is still refused for a case with no school.
  const other = { ...agree.kase, heirs: agree.kase.heirs.slice(1) };
  assert.deepEqual(resultsState(other, settle(other, agree.preview)), { kind: "error", error: "replaced" });
});

test("all four Schools refusing for different reasons shows every distinct presented refusal, never shares", () => {
  const { kase } = by("Impossible family");
  const preview = parsePreview(mixedRefusalFixture().response) as Preview;
  const state = resultsState(kase, { kind: "preview", preview });
  assert.ok(state.kind === "unavailable");
  assert.equal(state.refusals?.length, 2);
  assert.deepEqual(presentationOf(state).texts, [
    { from: "interview", key: "previewUnavailable" },
    ...state.refusals!.map((text) => ({ from: "text", text })),
  ]);
  // One reason keeps today's single-sentence presentation.
  const single = by("Impossible family");
  assert.deepEqual(resultsState(single.kase, { kind: "preview", preview: single.preview }), { kind: "unavailable", reason: "invalid_family" });
});

test("resultEntries returns the served rounding text, or null at zero", () => {
  for (const [title, text] of [
    ["Two wives and a son, rounded half up", "-SAR0.01"],
    ["Agree: wife, son and daughter in every school", null],
  ] as const) {
    const { preview } = by(title);
    const served = (preview as { presented?: { rounding: { text: string } | null } }).presented;
    const entries = resultEntries(preview as never);
    assert.equal(entries.rounding, served?.rounding?.text ?? null, title);
    assert.equal(entries.rounding, text, title);
  }
});

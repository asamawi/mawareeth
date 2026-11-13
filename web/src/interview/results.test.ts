import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parsePreview, type Case, type Preview } from "../api/case.ts";
import { localKirat } from "./format.ts";
import { previewKey, reconcile } from "./preview.ts";
import { isLayeredPreview, presentationOf, resultEntries, resultsState } from "./results.ts";

const dir = dirname(fileURLToPath(import.meta.url));
const fixtures = (
  JSON.parse(readFileSync(join(dir, "..", "..", "..", "api", "contracts", "preview-fixtures.json"), "utf8")) as {
    fixtures: { title: string; case: Case; response: unknown }[];
  }
).fixtures;
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
      assert.equal(entry.proof?.heir, entry.row.heirId, fixture.title);
      // A residuary left with nothing is a blocked row whose proof has no blocked-by.
      if (entry.proof?.rule === "blocked") assert.equal(entry.row.blocked, true, fixture.title);
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

test("kirat show with 2 decimals in the language's digits", () => {
  assert.equal(localKirat("3.00", "en"), "3.00");
  assert.equal(localKirat("3.43", "fr"), "3,43");
  const digits = new Intl.NumberFormat("ar", { useGrouping: false });
  const point = new Intl.NumberFormat("ar").formatToParts(1.1).find((part) => part.type === "decimal")?.value;
  assert.equal(localKirat("16.05", "ar"), `${digits.format(16)}${point}${digits.format(0)}${digits.format(5)}`);
});

test("every state without numbers has a presentation, and only failed and replaced offer retry", () => {
  const texts = (state: Parameters<typeof presentationOf>[0]) =>
    presentationOf(state).texts.map((ref) => `${ref.from}:${ref.key}`);
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

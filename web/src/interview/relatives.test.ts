import assert from "node:assert/strict";
import { test } from "node:test";

import { RELATIONSHIP_IDS, type PlacementOption } from "../api/case.ts";
import { addGroups } from "./relatives.ts";

const NONE = { blocked: [], invalid: {} };
const entry = (relationship: PlacementOption["relationship"], link: PlacementOption["link"], blocked = false): PlacementOption => ({
  relationship,
  link,
  blocked,
});
const ids = (groups: ReturnType<typeof addGroups>, key: string) =>
  groups.find((group) => group.key === key)?.entries.map((e) => e.id);

test("legacy male deceased: the five groups in order, siblings all six, more the rest", () => {
  const root = [entry("father", "parent"), entry("mother", "parent"), entry("wife", "spouse"), entry("son", "child"), entry("daughter", "child")];
  const groups = addGroups(root, NONE);
  assert.deepEqual(groups.map((group) => group.key), ["spouse", "parents", "children", "siblings", "more"]);
  assert.deepEqual(ids(groups, "spouse"), ["wife"]);
  assert.deepEqual(ids(groups, "parents"), ["father", "mother"]);
  assert.deepEqual(ids(groups, "children"), ["son", "daughter"]);
  assert.equal(ids(groups, "siblings")?.length, 6);
  const grouped = new Set(["husband", "wife", "father", "mother", "son", "daughter", "brother", "sister", "paternal_brother", "paternal_sister", "maternal_brother", "maternal_sister"]);
  assert.deepEqual(ids(groups, "more"), RELATIONSHIP_IDS.filter((id) => !grouped.has(id)));
});

test("a second father is not offered: the root has no father", () => {
  const root = [entry("mother", "parent"), entry("wife", "spouse")];
  const groups = addGroups(root, { blocked: [], invalid: { father: "second_father" } });
  assert.deepEqual(ids(groups, "parents"), ["mother"]);
});

test("blocked-but-valid relatives stay offered with their flag", () => {
  const root = [entry("father", "parent"), entry("mother", "parent", true)];
  const groups = addGroups(root, { blocked: ["brother"], invalid: {} });
  assert.deepEqual(groups.find((g) => g.key === "parents")?.entries, [
    { id: "father", blocked: false },
    { id: "mother", blocked: true },
  ]);
  assert.deepEqual(groups.find((g) => g.key === "siblings")?.entries[0], { id: "brother", blocked: true });
});

test("no placement: spouse, parents and children fall back to heir_options", () => {
  const groups = addGroups(undefined, { blocked: [], invalid: { husband: "husband_of_male" } });
  assert.deepEqual(ids(groups, "spouse"), ["wife"]);
  assert.deepEqual(ids(groups, "parents"), ["father", "mother"]);
});

test("placement order is kept and empty groups are left out", () => {
  const groups = addGroups([entry("daughter", "child"), entry("son", "child")], {
    blocked: [],
    invalid: Object.fromEntries(RELATIONSHIP_IDS.map((id) => [id, "second_father"])),
  });
  assert.deepEqual(groups.map((g) => g.key), ["children"]);
  assert.deepEqual(ids(groups, "children"), ["daughter", "son"]);
});

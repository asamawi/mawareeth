import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parsePreview, type Case, type Preview } from "../api/case.ts";
import { locales, messages } from "../i18n/messages.ts";
import {
  breadcrumb,
  deathOf,
  deceasedLabel,
  hasDeaths,
  keepLayer,
  layerAt,
  layersOf,
  linkCandidates,
  personOf,
  rowLabels,
  rowsOf,
} from "./layers.ts";
import { basisKey, previewKey, previewReady, previewRows, reconcile } from "./preview.ts";

const NONE = { blocked: [], invalid: {} };
const REL = { wife: "Wife", son: "Son", mother: "Mother", brother: "Brother" };
const NUMBERED = "{heir} {n}";
const OF = "{heir} of {deceased}";

// Male: wife W (Amal), sons S1 and S2. S1 died second: mother = W, brother = S2, wife R3 (new).
// W died third: son = S2, and a new mother M.
const CASE: Case = {
  id: "c1",
  started_at: "t",
  madhab: "hanafi",
  deceased: { gender: "male", estate: null },
  heirs: [
    { id: "w", relationship: "wife", gender: "female", name: "Amal", edit_options: NONE },
    { id: "s1", relationship: "son", gender: "male", name: null, edit_options: NONE },
    { id: "s2", relationship: "son", gender: "male", name: null, edit_options: NONE },
  ],
  heir_options: NONE,
  deaths: [
    {
      heir_id: "s1",
      order: 2,
      gender: "male",
      heir_options: NONE,
      heirs: [
        { id: "r1", relationship: "mother", gender: "female", name: "Amal", same_as: "w", edit_options: NONE },
        { id: "r2", relationship: "brother", gender: "male", name: null, same_as: "s2", edit_options: NONE },
        { id: "r3", relationship: "wife", gender: "female", name: null, edit_options: NONE },
      ],
    },
    {
      heir_id: "w",
      order: 3,
      gender: "female",
      heir_options: NONE,
      heirs: [
        { id: "r4", relationship: "son", gender: "male", name: null, same_as: "s2", edit_options: NONE },
        { id: "r5", relationship: "mother", gender: "female", name: null, edit_options: NONE },
      ],
    },
  ],
};

test("layers come in death order, and a case without deaths has only the first", () => {
  assert.deepEqual(layersOf(CASE).map((layer) => [layer.id, layer.order]), [[null, 1], ["s1", 2], ["w", 3]]);
  const plain: Case = { ...CASE, deaths: [] };
  assert.equal(hasDeaths(plain), false);
  assert.equal(hasDeaths(CASE), true);
  assert.deepEqual(layersOf(plain).map((layer) => layer.id), [null]);
  assert.equal(layerAt(CASE, "w").order, 3);
  assert.equal(layerAt(CASE, "nobody").id, null);
});

test("the active layer stays only while its death exists", () => {
  assert.equal(keepLayer("s1", CASE), "s1");
  assert.equal(keepLayer("s1", { deaths: [] }), null);
  assert.equal(keepLayer(null, CASE), null);
});

test("rows are found in any layer, and a person is their earliest row", () => {
  const rows = rowsOf(CASE);
  assert.equal(rows.get("r3")?.layer, 1);
  assert.equal(rows.get("w")?.layer, 0);
  assert.equal(rows.size, 3 + 3 + 2);
  assert.equal(personOf(rows.get("r1")!.row), "w");
  assert.equal(personOf(rows.get("w")!.row), "w");
  assert.equal(deathOf(CASE, "w")?.order, 3);
  assert.equal(deathOf(CASE, "s2"), undefined);
});

test("link candidates: earlier layers only, minus the deceased, people already there and the earlier dead", () => {
  // The first layer has nobody to link to.
  assert.deepEqual(linkCandidates(CASE, null), []);
  // S1's layer: W and S2 are in it already, and S1 is its deceased.
  assert.deepEqual(linkCandidates(CASE, "s1"), []);
  // Without the two links, W and S2 are offered, and S1 is not.
  const bare: Case = { ...CASE, deaths: [{ ...CASE.deaths[0], heirs: [CASE.deaths[0].heirs[2]] }] };
  assert.deepEqual(linkCandidates(bare, "s1").map((row) => row.id), ["w", "s2"]);
  // W's layer: S1 died before W, W is the deceased, S2 is in it already, so only R3 (a layer-2 person).
  assert.deepEqual(linkCandidates(CASE, "w").map((row) => row.id), ["r3"]);
  // A person who dies later than this layer is still offered.
  const later: Case = {
    ...CASE,
    deaths: [
      { ...CASE.deaths[0], heirs: [CASE.deaths[0].heirs[2]] },
      { ...CASE.deaths[1], heir_id: "s2", heirs: [] },
    ],
  };
  assert.ok(linkCandidates(later, "s1").some((row) => row.id === "s2"));
  assert.equal(linkCandidates(later, "nobody").length, 0);
});

test("labels name every row of every layer by the person's earliest row", () => {
  const labels = rowLabels(CASE, REL, NUMBERED, OF);
  assert.equal(labels.w, "Amal");
  assert.equal(labels.s1, "Son 1");
  assert.equal(labels.s2, "Son 2");
  // Linked rows read as the person.
  assert.equal(labels.r1, "Amal");
  assert.equal(labels.r2, "Son 2");
  assert.equal(labels.r4, "Son 2");
  // A person first entered in a later layer reads "<relationship or name> of <that layer's deceased>".
  assert.equal(labels.r3, "Wife of Son 1");
  assert.equal(labels.r5, "Mother of Amal");
  assert.equal(Object.keys(labels).length, rowsOf(CASE).size);
});

test("removing a linked person from the first layer leaves them, named, in the later layer", () => {
  // The server's answer to removing W from layer 1: her name and death move to r1, her earliest remaining row.
  const promoted: Case = {
    ...CASE,
    heirs: CASE.heirs.filter((h) => h.id !== "w"),
    deaths: [
      {
        ...CASE.deaths[0],
        heirs: [
          { id: "r1", relationship: "mother", gender: "female", name: "Amal", edit_options: NONE },
          ...CASE.deaths[0].heirs.slice(1),
        ],
      },
      { ...CASE.deaths[1], heir_id: "r1" },
    ],
  };
  assert.deepEqual(rowsOf(promoted).has("w"), false);
  assert.deepEqual(layerAt(promoted, null).heirs.map((h) => h.id), ["s1", "s2"]);
  assert.ok(layerAt(promoted, "s1").heirs.some((h) => h.id === "r1"));
  assert.equal(keepLayer("r1", promoted), "r1");
  const labels = rowLabels(promoted, REL, NUMBERED, OF);
  assert.match(labels.r1, /Amal/);
  // Her death is labelled by her name, not by the "of" form her row takes in a list.
  assert.equal(labels.r5, "Mother of Amal");
  assert.equal(Object.keys(labels).length, rowsOf(promoted).size);
});

test("a case without deaths is labelled exactly as the first layer is", () => {
  const plain: Case = { ...CASE, deaths: [] };
  assert.deepEqual(rowLabels(plain, REL, NUMBERED, OF), { w: "Amal", s1: "Son 1", s2: "Son 2" });
});

test("the breadcrumb lists the first deceased, then each death with its label", () => {
  const crumbs = breadcrumb(CASE, REL, NUMBERED);
  assert.deepEqual(crumbs, [
    { id: null, order: 1, label: null },
    { id: "s1", order: 2, label: "Son 1" },
    { id: "w", order: 3, label: "Amal" },
  ]);
  assert.equal(deceasedLabel(CASE, "s1", REL, NUMBERED), "Son 1");
  assert.equal(deceasedLabel(CASE, null, REL, NUMBERED), null);
});

// The layered fixtures from the server: every row of the shown case has a label, and no raw id shows.

const dir = dirname(fileURLToPath(import.meta.url));
type Fixture = { title: string; case: Case; response: unknown };
const fixtures = (
  JSON.parse(readFileSync(join(dir, "..", "..", "..", "api", "contracts", "preview-fixtures.json"), "utf8")) as {
    fixtures: Fixture[];
  }
).fixtures.filter((fixture) => Array.isArray(fixture.case.deaths) && fixture.case.deaths.length > 0);

test("every layered fixture shows a human label for every share, and its key matches the server's basis", () => {
  assert.ok(fixtures.length >= 3);
  for (const fixture of fixtures) {
    const preview = parsePreview(fixture.response) as Preview;
    // The fixture's case is the server's, with no options: fill in what the parser would.
    const kase: Case = {
      ...fixture.case,
      heir_options: NONE,
      deaths: fixture.case.deaths.map((death) => ({ ...death, heir_options: NONE })),
    };
    assert.equal(previewKey(kase), basisKey(kase.id, (preview as Exclude<Preview, { status: "not_ready" }>).basis), fixture.title);
    for (const locale of locales) {
      const text = messages[locale].interview;
      const labels = rowLabels(kase, text.relationships, text.heirNumbered, text.previewOf);
      for (const id of rowsOf(kase).keys()) {
        assert.ok(labels[id] && labels[id] !== id, `${fixture.title} ${locale} ${id}`);
      }
      if (preview.status === "available") {
        const { rows } = previewRows(preview);
        for (const row of rows) assert.ok(labels[row.heirId] && labels[row.heirId] !== row.heirId, fixture.title);
        // A later deceased is never listed.
        const dead = new Set(kase.deaths.map((death) => death.heir_id));
        assert.ok(rows.every((row) => !dead.has(row.heirId)), fixture.title);
      }
    }
  }
});

test("the key follows the deaths, and a result for another layering is not kept", () => {
  const plain: Case = { ...CASE, deaths: [] };
  assert.notEqual(previewKey(plain), previewKey(CASE));
  assert.notEqual(previewKey(CASE), previewKey({ ...CASE, deaths: [CASE.deaths[0]] }));
  const reordered: Case = { ...CASE, deaths: [{ ...CASE.deaths[0], heirs: [...CASE.deaths[0].heirs].reverse() }, CASE.deaths[1]] };
  assert.notEqual(previewKey(CASE), previewKey(reordered));
  // A link is part of the key: the same rows linked differently are a different family.
  const relinked: Case = {
    ...CASE,
    deaths: [{ ...CASE.deaths[0], heirs: CASE.deaths[0].heirs.map((row) => (row.id === "r2" ? { ...row, same_as: "w" } : row)) }, CASE.deaths[1]],
  };
  assert.notEqual(previewKey(CASE), previewKey(relinked));
  const fixture = fixtures[0];
  const preview = parsePreview(fixture.response) as Preview;
  const outcome = { kind: "preview" as const, preview };
  const mine = { ...fixture.case, heir_options: NONE };
  assert.deepEqual(reconcile(previewKey(mine), mine.id, outcome), outcome);
  const other: Case = { ...mine, deaths: [] };
  assert.deepEqual(reconcile(previewKey(other), other.id, outcome), { kind: "replaced" });
});

test("a preview waits for every person who died to have heirs", () => {
  assert.equal(previewReady(CASE), true);
  assert.equal(previewReady({ ...CASE, deaths: [{ ...CASE.deaths[0], heirs: [] }] }), false);
  assert.equal(previewReady({ ...CASE, deaths: [] }), true);
});

test("every locale has the text for deaths, links and the order question", () => {
  for (const locale of locales) {
    const text = messages[locale].interview;
    assert.ok(text.deathLayerLabel.includes("{label}") && text.deathLayerLabel.includes("{order}"), locale);
    assert.ok(text.previewOf.includes("{heir}") && text.previewOf.includes("{deceased}"), locale);
    for (const key of [
      "heirAlsoDied",
      "heirOpenLayer",
      "heirDidNotDie",
      "heirDidNotDieConfirm",
      "heirRemoveConfirmDeceased",
      "heirsOfHeading",
    ] as const) {
      assert.ok(text[key].includes("{heir}"), `${locale} ${key}`);
    }
  }
});


test("names cannot inject placeholders or replacement patterns", async () => {
  const { ofDeceased, deathLayerText } = await import("./layers.ts");
  assert.equal(ofDeceased(OF, "{deceased} $&", "{heir} $&"), "{deceased} $& of {heir} $&");
  assert.equal(deathLayerText("{label} ({order})", "{order} $&", "second"), "{order} $& (second)");
});

test("removing a death warns only for the person's last row across all layers", async () => {
  const { removesDeath } = await import("./layers.ts");
  assert.equal(removesDeath(CASE, "w"), false);
  assert.equal(removesDeath(CASE, "r1"), false);
  assert.equal(removesDeath(CASE, "s1"), true);
  assert.equal(removesDeath(CASE, "s2"), false);
  assert.equal(removesDeath(CASE, "missing"), false);
  const onlyLater = { ...CASE, heirs: CASE.heirs.filter((row) => row.id !== "w"), deaths: [
    { ...CASE.deaths[0], heirs: CASE.deaths[0].heirs.map((row) => row.id === "r1" ? { ...row, same_as: undefined } : row) },
    { ...CASE.deaths[1], heir_id: "r1" },
  ] };
  assert.equal(removesDeath(onlyLater, "r1"), true);
});

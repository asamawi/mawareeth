import { readFileSync } from "node:fs";
import type { PresentedResult } from "../contracts/presented.ts";
import { parsePresentedResult } from "../contracts/presented.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import { RELATIONSHIP_IDS, type RelationshipId, type Case } from "../api/case.ts";
import { locales, messages } from "../i18n/messages.ts";
import {
  generationLines,
  layoutTree as layoutModel,
  lineOf,
  NODE_HEIGHT,
  scrollDelta,
  treeDescription,
  estateModel, fitZoom, focusAfterRemoval, pinBox, placeholders, type EstateModel,
  type TreeLayout,
} from "./tree.ts";

function layoutTree(rows: readonly { id: string; relationship: RelationshipId }[], width: number) {
  const model: EstateModel = { people: rows.map(r => ({ ...r, personId: r.id, gender: "male", name: null, state: "normal", parentId: null })), placement: {} };
  return layoutModel(model, width);
}
const WIDTHS = [272, 327, 576, 1104];

function heirs(...relationships: RelationshipId[]) {
  return relationships.map((relationship, index) => ({ id: `h${index}`, relationship }));
}

function many(count: number) {
  const pool: RelationshipId[] = ["son", "daughter", "wife", "brother", "father", "grandfather", "son_of_son"];
  return heirs(...Array.from({ length: count }, (_, index) => pool[index % pool.length]));
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function check(layout: TreeLayout, count: number) {
  const boxes = [layout.deceased, ...layout.nodes];
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) assert.ok(!overlaps(boxes[i], boxes[j]), `${i} overlaps ${j}`);
  }
  for (const box of boxes) {
    assert.ok(box.x >= 0 && box.x + box.width <= layout.width, "inside the width");
  }
  for (const node of layout.nodes) {
    const outside = node.side === "start" ? node.x + node.width <= layout.spineX : node.x >= layout.spineX;
    assert.ok(outside, "node does not cross the spine");
  }
  assert.equal(layout.edges.length, count);
  assert.equal(layout.nodes.length, count);
  assert.ok(layout.spine.top <= layout.deceased.y, "the spine reaches the deceased");
  assert.ok(layout.spine.bottom >= layout.deceased.y + layout.deceased.height, "the spine reaches past the deceased");
  for (const edge of layout.edges) {
    const node = layout.nodes.find((item) => item.id === edge.id);
    assert.ok(node, "an edge has a node");
    const match = /^M(\d+) (\d+)H(\d+(?:\.\d+)?)V(\d+)$/.exec(edge.path);
    assert.ok(match, edge.path);
    const [, startX, startY, endX, endY] = match.map(Number);
    assert.equal(startX, layout.spineX, "starts on the spine");
    assert.ok(startY >= layout.spine.top && startY <= layout.spine.bottom, "starts within the spine");
    assert.equal(endX, node.x + node.width / 2, "ends at the node centre");
    assert.equal(endY, node.line <= 2 ? node.y + node.height : node.y, "touches the node edge");
  }
}

test("the lines are the table of the design notes", () => {
  assert.deepEqual(generationLines(), [
    { line: 1, relationships: ["grandfather", "paternal_grandmother", "maternal_grandmother"] },
    { line: 2, relationships: ["father", "mother", "uncle", "paternal_uncle"] },
    {
      line: 3,
      relationships: [
        "husband",
        "wife",
        "brother",
        "sister",
        "paternal_brother",
        "paternal_sister",
        "maternal_brother",
        "maternal_sister",
        "son_of_uncle",
        "son_of_paternal_uncle",
      ],
    },
    { line: 4, relationships: ["son", "daughter", "son_of_brother", "son_of_paternal_brother"] },
    { line: 5, relationships: ["son_of_son", "daughter_of_son"] },
  ]);
});

test("every relationship id has exactly one line", () => {
  for (const id of RELATIONSHIP_IDS) {
    assert.equal(generationLines().filter((line) => line.relationships.includes(id)).length, 1, id);
  }
  const listed = generationLines().flatMap((line) => line.relationships);
  assert.deepEqual([...listed].sort(), [...RELATIONSHIP_IDS].sort());
  for (const id of RELATIONSHIP_IDS) assert.ok(lineOf(id) >= 1 && lineOf(id) <= 5, id);
});

for (const width of WIDTHS) {
  for (const count of [0, 1, 2, 3, 7, 21, 50]) {
    test(`layout at ${width}px with ${count} heirs`, () => {
      check(layoutTree(many(count), width), count);
    });
  }

  test(`every relationship at once fits at ${width}px`, () => {
    check(layoutTree(heirs(...RELATIONSHIP_IDS), width), RELATIONSHIP_IDS.length);
  });
}

test("a phone keeps one node each side", () => {
  const layout = layoutTree(heirs("son", "daughter"), 272);
  assert.equal(layout.columns, 2);
  assert.deepEqual(layout.nodes.map((node) => node.side), ["start", "end"]);
});

test("the odd node goes on the inline-start side", () => {
  const layout = layoutTree(heirs("son", "daughter", "son_of_brother"), 1104);
  assert.deepEqual(layout.nodes.map((node) => node.side), ["start", "start", "end"]);
});

test("wide screens put more nodes in a row and phones wrap", () => {
  const phone = layoutTree(many(8), 272);
  const desktop = layoutTree(many(8), 1104);
  assert.ok(phone.height > desktop.height);
  assert.ok(desktop.columns > phone.columns);
});

test("lines run top to bottom around the deceased", () => {
  const layout = layoutTree(heirs("son_of_son", "son", "wife", "father", "grandfather"), 576);
  const y = Object.fromEntries(layout.nodes.map((node) => [Number(node.id.slice(1)), node.y]));
  // order given: son_of_son, son, wife, father, grandfather
  assert.ok(y[4] < y[3]);
  assert.ok(y[3] + NODE_HEIGHT <= layout.deceased.y);
  assert.ok(layout.deceased.y + layout.deceased.height <= y[2]);
  assert.ok(y[2] < y[1]);
  assert.ok(y[1] < y[0]);
});

test("order within a line follows the table, then the order added", () => {
  const layout = layoutTree(
    [
      { id: "a", relationship: "daughter" },
      { id: "b", relationship: "son" },
      { id: "c", relationship: "daughter" },
    ],
    1104,
  );
  const sorted = [...layout.nodes].sort((p, q) => p.x - q.x).map((node) => node.id);
  assert.deepEqual(sorted, ["b", "a", "c"]);
});

test("the layout is stable for the same input", () => {
  assert.deepEqual(layoutTree(many(9), 576), layoutTree(many(9), 576));
});

test("a new heir never changes x on other lines, and only moves y of lines below its own", () => {
  for (const width of [272, 576]) {
    const base = many(21);
    const before = layoutTree(base, width);
    for (const relationship of ["grandfather", "wife", "daughter", "son_of_son"] as RelationshipId[]) {
      const after = layoutTree([...base, { id: "new", relationship }], width);
      const own = lineOf(relationship);
      for (const node of before.nodes) {
        const same = after.nodes.find((item) => item.id === node.id);
        assert.ok(same);
        if (node.line !== own) {
          assert.equal(same.x, node.x, `${relationship} x of line ${node.line}`);
          assert.equal(same.side, node.side);
        }
        if (node.line < own) assert.equal(same.y, node.y, `${relationship} y of line ${node.line}`);
        // Ancestor nodes sit above the deceased, so a line above never moves for a line below.
      }
    }
  }
});

test("a heirs-only-below layout leaves the deceased at the top", () => {
  const layout = layoutTree(heirs("son", "wife"), 327);
  assert.equal(layout.deceased.y, 0);
  assert.equal(layout.nodes.length, 2);
  assert.ok(layout.nodes.every((node) => node.y > layout.deceased.y + layout.deceased.height));
  assert.equal(layout.spine.top, 0);
});

test("ancestors feed down: their bar is below them and the spine starts there", () => {
  const layout = layoutTree(heirs("father", "grandfather"), 327);
  const first = layout.nodes.find((node) => node.line === 1);
  assert.ok(first);
  assert.ok(layout.spine.top >= first.y + first.height);
  assert.ok(layout.nodes.every((node) => node.y < layout.deceased.y));
});

test("scrollDelta shows a node with the least movement on one axis", () => {
  const cases: [number, number, number, number, number][] = [
    // node start, node end, view start, view end, expected delta
    [100, 180, 0, 300, 0], // already shows
    [400, 480, 0, 300, 180], // below: bring its end to the view's end
    [-80, 0, 0, 300, -80], // above: bring its start to the view's start
    [-20, 60, 0, 300, -20], // partly above
    [250, 350, 0, 300, 50], // partly below
    [100, 200, 0, 60, 100], // larger than the view: its start
    [520, 640, 500, 800, 0], // offset view (on-screen coordinates)
  ];
  for (const [start, end, viewStart, viewEnd, expected] of cases) {
    assert.equal(scrollDelta(start, end, viewStart, viewEnd), expected, `${start},${end},${viewStart},${viewEnd}`);
  }
});

test("description includes relationship, numbered defaults and gendered states", () => {
  const model: EstateModel = { people: [
    { id: "a", personId: "a", relationship: "son", gender: "male", name: null, state: "died_before", parentId: null },
    { id: "b", personId: "b", relationship: "son", gender: "female", name: "Name", state: "died_later", parentId: null },
  ], placement: {} };
  for (const locale of locales) {
    const t = messages[locale].interview, d = treeDescription(t, model);
    assert.equal(d.deceased, t.treeDeceased);
    assert.equal(d.people[0].badge, t.treeDiedBefore.male);
    assert.equal(d.people[1].badge, t.treeDiedLater.female);
    assert.equal(d.people[1].secondary, "Name");
    assert.equal(d.people[0].secondary, null);
  }
});

test("pin keeps the whole box in LTR and negative-scroll RTL at every zoom", () => {
  for (const z of [0.6, 1.5]) for (const rtl of [false, true]) {
    const v = { width: 320, height: 280, scrollLeft: rtl ? -120 : 120, scrollTop: 400 };
    const p = pinBox({ x: 20, y: 0, width: 108, height: 112 }, v, z, 6, rtl);
    assert.ok(p.x * z >= 126 && (p.x + p.width) * z <= 434);
    assert.ok(p.y * z >= 406 && (p.y + p.height) * z <= 674);
  }
});
test("fit picks the largest allowed level and falls back to minimum", () => {
  assert.equal(fitZoom({ width: 300, height: 300 }, { width: 320, height: 320 }), 1);
  assert.equal(fitZoom({ width: 400, height: 400 }, { width: 340, height: 340 }), 0.8);
  assert.equal(fitZoom({ width: 400, height: 4000 }, { width: 320, height: 320 }), 0.6);
});

const base: Case = { id: "case", revision: 1, started_at: "", madhab: "hanafi", deceased: { gender: "male", estate: null }, heirs: [], deaths: [], heir_options: { blocked: [], invalid: {} } };
test("lineage includes died-before people and ignores unshown/root endpoints", () => {
  const kase: Case = { ...base, heirs: [{ edit_options: { blocked: [], invalid: {} }, id: "g", relationship: "son_of_son", gender: "male", name: null }], persons: [{ id: "s", relationship: "son", gender: "male", name: null, status: "died_before_or_with", death_order: null }], edges: [{ kind: "parent_of", from: "s", to: "g" }, { kind: "parent_of", from: "missing", to: "s" }] };
  const model = estateModel(kase, null, null), layout = layoutModel(model, 320);
  assert.equal(model.people[0].state, "died_before");
  assert.equal(model.people[0].parentId, null);
  assert.equal(model.people[1].parentId, "s");
  const parent = layout.nodes.find(n => n.id === "s")!;
  assert.equal(layout.nodes.find(n => n.id === "g")!.x, parent.x);
  assert.deepEqual(treeDescription(messages.en.interview, model).people.map(p => p.id), layout.nodes.map(n => n.id));
  assert.ok(layout.edges.find(e => e.id === "g")!.path.startsWith(`M${parent.x + parent.width / 2} ${parent.y + parent.height}`));
});
test("empty placement creates only permitted parent/spouse placeholders", () => {
  const model = estateModel({ ...base, placement: { root: [{ relationship: "father", link: "parent", blocked: false }] } }, null, null);
  assert.deepEqual(placeholders(model), ["parent"]);
});

test("blocked state uses only supplied evidence of the active estate order", () => {
  const served = JSON.parse(readFileSync(new URL("../../../api/contracts/preview-presented-fixtures.json", import.meta.url), "utf8"));
  const presented = parsePresentedResult(served.presented["Grandfather and brother under Hanafi"]);
  const kase: Case = { ...base, heirs: [ { id: "h2", gender: "male", name: null, relationship: "brother", edit_options: { blocked: [], invalid: {} } } ] };
  assert.equal(estateModel(kase, null, presented).people[0].state, "blocked");
  assert.equal(estateModel(kase, null, null).people[0].state, "normal");
  const other: PresentedResult = { ...presented, evidence: presented.evidence.map(e => ({ ...e, order: 2 })) };
  assert.equal(estateModel(kase, null, other).people[0].state, "normal");
});
test("later estate resolves person aliases, excludes died-before and remaps deceased edges to root", () => {
  const options = { blocked: [], invalid: {} };
  const kase: Case = { ...base, heirs: [{ id: "wife", gender: "female", name: null, relationship: "wife", edit_options: options }],
    persons: [{ id: "before", gender: "male", relationship: "son", name: null, status: "died_before_or_with", death_order: null }],
    deaths: [{ heir_id: "wife", order: 2, gender: "female", heir_options: options, heirs: [
      { id: "row", same_as: "h2", gender: "male", name: null, relationship: "brother", edit_options: options }
    ] }], edges: [{ kind: "parent_of", from: "wife", to: "h2" }] };
  assert.equal(estateModel(kase, null, null).people.find(p => p.id === "wife")?.state, "died_later");
  const model = estateModel(kase, "wife", null);
  assert.equal(model.people.length, 1);
  assert.equal(model.people[0].id, "row"); assert.equal(model.people[0].personId, "h2");
  assert.equal(model.people[0].parentId, null);
  assert.equal(model.people[0].state, "normal");
  assert.equal(treeDescription(messages.en.interview, model, "Wife (2nd death)").deceased, "Wife (2nd death)");
  assert.deepEqual(placeholders(model), []);
});

test("card widths are parameters and every fifty-person box stays reachable", () => {
  const model: EstateModel = { people: many(50).map(p => ({ ...p, personId: p.id, gender: "male", name: null, state: "normal", parentId: null })), placement: {} };
  for (const [width, cardWidth] of [[343, 108], [560, 136]]) {
    const layout = layoutModel(model, width, cardWidth);
    assert.ok([layout.deceased, ...layout.nodes].every(n => n.width === cardWidth && n.height >= 76 && n.x >= 0 && n.x + n.width <= layout.width));
  }
});

test("removal focus follows surviving siblings with the same parent and generation", () => {
  const people: EstateModel["people"] = ["first", "removed", "other-parent", "last"].map(id => ({
    id, personId: id, relationship: "son", gender: "male", name: null, state: "normal",
    parentId: id === "other-parent" ? "b" : "a",
  }));
  const model = { people, placement: {} };
  assert.equal(focusAfterRemoval(model, "removed"), "last");
  assert.equal(focusAfterRemoval(model, "last"), "removed");
  assert.equal(focusAfterRemoval(model, "removed", new Set(["first"])), "first");
  assert.equal(focusAfterRemoval(model, "other-parent"), "root");
});

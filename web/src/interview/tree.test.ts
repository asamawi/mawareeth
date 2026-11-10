import assert from "node:assert/strict";
import { test } from "node:test";

import { RELATIONSHIP_IDS, type RelationshipId } from "../api/case.ts";
import { locales, messages } from "../i18n/messages.ts";
import {
  generationLines,
  layoutTree,
  lineOf,
  NODE_HEIGHT,
  scrollTopFor,
  treeDescription,
  treeSummary,
  type TreeLayout,
} from "./tree.ts";

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

test("scrollTopFor shows a node with the least movement", () => {
  const cases: [number, number, number, number, number][] = [
    // top, height, scrollTop, view, expected
    [100, 80, 0, 300, 0],
    [400, 80, 0, 300, 180],
    [20, 80, 100, 300, 20],
    [10, 80, 0, 300, 0],
    [100, 80, 50, 60, 100],
    [-5, 80, 0, 300, 0],
  ];
  for (const [top, height, scroll, view, expected] of cases) {
    assert.equal(scrollTopFor(top, height, scroll, view), expected, `${top},${height},${scroll},${view}`);
  }
});

const SAMPLE = heirs("son", "wife", "son");
const SENTENCES: Record<string, { male: string; female: string; none: [string, string] }> = {
  en: {
    male: "Family tree. The deceased, male. Wife: 1. Son: 2.",
    female: "Family tree. The deceased, female. Wife: 1. Son: 2.",
    none: ["Family tree. The deceased, male.", "Family tree. The deceased, female."],
  },
  ar: {
    male: "شجرة العائلة. المتوفى (ذكر). زوجة: 1. ابن: 2.",
    female: "شجرة العائلة. المتوفاة (أنثى). زوجة: 1. ابن: 2.",
    none: ["شجرة العائلة. المتوفى (ذكر).", "شجرة العائلة. المتوفاة (أنثى)."],
  },
  fr: {
    male: "Arbre généalogique. Le défunt, homme. Épouse : 1. Fils : 2.",
    female: "Arbre généalogique. La défunte, femme. Épouse : 1. Fils : 2.",
    none: ["Arbre généalogique. Le défunt, homme.", "Arbre généalogique. La défunte, femme."],
  },
};

test("the description reads in full in every locale, for both genders", () => {
  for (const locale of locales) {
    const text = messages[locale].interview;
    const expected = SENTENCES[locale];
    assert.equal(treeDescription(text, { gender: "male", estate: null }, SAMPLE), expected.male, locale);
    assert.equal(treeDescription(text, { gender: "female", estate: null }, SAMPLE), expected.female, locale);
    assert.equal(treeDescription(text, { gender: "male", estate: null }, []), expected.none[0], locale);
    assert.equal(treeDescription(text, { gender: "female", estate: null }, []), expected.none[1], locale);
  }
});

test("the description leaves no placeholder and never holds a name", () => {
  const named = [
    { id: "a", relationship: "son" as const, name: "Zaid Qasim" },
    { id: "b", relationship: "wife" as const, name: "{heir} {n}" },
  ];
  for (const locale of locales) {
    for (const heirsIn of [[], named]) {
      const text = treeDescription(messages[locale].interview, { gender: "male", estate: null }, heirsIn);
      assert.ok(!/[{}]/.test(text), text);
      assert.ok(!text.includes("Zaid") && !text.includes("Qasim"), text);
    }
  }
});

test("the summary counts by relationship in table order", () => {
  const summary = treeSummary(heirs("wife", "son", "son", "father"));
  assert.deepEqual(summary, [
    { relationship: "father", count: 1 },
    { relationship: "wife", count: 1 },
    { relationship: "son", count: 2 },
  ]);
  assert.deepEqual(treeSummary([]), []);
});


test("tree descriptions preserve placeholders and dollar patterns inside a later deceased's name", () => {
  const text = { ...messages.en.interview, treeSummary: "{deceased}: {heirs}" };
  assert.equal(treeDescription(text, { gender: "male" }, [], "{heirs} $&"), "{heirs} $&: ");
});

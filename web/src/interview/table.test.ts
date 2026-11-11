import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePreview, type Preview } from "../api/case.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bodyCells, hasTable, NO_NOTE, noteReducer, pruneNote, tableView, visibleNote, type NoteAction } from "./table.ts";

const dir = dirname(fileURLToPath(import.meta.url));
const fixtureFile = JSON.parse(
  readFileSync(join(dir, "..", "..", "..", "api", "contracts", "preview-fixtures.json"), "utf8"),
) as { fixtures: { title: string; response: unknown }[] };

type Available = Extract<Preview, { status: "available" }>;

function available(title: string): Available {
  const fixture = fixtureFile.fixtures.find((item) => item.title === title);
  const preview = parsePreview(fixture?.response);
  assert.equal(preview?.status, "available", title);
  return preview as Available;
}

test("a plain case has the base column, the prescribed share and the residuary", () => {
  const preview = available("Hanbali wife and son with an estate");
  assert.ok(hasTable(preview));
  const view = tableView(preview.table, preview);
  assert.deepEqual(view.columns.map((column) => column.code), ["base"]);
  assert.equal(view.columns[0].total, 8);
  assert.deepEqual(view.rows[0].prescribed, { kind: "fraction", fraction: "1/8" });
  assert.deepEqual(view.rows[1].prescribed, { kind: "residuary" });
  assert.equal(view.rows[0].percent, "12.5");
  assert.equal(view.rows[0].amount, "1000.00");
  assert.equal(view.rows[0].kirat, "3.00");
  assert.deepEqual(view.rows[0].cells, [{ value: 1, rowSpan: 1 }]);
});

test("awl and radd add their columns with the engine's totals", () => {
  const awl = available("Husband and two sisters need awl");
  assert.ok(hasTable(awl));
  assert.deepEqual(tableView(awl.table, awl).columns.map((c) => [c.code, c.total]), [["base", 6], ["awl", 7]]);
  const radd = available("Hanafi mother and daughter need radd");
  assert.ok(hasTable(radd));
  assert.deepEqual(tableView(radd.table, radd).columns.map((c) => c.code), ["base", "radd"]);
});

test("every single-death fixture has a table and layered ones have none", () => {
  for (const fixture of fixtureFile.fixtures) {
    const preview = parsePreview(fixture.response);
    assert.ok(preview, fixture.title);
    if (preview.status !== "available") continue;
    assert.equal(hasTable(preview), !preview.basis.deaths, fixture.title);
    if (!hasTable(preview)) continue;
    const view = tableView(preview.table, preview);
    assert.equal(view.rows.length, preview.shares.length, fixture.title);
    for (const row of view.rows) {
      if (row.prescribed.kind === "blocked") assert.ok(row.cells.every((cell) => cell.value === null), fixture.title);
    }
  }
});

test("a group that does not divide is one merged cell and the correction column has each part", () => {
  const preview = available("Hanbali wife and three sons need correction");
  assert.ok(hasTable(preview));
  const view = tableView(preview.table, preview);
  assert.deepEqual(view.columns.map((column) => column.code), ["base", "correction"]);
  assert.deepEqual(view.rows.map((row) => row.cells[0].rowSpan), [1, 3, 0, 0]);
  assert.deepEqual(view.rows.map((row) => row.cells[1].rowSpan), [1, 1, 1, 1]);
  assert.equal(view.rows[1].cells[0].value, 7);
});

test("radd with a spouse and two radd groups has the three radd columns", () => {
  const preview = available("Hanafi wife, mother and daughter need radd with a spouse");
  assert.ok(hasTable(preview));
  const view = tableView(preview.table, preview);
  assert.deepEqual(view.columns.map((column) => column.code), ["base", "radd", "radd_calc", "radd_union"]);
});

test("a blocked heir has the blocked text and empty cells", () => {
  const preview = available("Father blocks the brother");
  assert.ok(hasTable(preview));
  const view = tableView(preview.table, preview);
  const blocked = view.rows.find((row) => row.prescribed.kind === "blocked");
  assert.ok(blocked);
  assert.ok(blocked.cells.every((cell) => cell.value === null && cell.rowSpan === 1));
  assert.equal(blocked.percent, null);
});

test("the note follows hover and focus, a pin survives leaving, and a click on the shown heir closes it", () => {
  const run = (...actions: NoteAction[]) => actions.reduce(noteReducer, NO_NOTE);
  assert.equal(visibleNote(NO_NOTE), null);
  assert.equal(visibleNote(run({ type: "hover", id: "a" })), "a");
  assert.equal(visibleNote(run({ type: "hover", id: "a" }, { type: "unhover", id: "a" })), null);
  assert.equal(visibleNote(run({ type: "focus", id: "a" })), "a");
  assert.equal(visibleNote(run({ type: "focus", id: "a" }, { type: "blur", id: "a" })), null);
  // a click pins and survives leaving
  const pinned = run({ type: "hover", id: "a" }, { type: "toggle", id: "a" }, { type: "unhover", id: "a" });
  assert.equal(visibleNote(pinned), "a");
  // clicking the shown, pinned heir closes it even while the pointer is on the row
  const closed = run({ type: "hover", id: "a" }, { type: "toggle", id: "a" }, { type: "toggle", id: "a" });
  assert.equal(visibleNote(closed), null);
  // the pointer can move to the panel without closing the note, and leaving it closes
  const onPanel = run({ type: "hover", id: "a" }, { type: "unhover", id: "a" }, { type: "panelEnter" });
  assert.equal(visibleNote(onPanel), "a");
  assert.equal(visibleNote(noteReducer(onPanel, { type: "panelLeave" })), null);
  // escape closes everything, the pin included
  assert.deepEqual(run({ type: "focus", id: "a" }, { type: "toggle", id: "a" }, { type: "escape" }), NO_NOTE);
});

test("a pin does not override another heir's focus or hover", () => {
  const pinnedA = noteReducer(NO_NOTE, { type: "toggle", id: "a" });
  assert.equal(visibleNote(pinnedA), "a");
  const focusB = noteReducer(pinnedA, { type: "focus", id: "b" });
  assert.equal(visibleNote(focusB), "b");
  assert.equal(visibleNote(noteReducer(focusB, { type: "blur", id: "b" })), "a");
  assert.equal(visibleNote(noteReducer(pinnedA, { type: "hover", id: "b" })), "b");
  // a click on a heir that is not the shown one pins that heir
  assert.equal(visibleNote(noteReducer(pinnedA, { type: "toggle", id: "b" })), "b");
});

test("heirs that leave the table are forgotten", () => {
  const actions: NoteAction[] = [
    { type: "hover", id: "a" },
    { type: "focus", id: "b" },
    { type: "toggle", id: "c" },
  ];
  const state = actions.reduce(noteReducer, NO_NOTE);
  assert.equal(pruneNote(state, new Set(["a", "b", "c"])), state);
  assert.deepEqual(pruneNote(state, new Set(["b"])), { ...NO_NOTE, focused: "b" });
  assert.equal(visibleNote(pruneNote(state, new Set())), null);
});

test("the correction fixture renders one merged base cell and a cell per son in the correction column", () => {
  const preview = available("Hanbali wife and three sons need correction");
  assert.ok(hasTable(preview));
  const view = tableView(preview.table, preview);
  const rendered = view.rows.map((row) => bodyCells(row, view.columns));
  assert.equal(rendered[0].length, 2);
  assert.deepEqual(rendered[1][0], { code: "base", value: 7, rowSpan: 3 });
  assert.deepEqual(rendered[2].map((cell) => cell.code), ["correction"]);
  assert.deepEqual(rendered[3].map((cell) => cell.code), ["correction"]);
  assert.deepEqual(rendered.slice(1).map((cells) => cells.filter((c) => c.code === "correction").length), [1, 1, 1]);
});

test("a residuary left nothing is residuary with 0, not blocked", () => {
  const preview = available("Hanafi keeps the full brother residuary");
  assert.ok(hasTable(preview));
  const row = tableView(preview.table, preview).rows.find((item) => item.heirId === "h5");
  assert.ok(row);
  assert.deepEqual(row.prescribed, { kind: "residuary" });
  assert.deepEqual(row.cells, [{ value: 0, rowSpan: 1 }]);
});

test("two wives share one prescribed cell", () => {
  const preview = available("Hanbali wife and son with an estate");
  assert.ok(hasTable(preview));
  const wife = preview.table.rows[0];
  const table = {
    ...preview.table,
    rows: [
      { ...wife, group_span: 2 },
      { ...wife, heir: "second-wife", group_span: 0 },
      preview.table.rows[1],
    ],
  };
  const view = tableView(table, preview);
  assert.deepEqual(view.rows.map((row) => row.prescribedSpan), [2, 0, 1]);
  assert.deepEqual(view.rows[0].prescribed, { kind: "fraction", fraction: "1/8" });
});

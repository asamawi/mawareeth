import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePreview, type Preview } from "../api/case.ts";
import { previewFixtures } from "../test/preview-fixtures.ts";
import { bodyCells, evidenceNotes, hasTable, NO_NOTE, noteReducer, pruneNote, tableView, visibleNote, type NoteAction } from "./table.ts";

const fixtureFile = { fixtures: previewFixtures };

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
  const view = tableView(preview.presented.table, preview);
  assert.deepEqual(view.columns.map((column) => column.code), ["base"]);
  assert.equal(view.columns[0].total, 8);
  assert.deepEqual(view.rows[0].prescribed, { kind: "fraction", fraction: "1/8" });
  assert.deepEqual(view.rows[1].prescribed, { kind: "residuary" });
  assert.equal(view.rows[0].percent, "12.5%");
  assert.equal(view.rows[0].amount, "SAR1,000.00");
  assert.equal(view.rows[0].kirat, "3.00");
  assert.deepEqual(view.rows[0].cells, [{ value: 1, text: "1", rowSpan: 1 }]);
  assert.equal(view.columns[0].totalText, "8");
});

test("awl and radd add their columns with the engine's totals", () => {
  const awl = available("Husband and two sisters need awl");
  assert.ok(hasTable(awl));
  assert.deepEqual(tableView(awl.presented.table, awl).columns.map((c) => [c.code, c.total]), [["base", 6], ["awl", 7]]);
  const radd = available("Hanafi mother and daughter need radd");
  assert.ok(hasTable(radd));
  assert.deepEqual(tableView(radd.presented.table, radd).columns.map((c) => c.code), ["base", "radd"]);
});

test("every available fixture has a table", () => {
  for (const fixture of fixtureFile.fixtures) {
    const preview = parsePreview(fixture.response);
    assert.ok(preview, fixture.title);
    if (preview.status !== "available") continue;
    assert.equal(hasTable(preview), true, fixture.title);
    if (!hasTable(preview)) continue;
    const view = tableView(preview.presented.table, preview);
    const presentedTable = preview.presented.table;
    assert.equal(view.rows.length, preview.basis.deaths ? presentedTable.rows.length + ("layers" in presentedTable && presentedTable.unallocated ? 1 : 0) : preview.shares.length, fixture.title);
    for (const row of view.rows) {
      if (row.prescribed.kind === "blocked") assert.ok(row.cells.every((cell) => cell.value === null), fixture.title);
    }
  }
});

test("a group that does not divide is one merged cell and the correction column has each part", () => {
  const preview = available("Hanbali wife and three sons need correction");
  assert.ok(hasTable(preview));
  const view = tableView(preview.presented.table, preview);
  assert.deepEqual(view.columns.map((column) => column.code), ["base", "correction"]);
  assert.deepEqual(view.rows.map((row) => row.cells[0].rowSpan), [1, 3, 0, 0]);
  assert.deepEqual(view.rows.map((row) => row.cells[1].rowSpan), [1, 1, 1, 1]);
  assert.equal(view.rows[1].cells[0].value, 7);
});

test("radd with a spouse and two radd groups has the three radd columns", () => {
  const preview = available("Hanafi wife, mother and daughter need radd with a spouse");
  assert.ok(hasTable(preview));
  const view = tableView(preview.presented.table, preview);
  assert.deepEqual(view.columns.map((column) => column.code), ["base", "radd", "radd_calc", "radd_union"]);
});

test("a blocked heir has the blocked text and empty cells", () => {
  const preview = available("Father blocks the brother");
  assert.ok(hasTable(preview));
  const view = tableView(preview.presented.table, preview);
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
  const view = tableView(preview.presented.table, preview);
  const rendered = view.rows.map((row) => bodyCells(row, view.columns));
  assert.equal(rendered[0].length, 2);
  assert.deepEqual(rendered[1][0], { code: "base", value: 7, text: "7", rowSpan: 3 });
  assert.deepEqual(rendered[2].map((cell) => cell.code), ["correction"]);
  assert.deepEqual(rendered[3].map((cell) => cell.code), ["correction"]);
  assert.deepEqual(rendered.slice(1).map((cells) => cells.filter((c) => c.code === "correction").length), [1, 1, 1]);
});

test("a residuary left nothing is residuary with 0, not blocked", () => {
  const preview = available("Hanafi keeps the full brother residuary");
  assert.ok(hasTable(preview));
  const row = tableView(preview.presented.table, preview).rows.find((item) => item.heirId === "h5");
  assert.ok(row);
  assert.deepEqual(row.prescribed, { kind: "residuary" });
  assert.deepEqual(row.cells, [{ value: 0, text: "0", rowSpan: 1 }]);
});

test("two wives share one prescribed cell", () => {
  const preview = available("Hanbali wife and son with an estate");
  assert.ok(hasTable(preview));
  const source = preview.presented.table;
  assert.ok(!("layers" in source));
  const wife = source.rows[0];
  const table = {
    ...source,
    rows: [
      { ...wife, group_span: 2 },
      { ...wife, heir: "second-wife", group_span: 0 },
      source.rows[1],
    ],
  };
  const view = tableView(table, preview);
  assert.deepEqual(view.rows.map((row) => row.prescribedSpan), [2, 0, 1]);
  assert.deepEqual(view.rows[0].prescribed, { kind: "fraction", fraction: "1/8" });
});


test("layered tables group columns and notes by death and preserve final server parts", () => {
  let hasRepeatedPerson = false;
  for (const fixture of fixtureFile.fixtures) {
    const preview = parsePreview(fixture.response);
    if (preview?.status !== "available" || preview.proof?.version !== 2) continue;
    assert.ok(hasTable(preview) && "layers" in preview.presented.table);
    const table = preview.presented.table;
    const view = tableView(table, preview);
    assert.equal(view.groups?.length, preview.proof.layers.length);
    assert.equal(new Set(view.columns.map((c) => c.code)).size, view.columns.length);
    assert.deepEqual(view.rows.filter((r) => r.kind !== "unallocated").map((r) => r.heirId), table.rows.map((r) => r.heir));
    const last = table.layers.at(-1)!;
    assert.equal(view.columns.at(-1)?.total, last.jamia.value);
    assert.equal(view.columns.at(-1)?.totalText, last.jamia.text);
    for (const row of view.rows) {
      const expected = row.kind === "unallocated" ? last.unallocated : last.parts.find((p) => p.heir === row.heirId)!.value;
      assert.equal(row.cells.at(-1)?.value, expected.value);
      assert.equal(row.cells.at(-1)?.text, expected.text);
      const notes = view.notes?.[row.heirId] ?? [];
      if (row.kind === "unallocated") continue;
      // every note is the server's own wording of that person's evidence in that estate
      const expectedNotes: { order: number; rule: string }[] = (preview.presented?.evidence ?? []).flatMap((layer) => layer.heirs
        .filter((entry) => entry.person === row.heirId)
        .map((entry) => ({ order: layer.order, rule: entry.rule.text })));
      assert.deepEqual(notes.map((note) => ({ order: note.order, rule: note.proof.labels.rule })), expectedNotes, `${fixture.title}: ${row.heirId}`);
      if (new Set(expectedNotes.map((note) => note.order)).size >= 2) hasRepeatedPerson = true;
    }
  }
  assert.ok(hasRepeatedPerson, "fixtures include notes for one person from two deaths");
});

test("layered vocabulary is translated in every locale", async () => {
  const { messages } = await import("../i18n/messages.ts");
  for (const text of Object.values(messages)) {
    for (const key of ["death", "deceasedShare", "multiplier", "jamia", "noShare", "unallocated", "tamathul", "tawafuq", "tabayun"] as const) {
      assert.ok(text.results.table[key]);
      assert.ok(!text.results.table[key].includes("?"));
    }
  }
});


test("layered rows distinguish unallocated people and annotate separated prescribed groups", () => {
  const preview = fixtureFile.fixtures.map((f) => parsePreview(f.response))
    .find((p) => p?.status === "available" && p.proof?.version === 2);
  assert.ok(preview?.status === "available" && hasTable(preview) && "layers" in preview.presented.table);
  const table = structuredClone(preview.presented.table);
  const layer = table.layers[0];
  const source = layer.table.rows[0];
  const third = { ...source.prescribed!, value: { numerator: 2, denominator: 3 }, text: "2/3" };
  table.rows = [{ heir: "unallocated" }, { heir: "constructor" }, { heir: "__proto__" }];
  table.unallocated = true;
  layer.table.rows = [
    { ...source, heir: "unallocated", blocked: false, prescribed: third, group_span: 2, cells: source.cells.map((c) => ({ ...c, span: 2 })) },
    { ...source, heir: "__proto__", blocked: false, prescribed: third, group_span: 0, cells: source.cells.map((c) => ({ ...c, span: 0 })) },
    { ...source, heir: "constructor", group_span: 1, cells: source.cells.map((c) => ({ ...c, span: 1 })) },
  ];
  const presented = structuredClone(preview.presented!);
  presented.table = table;
  const entry = presented.evidence[0].heirs[0];
  presented.evidence = [{ ...presented.evidence[0], heirs: table.rows.map((r) => ({ ...entry, person: r.heir })) }];
  const changed = { ...preview, presented };
  const view = tableView(table, changed);
  assert.equal(Object.getPrototypeOf(view.notes), null);
  for (const row of table.rows) assert.deepEqual(view.notes?.[row.heir], evidenceNotes(changed)[row.heir]);
  assert.equal(view.notes?.["constructor"]?.[0].order, presented.evidence[0].order);
  assert.equal(view.rows[0].heirId, "unallocated");
  assert.equal(view.rows[0].kind, undefined);
  assert.equal(view.rows.at(-1)?.kind, "unallocated");
  assert.equal(view.rows.at(-1)?.percent, null);
  assert.deepEqual(view.rows[0].cells[0].members, ["unallocated", "__proto__"]);
  assert.deepEqual(view.rows[2].cells[0].members, ["unallocated", "__proto__"]);
  assert.equal(view.rows[2].cells[0].covered, true);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parsePreview, PREVIEW_REASONS, type Case, type Preview } from "../api/case.ts";
import { locales, messages } from "../i18n/messages.ts";
import { basisKey, percentOf, previewKey, previewReady, previewRows, reconcile, shown } from "./preview.ts";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => JSON.parse(readFileSync(join(dir, "..", "..", "..", "api", "contracts", name), "utf8"));

type Fixture = {
  title: string;
  case: Case;
  response: unknown;
  display: ReturnType<typeof previewRows> | null;
};
const fixtures = (read("preview-fixtures.json") as { fixtures: Fixture[] }).fixtures;
const contract = read("interview.json") as { previewReasons: string[] };

const BASE: Case = {
  id: "c1",
  started_at: "2026-11-07T10:00:00Z",
  madhab: "hanbali",
  deceased: { gender: "male", estate: "8000" },
  heirs: [
    { id: "h1", relationship: "wife", gender: "female", name: "Amal" },
    { id: "h2", relationship: "son", gender: "male", name: null },
  ],
};

test("every fixture response parses strictly and displays as the fixture says", () => {
  assert.ok(fixtures.length >= 12);
  for (const fixture of fixtures) {
    const preview = parsePreview(fixture.response);
    assert.ok(preview, fixture.title);
    assert.deepEqual(preview, fixture.response, fixture.title);
    if (preview.status === "available") {
      assert.deepEqual(previewRows(preview), fixture.display, fixture.title);
    } else {
      assert.equal(fixture.display, null, fixture.title);
    }
  }
});

test("the fixtures cover every refusal reason and each kind of answer", () => {
  assert.deepEqual([...PREVIEW_REASONS], contract.previewReasons);
  const seen = new Set(fixtures.map((fixture) => (fixture.response as Preview & { reason?: string }).reason).filter(Boolean));
  assert.deepEqual([...seen].sort(), [...PREVIEW_REASONS].sort());
  const statuses = new Set(fixtures.map((fixture) => (fixture.response as Preview).status));
  assert.deepEqual([...statuses].sort(), ["available", "not_ready", "unavailable"]);
});

test("every refusal reason has a sentence in every language", () => {
  for (const locale of locales) {
    assert.deepEqual(Object.keys(messages[locale].interview.previewReasons).sort(), [...PREVIEW_REASONS].sort());
  }
  assert.match(messages.en.interview.previewReasons.radd_disputed, /public treasury/);
  assert.match(messages.en.interview.previewReasons.grandmother_line_unknown, /not recorded/);
});

test("the matrix's displayed rows", () => {
  const by = (title: string) => fixtures.find((fixture) => fixture.title === title)?.display;
  const withEstate = by("Hanbali wife and son with an estate");
  assert.deepEqual(
    withEstate?.rows.map((row) => [row.fraction, row.percent, row.amount]),
    [
      ["1/8", "12.5", "1000.00"],
      ["7/8", "87.5", "7000.00"],
    ],
  );
  assert.ok(by("Hanbali wife and son without an estate")?.rows.every((row) => row.amount === null));
  assert.deepEqual(by("Father blocks the brother")?.rows[1], {
    heirId: "h2",
    blocked: true,
    fraction: null,
    percent: null,
    amount: null,
  });
  assert.deepEqual(by("Wife alone leaves an unallocated remainder")?.unallocated, { fraction: "3/4", percent: "75.0" });
  assert.deepEqual(by("Grandfather and brother under Hanafi")?.rows.map((row) => row.blocked), [false, true]);
});

test("percentages round half up to one decimal without floats", () => {
  assert.equal(percentOf(1, 8), "12.5");
  assert.equal(percentOf(1, 16), "6.3");
  assert.equal(percentOf(1, 3), "33.3");
  assert.equal(percentOf(2, 3), "66.7");
  assert.equal(percentOf(1, 1), "100.0");
  assert.equal(percentOf(0, 1), "0.0");
  assert.equal(percentOf(1, 2000), "0.1");
  assert.equal(percentOf(1, 4000), "0.0");
});

test("the key follows what changes a share and ignores names", () => {
  const key = previewKey(BASE);
  const renamed = { ...BASE, heirs: BASE.heirs.map((heir) => ({ ...heir, name: "Someone else" })) };
  assert.equal(previewKey(renamed), key);
  const changes: Case[] = [
    { ...BASE, id: "c2" },
    { ...BASE, madhab: "hanafi" },
    { ...BASE, madhab: null },
    { ...BASE, deceased: { gender: "female", estate: "8000" } },
    { ...BASE, deceased: { gender: "male", estate: "8001" } },
    { ...BASE, deceased: { gender: "male", estate: null } },
    { ...BASE, heirs: BASE.heirs.slice(0, 1) },
    { ...BASE, heirs: [...BASE.heirs].reverse() },
    { ...BASE, heirs: [{ ...BASE.heirs[0], relationship: "husband", gender: "male" }, BASE.heirs[1]] },
    { ...BASE, heirs: [{ ...BASE.heirs[0], id: "h9" }, BASE.heirs[1]] },
  ];
  for (const changed of changes) assert.notEqual(previewKey(changed), key, JSON.stringify(changed));
  assert.equal(new Set(changes.map(previewKey)).size, changes.length);
});

test("a case is ready only with a school, a deceased and an heir", () => {
  assert.equal(previewReady(BASE), true);
  assert.equal(previewReady({ ...BASE, madhab: null }), false);
  assert.equal(previewReady({ ...BASE, deceased: null }), false);
  assert.equal(previewReady({ ...BASE, heirs: [] }), false);
});

test("an answer for another family is treated like a 409, and one for this family is kept", () => {
  const mine = fixtures.find((fixture) => fixture.title === "Hanbali wife and son with an estate");
  const refused = fixtures.find((fixture) => fixture.title === "Jafari is not supported");
  assert.ok(mine && refused);
  for (const fixture of [mine, refused]) {
    const preview = parsePreview(fixture.response) as Preview;
    const key = previewKey(fixture.case);
    assert.equal(key, basisKey(fixture.case.id, (preview as Exclude<Preview, { status: "not_ready" }>).basis), fixture.title);
    const outcome = { kind: "preview" as const, preview };
    assert.deepEqual(reconcile(key, fixture.case.id, outcome), outcome);
    const others: Case[] = [
      { ...fixture.case, madhab: "hanafi" },
      { ...fixture.case, deceased: { gender: "female", estate: fixture.case.deceased?.estate ?? null } },
      { ...fixture.case, deceased: { gender: "male", estate: "1" } },
      { ...fixture.case, heirs: fixture.case.heirs.slice(1) },
      { ...fixture.case, heirs: [...fixture.case.heirs, { id: "x", relationship: "son", gender: "male", name: null }] },
      { ...fixture.case, heirs: fixture.case.heirs.map((heir, i) => (i === 0 ? { ...heir, relationship: "daughter" as const, gender: "female" as const } : heir)) },
    ];
    for (const other of others) {
      assert.deepEqual(reconcile(previewKey(other), other.id, outcome), { kind: "replaced" }, fixture.title);
    }
  }
  const failed = { kind: "failed" as const };
  assert.equal(reconcile("k", "c", failed), failed);
  assert.deepEqual(reconcile("k", "c", { kind: "preview", preview: { status: "not_ready" } }), { kind: "replaced" });
});

test("a result is shown only for the key and attempt it was asked for", () => {
  const key = previewKey(BASE);
  const settled = { key, attempt: 0, outcome: "numbers" };
  assert.equal(shown({ key, attempt: 0 }, settled), "numbers");
  assert.equal(shown({ key: previewKey({ ...BASE, madhab: "hanafi" }), attempt: 0 }, settled), null);
  assert.equal(shown({ key, attempt: 1 }, settled), null);
  assert.equal(shown({ key, attempt: 0 }, null), null);
});

test("the estate hint asks for the amount after debts, funeral costs and bequests", () => {
  assert.match(messages.en.interview.estateHint, /debts, funeral costs and bequests/);
  assert.match(messages.fr.interview.estateHint, /dettes.*frais funéraires.*legs/);
  assert.match(messages.ar.interview.estateHint, /الديون.*الدفن.*الوصايا/);
});

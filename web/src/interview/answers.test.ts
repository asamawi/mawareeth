import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { KINSHIP_CODES, parseHeirOptions, RELATIONSHIP_IDS } from "../api/case.ts";
import { locales, messages } from "../i18n/messages.ts";
import {
  BLANK_DECEASED,
  BLANK_HEIR,
  deceasedValues,
  fill,
  firstInvalid,
  formatEstate,
  formFor,
  formStore,
  heirLabel,
  heirLabels,
  heirLimitReached,
  heirValues,
  normalizeDigits,
  templateParts,
  unnamedOrdinal,
  parseEstate,
  parseName,
  heirOptionLabels,
  relationshipIssue,
  validateDeceased,
  validateField,
  validateHeir,
  LINK_PENDING,
  valuesFor,
  type FormRecord,
} from "./answers.ts";

function memory(initial?: string) {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set("mawareeth.form-record", initial);
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

test("digits: Eastern Arabic, Persian and the Arabic decimal separator become ASCII", () => {
  assert.equal(normalizeDigits("١٢٣٤٫٥٠"), "1234.50");
  assert.equal(normalizeDigits("۱۲۳٫۴"), "123.4");
  assert.equal(normalizeDigits("12.5 abc"), "12.5 abc");
});

test("estate: table of amounts", () => {
  const table: [string, string | null, string | null][] = [
    ["", null, null],
    ["   ", null, null],
    ["1", "1", null],
    ["0.01", "0.01", null],
    ["1250000.5", "1250000.5", null],
    [" 12 ", "12", null],
    ["١٢٣٤٫٥", "1234.5", null],
    ["999999999999999", "999999999999999", null],
    ["999999999999999.99", "999999999999999.99", null],
    ["0", null, "not_positive"],
    ["007", "7", null],
    ["00.50", "0.50", null],
    ["0000000000000007", "7", null],
    ["1250,50", "1250.50", null],
    ["1,5", "1.5", null],
    ["١٢٥٠٫٥", "1250.5", null],
    ["1,2345", null, "invalid"],
    ["1,25,0", null, "invalid"],
    ["0,00", null, "not_positive"],
    ["0.00", null, "not_positive"],
    ["000", null, "not_positive"],
    ["-5", null, "invalid"],
    ["+5", null, "invalid"],
    ["1.234", null, "decimals"],
    ["1000000000000000", null, "too_large"],
    ["1000000000000000.5", null, "too_large"],
    ["abc", null, "invalid"],
    ["1e5", null, "invalid"],
    ["1,000", null, "invalid"],
    [".5", null, "invalid"],
    ["5.", null, "invalid"],
    ["1 000", null, "invalid"],
  ];
  for (const [raw, value, code] of table) {
    assert.deepEqual(parseEstate(raw), { value, code }, JSON.stringify(raw));
  }
});

test("name: trimmed, optional, 100 characters, no control characters", () => {
  assert.deepEqual(parseName("  Amal  "), { value: "Amal", code: null });
  assert.deepEqual(parseName("   "), { value: null, code: null });
  assert.deepEqual(parseName(""), { value: null, code: null });
  assert.deepEqual(parseName("x".repeat(100)), { value: "x".repeat(100), code: null });
  assert.deepEqual(parseName("x".repeat(101)), { value: null, code: "too_long" });
  assert.deepEqual(parseName("محمد"), { value: "محمد", code: null });
  for (const bad of ["a\u0000b", "a\nb", "a\tb", "a\u007fb", `a${String.fromCharCode(0x2028)}b`]) {
    assert.deepEqual(parseName(bad), { value: null, code: "invalid" }, JSON.stringify(bad));
  }
});

test("deceased: gender is required, estate is optional", () => {
  assert.deepEqual(validateDeceased({ gender: "", estate: "" }), { errors: { gender: "required" }, fields: null });
  assert.deepEqual(validateDeceased({ gender: "x", estate: "" }).errors, { gender: "invalid" });
  assert.deepEqual(validateDeceased({ gender: "male", estate: "" }), {
    errors: {},
    fields: { gender: "male", estate: null },
  });
  assert.deepEqual(validateDeceased({ gender: "female", estate: "٥٠٠" }).fields, {
    gender: "female",
    estate: "500",
  });
  assert.deepEqual(validateDeceased({ gender: "", estate: "0" }).errors, {
    gender: "required",
    estate: "not_positive",
  });
});

test("heir: relationship is required, from the 23 ids", () => {
  assert.equal(RELATIONSHIP_IDS.length, 23);
  assert.deepEqual(validateHeir({ relationship: "", name: "" }).errors, { relationship: "required" });
  assert.deepEqual(validateHeir({ relationship: "cousin", name: "" }).errors, { relationship: "invalid" });
  assert.deepEqual(validateHeir({ relationship: "son", name: "x".repeat(101) }).errors, { name: "too_long" });
  assert.deepEqual(validateHeir({ relationship: "son", name: " A " }), {
    errors: {},
    fields: { relationship: "son", name: "A" },
  });
  for (const id of RELATIONSHIP_IDS) assert.deepEqual(validateHeir({ relationship: id, name: "" }).errors, {});
});

test("validateField checks one field of a form (validation on blur)", () => {
  assert.equal(validateField("deceased", "estate", { gender: "", estate: "0" }), "not_positive");
  assert.equal(validateField("deceased", "estate", { gender: "", estate: "" }), null);
  assert.equal(validateField("deceased", "gender", { gender: "", estate: "" }), "required");
  assert.equal(validateField("heir", "relationship", { relationship: "", name: "" }), "required");
  assert.equal(validateField("heir", "name", { relationship: "", name: "x".repeat(101) }), "too_long");
  assert.equal(validateField("heir", "unknown", {}), null);
});

test("the first invalid field follows screen order", () => {
  assert.equal(firstInvalid("deceased", { estate: "invalid", gender: "required" }), "gender");
  assert.equal(firstInvalid("heir", { name: "too_long", relationship: "required" }), "relationship");
  assert.equal(firstInvalid("heir", { heirs: "limit" }), null);
});

test("the 50th heir is the last", () => {
  const heir = { id: "a", relationship: "son", gender: "male", name: null } as const;
  assert.equal(heirLimitReached(Array(49).fill(heir)), false);
  assert.equal(heirLimitReached(Array(50).fill(heir)), true);
});

test("estate formatting is an amount for the language: no currency, percentage or kirat", () => {
  assert.equal(formatEstate("1250000", "en"), "1,250,000");
  assert.equal(formatEstate("1250000.5", "en"), "1,250,000.50");
  assert.equal(formatEstate("999999999999999.99", "en"), "999,999,999,999,999.99");
  for (const locale of locales) {
    const text = formatEstate("1234.5", locale);
    assert.ok(text.length > 0);
    assert.ok(!/[%€$]|kirat|قيراط/.test(text), locale);
  }
  assert.notEqual(formatEstate("1234.5", "en"), formatEstate("1234.5", "fr"));
});

test("an unnamed heir is labelled by relationship", () => {
  const relationships = messages.en.interview.relationships;
  assert.equal(heirLabel({ name: null, relationship: "son_of_son" }, relationships, "{heir} {n}"), "Son's son");
  assert.equal(heirLabel({ name: "Amal", relationship: "daughter" }, relationships, "{heir} {n}"), "Amal");
});

test("every locale names every relationship", () => {
  for (const locale of locales) {
    assert.deepEqual(Object.keys(messages[locale].interview.relationships), [...RELATIONSHIP_IDS], locale);
  }
});

test("every error code the client or server can report has text in every locale", () => {
  const codes: Record<string, string[]> = {
    gender: ["required", "invalid", "has_husband", "has_wife", "has_both_spouses"],
    estate: ["invalid", "not_positive", "too_large", "decimals"],
    relationship: [
      "required",
      "invalid",
      "second_father",
      "second_mother",
      "second_husband",
      "second_grandfather",
      "second_paternal_grandmother",
      "second_maternal_grandmother",
      "fifth_wife",
      "husband_of_male",
      "wife_of_female",
    ],
    name: ["invalid", "too_long"],
    heirs: ["limit"],
    case: ["deceased_required"],
  };
  for (const locale of locales) {
    for (const [field, list] of Object.entries(codes)) {
      for (const code of list) {
        assert.ok(messages[locale].interview.fieldErrors[field]?.[code], `${locale} ${field}.${code}`);
      }
    }
  }
});

test("the form store round-trips a record and removes it", () => {
  const storage = memory();
  const store = formStore(() => storage);
  const record: FormRecord = { caseId: "c1", form: "heir", layer: null, heirId: null, values: { relationship: "son", name: "A" } };
  assert.equal(store.get(), null);
  store.set(record);
  assert.deepEqual(store.get(), record);
  store.set(null);
  assert.equal(store.get(), null);
});

test("garbage in storage reads as no record", () => {
  for (const raw of [
    "not json",
    "null",
    "5",
    "{}",
    '{"caseId":1,"form":"heir","heirId":null,"values":{}}',
    '{"caseId":"c","form":"other","heirId":null,"values":{}}',
    '{"caseId":"c","form":"heir","heirId":5,"values":{}}',
    '{"caseId":"c","form":"heir","heirId":null,"values":{"a":1}}',
    '{"caseId":"c","form":"heir","heirId":null,"values":[]}',
  ]) {
    assert.equal(formStore(() => memory(raw)).get(), null, raw);
  }
});

test("blocked storage never throws", () => {
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  const store = formStore(() => broken);
  assert.equal(store.get(), null);
  store.set({ caseId: "c", form: "deceased", layer: null, heirId: null, values: {} });
  store.set(null);
  const throwing = formStore(() => {
    throw new Error("no storage");
  });
  assert.equal(throwing.get(), null);
  throwing.set(null);
});

test("the default store is sessionStorage, so the record ends with the tab", () => {
  const real = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const local = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const session = memory();
  Object.defineProperty(globalThis, "sessionStorage", { value: session, configurable: true });
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: () => assert.fail("localStorage must not be read"),
      setItem: () => assert.fail("localStorage must not be written"),
      removeItem: () => assert.fail("localStorage must not be written"),
    },
    configurable: true,
  });
  try {
    const store = formStore();
    store.set({ caseId: "c", form: "deceased", layer: null, heirId: null, values: { estate: "5" } });
    assert.ok(session.getItem("mawareeth.form-record"));
    assert.equal(store.get()?.values.estate, "5");
  } finally {
    if (real) Object.defineProperty(globalThis, "sessionStorage", real);
    else delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
    if (local) Object.defineProperty(globalThis, "localStorage", local);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test("a record belongs to one case and one form", () => {
  const record: FormRecord = { caseId: "c1", form: "heir", layer: null, heirId: "h1", values: { relationship: "son" } };
  assert.equal(formFor(record, "c1"), record);
  assert.equal(formFor(record, "c2"), null);
  assert.equal(formFor(null, "c1"), null);
  const fallback = { relationship: "", name: "" };
  assert.deepEqual(valuesFor(record, "c1", "heir", "h1", fallback), { relationship: "son", name: "" });
  assert.deepEqual(valuesFor(record, "c1", "heir", null, fallback), fallback, "another heir");
  assert.deepEqual(valuesFor(record, "c1", "deceased", null, fallback), fallback, "another form");
  assert.deepEqual(valuesFor(record, "c2", "heir", "h1", fallback), fallback, "another case");
});

test("stored answers fill the forms", () => {
  assert.deepEqual(deceasedValues(null), BLANK_DECEASED);
  assert.deepEqual(deceasedValues({ gender: "female", estate: null }), { gender: "female", estate: "" });
  assert.deepEqual(deceasedValues({ gender: "male", estate: "12.5" }), { gender: "male", estate: "12.5" });
  assert.deepEqual(heirValues(undefined), BLANK_HEIR);
  assert.deepEqual(heirValues({ relationship: "wife", name: null }), { relationship: "wife", name: "" });
  assert.deepEqual(heirValues({ relationship: "wife", name: "Huda" }), { relationship: "wife", name: "Huda" });
});

// Review patches

test("names: lone surrogates and bidi controls are refused, joiners are not", () => {
  const lone = `a${String.fromCharCode(0xd800)}b`;
  assert.deepEqual(parseName(lone), { value: null, code: "invalid" });
  for (const code of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069]) {
    assert.deepEqual(parseName(`ab${String.fromCharCode(code)}cd`), { value: null, code: "invalid" }, code.toString(16));
  }
  const zwnj = String.fromCharCode(0x200c);
  const zwj = String.fromCharCode(0x200d);
  const persian = `می${zwnj}خواهم`;
  assert.deepEqual(parseName(persian), { value: persian, code: null });
  assert.deepEqual(parseName(`a${zwj}b`), { value: `a${zwj}b`, code: null });
});

test("a name that shows nothing is left out", () => {
  for (const code of [0x200c, 0x200d, 0xa0, 0x200b, 0xfeff]) {
    assert.deepEqual(parseName(String.fromCharCode(code, 0x20, code)), { value: null, code: null }, code.toString(16));
  }
});

test("fill and templateParts leave special replacement patterns in a name alone", () => {
  for (const name of ["$&", "$'", "$$", "a$`b", "{heir}"]) {
    assert.equal(fill("Remove {heir}?", name), `Remove ${name}?`);
  }
  assert.deepEqual(templateParts("Edit {heir} now"), ["Edit ", " now"]);
  assert.deepEqual(templateParts("no placeholder"), ["no placeholder", ""]);
  assert.equal(
    heirLabel({ name: "$&", relationship: "son" }, messages.en.interview.relationships, "{heir} {n}"),
    "$&",
  );
});

test("unnamed heirs of the same relationship are numbered only when needed, in every locale", () => {
  const heirs = [
    { id: "a", relationship: "son", gender: "male", name: null },
    { id: "b", relationship: "son", gender: "male", name: "Omar" },
    { id: "c", relationship: "son", gender: "male", name: null },
    { id: "d", relationship: "wife", gender: "female", name: null },
  ] as const;
  assert.equal(unnamedOrdinal(heirs, "a"), 1);
  assert.equal(unnamedOrdinal(heirs, "c"), 2);
  assert.equal(unnamedOrdinal(heirs, "b"), null, "a named heir is never numbered");
  assert.equal(unnamedOrdinal(heirs, "d"), null, "alone of its relationship");
  assert.equal(unnamedOrdinal(heirs, "zzz"), null);
  for (const locale of locales) {
    const text = messages[locale].interview;
    const labels = heirLabels(heirs, text.relationships, text.heirNumbered);
    assert.notEqual(labels.a, labels.c, locale);
    assert.ok(labels.a.includes("1") && labels.c.includes("2"), locale);
    assert.ok(labels.a.includes(text.relationships.son), locale);
    assert.equal(labels.b, "Omar");
    assert.equal(labels.d, text.relationships.wife);
  }
  assert.equal(heirLabels(heirs, messages.en.interview.relationships, "{heir} {n}").a, "Son 1");
});

test("estate formatting is exact and uses the language's own decimal separator", () => {
  assert.equal(formatEstate("999999999999999.99", "en"), "999,999,999,999,999.99");
  assert.equal(formatEstate("12.5", "en"), "12.50");
  assert.equal(formatEstate("0.05", "en"), "0.05");
  assert.equal(formatEstate("7", "en"), "7");
  assert.ok(formatEstate("1250.5", "fr").includes(","), "French uses a comma");
  assert.equal(formatEstate("1250.5", "en"), "1,250.50");
});

test("the form store keeps the record in memory when storage is blocked", () => {
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  const store = formStore(() => blocked);
  const record: FormRecord = { caseId: "c", form: "heir", layer: null, heirId: null, values: { name: "typed" } };
  store.set(record);
  assert.deepEqual(store.get(), record, "a rebuilt form still gets what was typed");
  store.set(null);
  assert.equal(store.get(), null);
});

test("the form store keeps a parked draft and rejects a malformed one", () => {
  const storage = memory();
  const store = formStore(() => storage);
  const record: FormRecord = {
    caseId: "c",
    form: "heir", layer: null,
    heirId: "h1",
    values: { relationship: "son" },
    parked: { relationship: "wife", name: "draft" },
  };
  store.set(record);
  assert.deepEqual(store.get(), record);
  storage.setItem("mawareeth.form-record", JSON.stringify({ ...record, parked: { name: 5 } }));
  assert.equal(store.get(), null);
});

test("the shared contract matches the relationship ids, their text and every error code", () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const contract = JSON.parse(readFileSync(join(dir, "..", "..", "..", "api", "contracts", "interview.json"), "utf8")) as {
    relationships: { id: string; gender: string }[];
    errorCodes: Record<string, string[]>;
  };
  assert.deepEqual([...RELATIONSHIP_IDS], contract.relationships.map((item) => item.id));
  assert.equal(contract.relationships.length, 23);
  for (const locale of locales) {
    const text = messages[locale].interview;
    assert.deepEqual(Object.keys(text.relationships), [...RELATIONSHIP_IDS], locale);
    for (const [field, codes] of Object.entries(contract.errorCodes)) {
      for (const code of codes) assert.ok(text.fieldErrors[field]?.[code], `${locale} ${field}.${code}`);
    }
    for (const [field, byCode] of Object.entries(text.fieldErrors)) {
      assert.deepEqual(Object.keys(byCode).sort(), [...(contract.errorCodes[field] ?? [])].sort(), `${locale} ${field}`);
    }
  }
  // Client rules produce only codes the contract lists.
  const produced: [string, string | null][] = [
    ["gender", validateField("deceased", "gender", { gender: "" })],
    ["estate", parseEstate("0").code],
    ["estate", parseEstate("1.234").code],
    ["estate", parseEstate("1".padEnd(16, "0")).code],
    ["estate", parseEstate("x").code],
    ["relationship", validateField("heir", "relationship", { relationship: "x" })],
    ["name", parseName("x".repeat(101)).code],
  ];
  for (const [field, code] of produced) assert.ok(code && contract.errorCodes[field].includes(code), `${field} ${code}`);
});

test("relationshipIssue only reads what the server sent, and only for the add form", () => {
  const kase = { heir_options: { blocked: ["brother" as const], invalid: { father: "second_father" } } };
  assert.equal(relationshipIssue(kase, null, "father"), "second_father");
  // A relative who would inherit nothing is labelled, never flagged.
  assert.equal(relationshipIssue(kase, null, "brother"), null);
  assert.equal(relationshipIssue(kase, null, "son"), null);
  assert.equal(relationshipIssue(kase, null, ""), null);
  assert.equal(relationshipIssue(kase, null, "cousin"), null);
  // An edit is left to the server.
  assert.equal(relationshipIssue(kase, "h1", "father"), null);
  assert.equal(relationshipIssue({ heir_options: { blocked: [], invalid: {} } }, null, "father"), null);
});

test("heirOptionLabels offers every relationship and labels only the blocked ones in the add form", () => {
  const names = messages.en.interview.relationships;
  const template = messages.en.interview.heirRelationshipBlocked;
  const options = { blocked: ["brother" as const, "sister" as const], invalid: { father: "second_father" } };
  const add = heirOptionLabels(options, true, names, template);
  assert.deepEqual(
    add.map((option) => option.id),
    [...RELATIONSHIP_IDS],
  );
  assert.deepEqual(
    add.filter((option) => option.blocked).map((option) => option.id),
    RELATIONSHIP_IDS.filter((id) => id === "brother" || id === "sister"),
  );
  const brother = add.find((option) => option.id === "brother");
  assert.equal(brother?.label, template.replace("{relationship}", names.brother));
  assert.equal(add.find((option) => option.id === "father")?.label, names.father);
  const edit = heirOptionLabels(options, false, names, template);
  assert.ok(edit.every((option) => !option.blocked && option.label === names[option.id]));
  assert.ok(heirOptionLabels({ blocked: [], invalid: {} }, true, names, template).every((option) => !option.blocked));
  for (const locale of Object.values(messages)) {
    assert.ok(locale.interview.heirRelationshipBlocked.includes("{relationship}"));
  }
});

test("the shared fixtures are read as they are, and the kinship codes match the contract", () => {
  const contract = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../api/contracts/interview.json"), "utf8"));
  const fixtures = JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../api/contracts/heir-options-fixtures.json"), "utf8"),
  ) as { families: { name: string; heirs: string[]; heir_options: unknown }[] };
  assert.deepEqual(
    [...KINSHIP_CODES].sort(),
    contract.errorCodes.relationship.filter((code: string) => code !== "required" && code !== "invalid" && code !== "gender_locked").sort(),
  );
  // gender_locked depends on a person's links/death, not family counts, so it is
  // a write error rather than an heir_options kinship code.
  assert.ok(contract.errorCodes.relationship.includes("gender_locked"));
  assert.deepEqual(parseHeirOptions({ blocked: [], invalid: { son: "gender_locked" } }), {
    blocked: [], invalid: {},
  });
  assert.ok(fixtures.families.length >= 10);
  for (const family of fixtures.families) {
    const options = parseHeirOptions(family.heir_options);
    assert.deepEqual(options, family.heir_options, family.name);
    for (const [relationship, code] of Object.entries(options.invalid)) {
      assert.equal(relationshipIssue({ heir_options: options }, null, relationship), code, family.name);
      assert.ok(!options.blocked.includes(relationship as never), family.name);
    }
  }
});

test("a linked heir sends the person and no name; an unchosen link is required; no link adds nothing", () => {
  assert.deepEqual(validateHeir({ relationship: "brother", name: "ignored", same_as: "s2" }), {
    errors: {},
    fields: { relationship: "brother", name: null, same_as: "s2" },
  });
  assert.deepEqual(validateHeir({ relationship: "brother", name: "", same_as: LINK_PENDING }).errors, { same_as: "required" });
  assert.deepEqual(validateHeir({ relationship: "brother", name: "B", same_as: "" }).fields, { relationship: "brother", name: "B" });
  // A name that breaks a rule does not matter once the person is linked.
  assert.deepEqual(validateHeir({ relationship: "brother", name: "x".repeat(101), same_as: "s2" }).errors, {});
});

test("focus goes to the first invalid control in screen order, the picker between relationship and name", () => {
  assert.equal(firstInvalid("heir", { name: "invalid", same_as: "required" }), "same_as");
  assert.equal(firstInvalid("heir", { same_as: "not_alive", relationship: "required" }), "relationship");
  assert.equal(firstInvalid("heir", { heirs: "limit" }), null);
});


test("link choice stays visible without candidates and stale ids require a new choice", async () => {
  const { linkChoice } = await import("./answers.ts");
  for (const same_as of ["gone", LINK_PENDING]) {
    const choice = linkChoice(false, [], { relationship: "mother", name: "Keep", same_as });
    assert.equal(choice.visible, true);
    assert.equal(choice.values.same_as, LINK_PENDING);
  }
  assert.equal(linkChoice(false, [], { relationship: "mother", name: "" }).visible, false);
  assert.equal(linkChoice(true, [{ id: "w" }], { relationship: "mother", name: "", same_as: "w" }).visible, false);
  assert.equal(linkChoice(false, [{ id: "w" }], { relationship: "mother", name: "", same_as: "w" }).values.same_as, "w");
});

test("form records persist layers and old records default to the first layer", () => {
  const record: FormRecord = { caseId: "c1", form: "heir", layer: null, heirId: null, values: { name: "Keep" } };
  const storage = memory(JSON.stringify({ caseId: record.caseId, form: record.form, heirId: record.heirId, values: record.values }));
  assert.equal(formStore(() => storage).get()?.layer, null);
  const store = formStore(() => storage);
  store.set({ ...record, layer: "s1" });
  assert.equal(formStore(() => storage).get()?.layer, "s1");
});


test("numbered labels substitute both placeholders on the original template", () => {
  assert.equal(heirLabel({ name: null, relationship: "son" }, { son: "{n} $&" }, "{heir} {n}", 2), "{n} $& 2");
});

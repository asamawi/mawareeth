import assert from "node:assert/strict";
import { test } from "node:test";

import {
  driftErrors,
  generateModule,
  parsePo,
  requiredKeys,
  validateCatalogs,
  validatePo,
  validateRegistry,
  validateTrees,
  type Catalog,
  type Codes,
  type Registry,
} from "./validate.ts";

const entry = (code: string, direction: "rtl" | "ltr" = "ltr") => ({
  code, direction, babel_locale: code, numbering_system: "latn", own_name: code.toUpperCase(),
  pdf_font_stack: ["Noto Sans"], published: true, review: "pending" as const,
});
const registry = (): Registry => ({
  schema_version: 1, default_locale: "ar", fallback_locale: "en",
  locales: [entry("ar", "rtl"), entry("en"), entry("fr")],
});
const codes: Codes = {
  relationships: ["father", "uncle"], schools: ["hanafi"], basis_kinds: ["compare"], refusal_reasons: ["invalid_family"],
  proof_rules: ["fixed"], proof_conditions: [], blocked_by: [], proof_options: [], school_rules: [], proof_steps: ["base"],
};
const term = (text: string, placeholders: Record<string, string> = {}) => ({ text, review: "pending", placeholders });
function catalogs(): Record<string, Catalog> {
  const make = (locale: string, text: string): Catalog => ({
    schema_version: 1, locale,
    terms: Object.fromEntries(requiredKeys(codes).map((key) => [key, term(`${text} ${key}`)])),
  });
  return { ar: make("ar", "عربي"), en: make("en", "en"), fr: make("fr", "fr") };
}
const check = (c: Record<string, unknown>) => validateCatalogs(c, registry(), codes);

test("a clean registry and catalogs have no errors", () => {
  assert.deepEqual(validateRegistry(registry(), ["ar", "en", "fr"]), []);
  assert.deepEqual(check(catalogs()), []);
});

test("required keys come from the code vocabularies", () => {
  assert.deepEqual(requiredKeys(codes), [
    "basis.compare", "proof.rule.fixed", "proof.step.base", "proof.verse.quran_4_11", "proof.verse.quran_4_12",
    "proof.verse.quran_4_176", "refusal.invalid_family", "relationship.father", "relationship.uncle",
    "school.hanafi", "school.hanafi.description",
  ]);
});

test("a missing catalog key names the file, locale and key", () => {
  const c = catalogs();
  delete c.fr.terms["relationship.uncle"];
  assert.deepEqual(check(c), ["i18n/terms/fr.json: fr: missing key relationship.uncle"]);
});

test("an extra catalog key is an error", () => {
  const c = catalogs();
  c.en.terms["relationship.cousin"] = term("Cousin");
  assert.deepEqual(check(c), ["i18n/terms/en.json: en: extra key relationship.cousin"]);
});

test("an empty or whitespace-only term is an error", () => {
  for (const text of ["", "   "]) {
    const c = catalogs();
    c.en.terms["basis.compare"] = term(text);
    assert.deepEqual(check(c), ["i18n/terms/en.json: en: empty text for key basis.compare"]);
  }
});

test("a placeholder declared differently across locales names both sets", () => {
  const c = catalogs();
  c.en.terms["basis.compare"] = term("Base {base}", { base: "int" });
  c.fr.terms["basis.compare"] = term("Base {base}", { base: "fraction" });
  c.ar.terms["basis.compare"] = term("Base {base}", { base: "int" });
  assert.deepEqual(check(c), ["i18n/terms/fr.json: fr: key basis.compare: placeholders {base:fraction} differ from en {base:int}"]);
});

test("text placeholders must match the declared ones", () => {
  const c = catalogs();
  c.en.terms["basis.compare"] = term("Base {base}");
  assert.match(check(c)[0], /^i18n\/terms\/en\.json: en: key basis\.compare: the \{placeholders\}/);
});

test("Arabic script outside the ar catalog is an error", () => {
  const c = catalogs();
  c.en.terms["basis.compare"] = term("Compare أب");
  assert.deepEqual(check(c), ["i18n/terms/en.json: en: key basis.compare: Arabic script in a non-Arabic catalog"]);
});

test("registry errors name the locale and field", () => {
  const bad = registry();
  bad.locales[1].direction = "up" as "ltr";
  bad.locales[2].pdf_font_stack = [];
  bad.locales.push(entry("fr"));
  delete (bad.locales[0] as Partial<(typeof bad.locales)[0]>).own_name;
  bad.default_locale = "de";
  const errors = validateRegistry(bad, ["ar", "en"]);
  assert.ok(errors.includes("i18n/locales.json: en: field direction must be rtl or ltr"));
  assert.ok(errors.includes("i18n/locales.json: fr: field pdf_font_stack must be a non-empty array of family names"));
  assert.ok(errors.includes("i18n/locales.json: fr: duplicate code"));
  assert.ok(errors.includes("i18n/locales.json: ar: field own_name must be a non-empty string"));
  assert.ok(errors.includes("i18n/locales.json: fr: no catalog file i18n/terms/fr.json"));
  assert.ok(errors.includes("i18n/locales.json: -: field default_locale must be a published locale code"));
});

test("an unpublished fallback is rejected", () => {
  const bad = registry();
  bad.locales[1].published = false;
  assert.ok(validateRegistry(bad, ["ar", "en", "fr"]).includes("i18n/locales.json: -: field fallback_locale must be a published locale code"));
});

test("message trees: parity, empty text and placeholder mismatch", () => {
  const trees = {
    ar: { a: "x {name}", b: "y", c: "z" },
    en: { a: "x {heir}", b: "  ", d: "w" },
    fr: { a: "x {heir}", b: "y", c: "z", d: "w" },
  };
  const errors = validateTrees("web/src/i18n/messages.ts", trees, registry());
  assert.ok(errors.includes("web/src/i18n/messages.ts: ar: key a: placeholders {name} differ from en {heir}"));
  assert.ok(errors.includes("web/src/i18n/messages.ts: en: empty text for key b"));
  assert.ok(errors.includes("web/src/i18n/messages.ts: en: missing key c"));
  assert.ok(errors.includes("web/src/i18n/messages.ts: ar: missing key d"));
  assert.equal(errors.length, 4);
});

const po = (body: string) => `msgid ""\nmsgstr ""\n"Language: x\\n"\n"Plural-Forms: nplurals=2; plural=(n > 1);\\n"\n\n${body}`;

test("parsePo handles headers, multi-line strings, plurals, flags and obsolete entries", () => {
  const file = parsePo(
    po(
      '#, fuzzy\n#: a.py:1\nmsgid "Hello"\nmsgstr "Bonjour"\n\n' +
        'msgid ""\n"Two "\n"lines"\nmsgstr ""\n"Deux "\n"lignes"\n\n' +
        'msgid "%(n)s item"\nmsgid_plural "%(n)s items"\nmsgstr[0] "%(n)s a"\nmsgstr[1] "%(n)s b"\n\n' +
        '#~ msgid "Old"\n#~ msgstr ""\n\n' +
        'msgctxt "menu"\nmsgid "Open"\nmsgstr "Ouvrir"\n',
    ),
  );
  assert.equal(file.header.Language, "x");
  assert.equal(file.entries.length, 4);
  assert.deepEqual(file.entries[0].flags, ["fuzzy"]);
  assert.equal(file.entries[1].msgid, "Two lines");
  assert.equal(file.entries[1].msgstr[0], "Deux lignes");
  assert.deepEqual(file.entries[2].msgstr, ["%(n)s a", "%(n)s b"]);
  assert.equal(file.entries[3].ctxt, "menu");
});

test("po checks: header is metadata, empty and fuzzy entries and placeholder loss are errors", () => {
  const files = {
    ar: po('msgid "A"\nmsgstr "ا"\n\nmsgid "N %(n)s"\nmsgstr "ن"\n'),
    en: po('msgid "A"\nmsgstr "A"\n\nmsgid "N %(n)s"\nmsgstr "N %(n)s"\n'),
    fr: po('#, fuzzy\nmsgid "A"\nmsgstr "A"\n\nmsgid "N %(n)s"\nmsgstr "N {n}"\n\nmsgid "P"\nmsgid_plural "Ps"\nmsgstr[0] "p"\nmsgstr[1] ""\n'),
  };
  const errors = validatePo(files, registry());
  assert.ok(errors.includes('locale/ar/LC_MESSAGES/django.po: ar: msgid "N %(n)s": msgstr lacks placeholders {n} of the msgid'));
  assert.ok(errors.includes('locale/fr/LC_MESSAGES/django.po: fr: fuzzy entry "A"'));
  assert.ok(errors.includes('locale/fr/LC_MESSAGES/django.po: fr: empty msgstr for msgid "P" form 1'));
  assert.ok(errors.includes('locale/ar/LC_MESSAGES/django.po: ar: msgid "P" is missing (present in another locale)'));
  assert.ok(errors.includes('locale/en/LC_MESSAGES/django.po: en: msgid "P" is missing (present in another locale)'));
  assert.ok(!errors.some((e) => e.includes('msgid ""')));
  assert.equal(validatePo({ ar: files.en, en: files.en, fr: files.en }, registry()).length, 0);
});

test("an empty msgstr in a po file names file, locale and msgid", () => {
  const good = po('msgid "Cancel"\nmsgstr "Cancel"\n');
  const errors = validatePo({ ar: po('msgid "Cancel"\nmsgstr ""\n'), en: good, fr: good }, registry());
  assert.deepEqual(errors, ['locale/ar/LC_MESSAGES/django.po: ar: empty msgstr for msgid "Cancel"']);
});

test("the generated module is deterministic and lists the published locales", () => {
  const a = generateModule(registry(), catalogs());
  const b = generateModule(registry(), catalogs());
  assert.equal(a, b);
  assert.ok(a.endsWith("\n") && !a.includes("\r"));
  assert.ok(a.includes('export const locales = ["ar", "en", "fr"] as const;'));
  assert.ok(a.includes('"relationship.uncle": "fr relationship.uncle",'));
  assert.ok(a.startsWith("// Generated by web/scripts/i18n.mjs"));
});

test("a stale, hand-edited or missing generated module is drift; CRLF alone is not", () => {
  const fresh = generateModule(registry(), catalogs());
  const drift = ["web/src/i18n/catalog.generated.ts: -: generated output drift: run npm run i18n:write"];
  assert.deepEqual(driftErrors(fresh, fresh), []);
  assert.deepEqual(driftErrors(fresh.replace(/\n/g, "\r\n"), fresh), []);
  assert.deepEqual(driftErrors(fresh.replace("fr relationship.uncle", "edited"), fresh), drift);
  assert.deepEqual(driftErrors(null, fresh), drift);
});

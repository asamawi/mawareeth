/**
 * Pure checks for the Locale registry, the fiqh term catalogs, the UI message trees and the
 * gettext catalogs, plus the generator of the typed Next.js module. No file or network access:
 * web/scripts/i18n.mjs reads the files and hands the data here.
 *
 * Every error names the file, the Locale and the key or msgid path.
 */

export const REGISTRY_FILE = "i18n/locales.json";
export const MESSAGES_FILE = "web/src/i18n/messages.ts";
export const PUBLIC_PAGES_FILE = "web/src/i18n/public-pages.ts";
export const GENERATED_FILE = "web/src/i18n/catalog.generated.ts";

export const catalogFile = (code: string): string => `i18n/terms/${code}.json`;
export const poFile = (code: string): string => `locale/${code}/LC_MESSAGES/django.po`;

/** The drift error when the committed generated module (null when absent) differs from a fresh generation. */
export function driftErrors(current: string | null, generated: string): string[] {
  const normalized = current === null ? null : current.replace(/\r\n/g, "\n");
  return normalized === generated ? [] : [`${GENERATED_FILE}: -: generated output drift: run npm run i18n:write`];
}

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
const TAG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/;
const DIRECTIONS = ["rtl", "ltr"];
const REVIEW_STATES = ["reviewed", "pending"];
const PARAM_TYPES = ["int", "fraction", "person", "code", "citation"];

export type Codes = Record<string, string[]>;
export type LocaleEntry = {
  code: string;
  direction: "rtl" | "ltr";
  babel_locale: string;
  numbering_system: string;
  default_currency: string;
  own_name: string;
  pdf_font_stack: string[];
  published: boolean;
  review: "reviewed" | "pending";
};
export type Registry = {
  schema_version: 1;
  default_locale: string;
  fallback_locale: string;
  locales: LocaleEntry[];
};
export type Term = { text: string; review: string; placeholders: Record<string, string> };
export type Catalog = { schema_version: 1; locale: string; terms: Record<string, Term> };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sorted = (items: Iterable<string>): string[] => [...items].sort();
const fmt = (items: Iterable<string>): string => `{${sorted(items).join(", ")}}`;
const sameSet = (a: Set<string>, b: Set<string>): boolean => a.size === b.size && [...a].every((item) => b.has(item));

function placeholdersOf(text: string): Set<string> {
  return new Set([...text.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1]));
}

// ---------------------------------------------------------------------------------------------
// Required keys

/** The term keys every catalog must have, derived from the shared code vocabularies. */
export function requiredKeys(codes: Codes): string[] {
  const keys: string[] = ["notice.disclaimer", "comparison.same_in_all_schools"];
  for (const id of codes.relationships) keys.push(`relationship.${id}`);
  for (const id of codes.schools) keys.push(`school.${id}`, `school.${id}.description`);
  for (const id of codes.basis_kinds) keys.push(`basis.${id}`);
  for (const id of codes.refusal_reasons) keys.push(`refusal.${id}`);
  const proof: [string, string][] = [
    ["rule", "proof_rules"],
    ["condition", "proof_conditions"],
    ["blocked_by", "blocked_by"],
    ["school_rule", "school_rules"],
    ["option", "proof_options"],
    ["step", "proof_steps"],
  ];
  for (const [kind, vocabulary] of proof) for (const id of codes[vocabulary]) keys.push(`proof.${kind}.${id}`);
  for (const column of ["base", "awl", "radd", "remainder", "radd_calc", "radd_union", "correction"]) keys.push(`table.column.${column}`);
  for (const verse of ["4:11", "4:12", "4:176"]) keys.push(`proof.verse.quran_${verse.replace(":", "_")}`);
  return sorted(keys);
}

// ---------------------------------------------------------------------------------------------
// Registry

export function validateRegistry(registry: unknown, catalogCodes: string[]): string[] {
  const errors: string[] = [];
  const add = (locale: string, message: string) => errors.push(`${REGISTRY_FILE}: ${locale}: ${message}`);
  if (!isObject(registry)) return [`${REGISTRY_FILE}: -: the registry must be an object`];
  if (registry.schema_version !== 1) add("-", "schema_version must be 1");
  if (!Array.isArray(registry.locales) || registry.locales.length === 0) {
    add("-", "locales must be a non-empty array");
    return errors;
  }
  const seen = new Set<string>();
  const published = new Set<string>();
  for (const [index, raw] of registry.locales.entries()) {
    const entry = isObject(raw) ? raw : {};
    const code = typeof entry.code === "string" && TAG_RE.test(entry.code) ? entry.code : `locales[${index}]`;
    if (code.startsWith("locales[")) add(code, "field code must be a language tag");
    if (seen.has(code)) add(code, "duplicate code");
    seen.add(code);
    if (!DIRECTIONS.includes(entry.direction as string)) add(code, "field direction must be rtl or ltr");
    for (const field of ["babel_locale", "numbering_system", "own_name"]) {
      const value = entry[field];
      if (typeof value !== "string" || value.trim() === "") add(code, `field ${field} must be a non-empty string`);
    }
    if (typeof entry.default_currency !== "string" || !/^[A-Z]{3}$/.test(entry.default_currency)) {
      add(code, "field default_currency must be a currency code");
    }
    const stack = entry.pdf_font_stack;
    if (!Array.isArray(stack) || stack.length === 0 || stack.some((f) => typeof f !== "string" || f.trim() === "")) {
      add(code, "field pdf_font_stack must be a non-empty array of family names");
    }
    if (typeof entry.published !== "boolean") add(code, "field published must be a boolean");
    else if (entry.published) published.add(code);
    if (!REVIEW_STATES.includes(entry.review as string)) add(code, "field review must be reviewed or pending");
    if (!catalogCodes.includes(code)) add(code, `no catalog file ${catalogFile(code)}`);
  }
  for (const field of ["default_locale", "fallback_locale"]) {
    const value = registry[field];
    if (typeof value !== "string" || !published.has(value)) add("-", `field ${field} must be a published locale code`);
  }
  return errors;
}

// ---------------------------------------------------------------------------------------------
// Term catalogs

/** Checks every published Locale's catalog; `catalogs` maps a code to the parsed JSON file. */
export function validateCatalogs(catalogs: Record<string, unknown>, registry: Registry, codes: Codes): string[] {
  const errors: string[] = [];
  const required = requiredKeys(codes);
  const requiredSet = new Set(required);
  const parsed: Record<string, Record<string, Term>> = {};
  for (const { code, published } of registry.locales) {
    if (!published) continue;
    const file = catalogFile(code);
    const add = (message: string) => errors.push(`${file}: ${code}: ${message}`);
    const catalog = catalogs[code];
    if (!isObject(catalog)) {
      add("the catalog must be an object");
      continue;
    }
    if (catalog.schema_version !== 1) add("schema_version must be 1");
    if (catalog.locale !== code) add(`field locale must be ${code}`);
    if (!isObject(catalog.terms)) {
      add("field terms must be an object");
      continue;
    }
    const terms: Record<string, Term> = {};
    for (const [key, raw] of Object.entries(catalog.terms)) {
      if (!KEY_RE.test(key)) {
        add(`key ${key} must be dotted snake_case`);
        continue;
      }
      if (!requiredSet.has(key)) add(`extra key ${key}`);
      if (!isObject(raw) || sorted(Object.keys(raw)).join() !== "placeholders,review,text") {
        add(`key ${key} must have exactly text, review and placeholders`);
        continue;
      }
      const { text, review, placeholders } = raw;
      if (typeof text !== "string" || text.trim() === "") {
        add(`empty text for key ${key}`);
        continue;
      }
      if (!REVIEW_STATES.includes(review as string)) add(`key ${key}: review must be reviewed or pending`);
      if (!isObject(placeholders) || Object.values(placeholders).some((type) => !PARAM_TYPES.includes(type as string))) {
        add(`key ${key}: placeholders must map names to ${PARAM_TYPES.join("|")}`);
        continue;
      }
      if (!sameSet(placeholdersOf(text), new Set(Object.keys(placeholders)))) {
        add(`key ${key}: the {placeholders} in the text ${fmt(placeholdersOf(text))} must equal the declared ${fmt(Object.keys(placeholders))}`);
      }
      if (code !== "ar" && ARABIC_SCRIPT.test(text)) add(`key ${key}: Arabic script in a non-Arabic catalog`);
      terms[key] = { text, review: review as string, placeholders: placeholders as Record<string, string> };
    }
    for (const key of required) if (!(key in terms) && !(key in catalog.terms)) add(`missing key ${key}`);
    parsed[code] = terms;
  }
  const reference = parsed[registry.fallback_locale];
  if (reference) {
    for (const [code, terms] of Object.entries(parsed)) {
      if (code === registry.fallback_locale) continue;
      for (const [key, term] of Object.entries(terms)) {
        const base = reference[key];
        if (!base) continue;
        const mine = Object.entries(term.placeholders).map(([name, type]) => `${name}:${type}`);
        const theirs = Object.entries(base.placeholders).map(([name, type]) => `${name}:${type}`);
        if (!sameSet(new Set(mine), new Set(theirs))) {
          errors.push(`${catalogFile(code)}: ${code}: key ${key}: placeholders ${fmt(mine)} differ from ${registry.fallback_locale} ${fmt(theirs)}`);
        }
      }
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------------------------
// Message trees (messages.ts, public-pages.ts)

/** The string leaves of a tree, by path such as `a.b[2].c`. */
export function flatten(value: unknown, path = ""): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (node: unknown, at: string) => {
    if (typeof node === "string") out.set(at, node);
    else if (Array.isArray(node)) node.forEach((item, index) => walk(item, `${at}[${index}]`));
    else if (isObject(node)) for (const [key, item] of Object.entries(node)) walk(item, at ? `${at}.${key}` : key);
  };
  walk(value, path);
  return out;
}

/** Key parity, non-empty text and placeholder parity of one tree per Locale. */
export function validateTrees(file: string, trees: Record<string, unknown>, registry: Registry): string[] {
  const errors: string[] = [];
  const codes = registry.locales.filter((l) => l.published).map((l) => l.code);
  const flat: Record<string, Map<string, string>> = {};
  for (const code of codes) {
    if (!(code in trees)) {
      errors.push(`${file}: ${code}: no text for this locale`);
      continue;
    }
    flat[code] = flatten(trees[code]);
  }
  const all = new Set<string>();
  for (const map of Object.values(flat)) for (const key of map.keys()) all.add(key);
  const reference = flat[registry.fallback_locale];
  for (const [code, map] of Object.entries(flat)) {
    for (const key of sorted(all)) {
      const text = map.get(key);
      if (text === undefined) {
        errors.push(`${file}: ${code}: missing key ${key}`);
        continue;
      }
      if (text.trim() === "") errors.push(`${file}: ${code}: empty text for key ${key}`);
      const base = reference?.get(key);
      if (base !== undefined && code !== registry.fallback_locale) {
        const mine = placeholdersOf(text);
        const theirs = placeholdersOf(base);
        if (!sameSet(mine, theirs)) {
          errors.push(`${file}: ${code}: key ${key}: placeholders ${fmt(mine)} differ from ${registry.fallback_locale} ${fmt(theirs)}`);
        }
      }
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------------------------
// gettext catalogs

export type PoEntry = { ctxt?: string; msgid: string; msgidPlural?: string; msgstr: string[]; flags: string[] };
export type PoFile = { header: Record<string, string>; entries: PoEntry[] };

function unquote(raw: string): string {
  const body = raw.trim().replace(/^"/, "").replace(/"$/, "");
  return body.replace(/\\(n|t|r|"|\\)/g, (_match, ch: string) => ({ n: "\n", t: "\t", r: "\r", '"': '"', "\\": "\\" })[ch] as string);
}

/** Parses a .po file: multi-line strings, plurals and flags; obsolete `#~` lines are skipped and the header is metadata. */
export function parsePo(text: string): PoFile {
  const entries: PoEntry[] = [];
  let current: PoEntry | null = null;
  let target: { set: (value: string) => void } | null = null;
  let sawMsgstr = false;
  const push = () => {
    if (current && (current.msgid !== "" || current.msgstr.length > 0 || current.ctxt !== undefined)) entries.push(current);
    current = null;
    target = null;
    sawMsgstr = false;
  };
  const start = (): PoEntry => (current ??= { msgid: "", msgstr: [], flags: [] });
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") {
      push();
    } else if (trimmed.startsWith("#~")) {
      continue;
    } else if (trimmed.startsWith("#")) {
      if (sawMsgstr) push();
      if (trimmed.startsWith("#,")) {
        start().flags.push(...trimmed.slice(2).split(",").map((flag) => flag.trim()).filter(Boolean));
      }
    } else if (trimmed.startsWith("msgctxt")) {
      if (sawMsgstr) push();
      const entry = start();
      entry.ctxt = unquote(trimmed.slice(7));
      target = { set: (value) => (entry.ctxt = (entry.ctxt ?? "") + value) };
    } else if (trimmed.startsWith("msgid_plural")) {
      const entry = start();
      entry.msgidPlural = unquote(trimmed.slice(12));
      target = { set: (value) => (entry.msgidPlural = (entry.msgidPlural ?? "") + value) };
    } else if (trimmed.startsWith("msgid")) {
      if (sawMsgstr) push();
      const entry = start();
      entry.msgid = unquote(trimmed.slice(5));
      target = { set: (value) => (entry.msgid += value) };
    } else if (trimmed.startsWith("msgstr")) {
      const entry = start();
      sawMsgstr = true;
      const match = trimmed.match(/^msgstr(?:\[(\d+)\])?\s*(.*)$/);
      const index = match?.[1] === undefined ? 0 : Number(match[1]);
      entry.msgstr[index] = unquote(match?.[2] ?? "");
      target = { set: (value) => (entry.msgstr[index] += value) };
    } else if (trimmed.startsWith('"')) {
      target?.set(unquote(trimmed));
    }
  }
  push();
  const header: Record<string, string> = {};
  const headerIndex = entries.findIndex((entry) => entry.msgid === "" && entry.ctxt === undefined);
  if (headerIndex >= 0) {
    const [head] = entries.splice(headerIndex, 1);
    for (const row of (head.msgstr[0] ?? "").split("\n")) {
      const at = row.indexOf(":");
      if (at > 0) header[row.slice(0, at).trim()] = row.slice(at + 1).trim();
    }
  }
  return { header, entries };
}

function poPlaceholders(text: string): Set<string> {
  const found = new Set<string>();
  for (const match of text.matchAll(/%\(([A-Za-z_][A-Za-z0-9_]*)\)[sdifr]|\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) found.add(match[1] ?? match[2]);
  return found;
}

const idOf = (entry: PoEntry): string => (entry.ctxt === undefined ? entry.msgid : `${entry.ctxt}\u0004${entry.msgid}`);
const shown = (id: string): string => JSON.stringify(id.replace("\u0004", " | "));

/** Empty or fuzzy entries, lost placeholders and msgid parity across the published Locales. */
export function validatePo(files: Record<string, string>, registry: Registry): string[] {
  const errors: string[] = [];
  const keys: Record<string, Set<string>> = {};
  for (const { code, published } of registry.locales) {
    if (!published) continue;
    const file = poFile(code);
    if (!(code in files)) {
      errors.push(`${file}: ${code}: no gettext catalog`);
      continue;
    }
    keys[code] = new Set();
    for (const entry of parsePo(files[code]).entries) {
      const id = idOf(entry);
      keys[code].add(id);
      if (entry.flags.includes("fuzzy")) errors.push(`${file}: ${code}: fuzzy entry ${shown(id)}`);
      const forms = entry.msgstr.length > 0 ? entry.msgstr : [""];
      for (let index = 0; index < forms.length; index++) {
        const msgstr = forms[index] ?? "";
        const where = forms.length > 1 ? `${shown(id)} form ${index}` : shown(id);
        if (msgstr.trim() === "") {
          errors.push(`${file}: ${code}: empty msgstr for msgid ${where}`);
          continue;
        }
        const source = index > 0 && entry.msgidPlural !== undefined ? entry.msgidPlural : entry.msgid;
        const mine = poPlaceholders(msgstr);
        const missing = [...poPlaceholders(source)].filter((name) => !mine.has(name));
        if (missing.length > 0) {
          errors.push(`${file}: ${code}: msgid ${where}: msgstr lacks placeholders ${fmt(missing)} of the msgid`);
        }
      }
    }
  }
  const all = new Set<string>();
  for (const set of Object.values(keys)) for (const id of set) all.add(id);
  for (const [code, set] of Object.entries(keys)) {
    for (const id of sorted(all)) {
      if (!set.has(id)) errors.push(`${poFile(code)}: ${code}: msgid ${shown(id)} is missing (present in another locale)`);
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------------------------
// Generated module

const q = (value: string): string => JSON.stringify(value);

/** The typed Next.js module for the published Locales. Deterministic: sorted keys, LF, trailing newline. */
export function generateModule(registry: Registry, catalogs: Record<string, Catalog>): string {
  const published = registry.locales.filter((entry) => entry.published);
  const codes = published.map((entry) => entry.code);
  const reference = catalogs[registry.fallback_locale];
  const keys = sorted(Object.keys(reference.terms));
  const lines: string[] = [
    "// Generated by web/scripts/i18n.mjs from i18n/locales.json and i18n/terms/*.json. Do not edit.",
    "// Run `npm run i18n:write` to regenerate it.",
    "",
    `export const locales = [${codes.map(q).join(", ")}] as const;`,
    "",
    "export type Locale = (typeof locales)[number];",
    "",
    `export const defaultLocale: Locale = ${q(registry.default_locale)};`,
    "",
    `export const fallbackLocale: Locale = ${q(registry.fallback_locale)};`,
    "",
    "export type LocaleConfig = {",
    '  direction: "rtl" | "ltr";',
    "  ownName: string;",
    "  numberingSystem: string;",
    "  babelLocale: string;",
    "  defaultCurrency: string;",
    "  published: boolean;",
    '  review: "reviewed" | "pending";',
    "};",
    "",
    "export const localeConfig: Record<Locale, LocaleConfig> = {",
  ];
  for (const entry of published) {
    lines.push(
      `  ${q(entry.code)}: {`,
      `    direction: ${q(entry.direction)},`,
      `    ownName: ${q(entry.own_name)},`,
      `    numberingSystem: ${q(entry.numbering_system)},`,
      `    babelLocale: ${q(entry.babel_locale)},`,
      `    defaultCurrency: ${q(entry.default_currency)},`,
      `    published: ${entry.published},`,
      `    review: ${q(entry.review)},`,
      "  },",
    );
  }
  lines.push("};", "", "export type TermKey =");
  for (const key of keys) lines.push(`  | ${q(key)}`);
  lines[lines.length - 1] += ";";
  lines.push("", "export const terms: Record<Locale, Record<TermKey, string>> = {");
  for (const code of codes) {
    lines.push(`  ${q(code)}: {`);
    for (const key of keys) lines.push(`    ${q(key)}: ${q(catalogs[code].terms[key].text)},`);
    lines.push("  },");
  }
  lines.push("};", "", "export const termPlaceholders: Record<TermKey, Record<string, string>> = {");
  for (const key of keys) {
    const entries = Object.entries(reference.terms[key].placeholders).sort(([a], [b]) => (a < b ? -1 : 1));
    lines.push(`  ${q(key)}: {${entries.map(([name, type]) => ` ${q(name)}: ${q(type)}`).join(",")}${entries.length ? " " : ""}},`);
  }
  lines.push("};", "");
  return lines.join("\n");
}

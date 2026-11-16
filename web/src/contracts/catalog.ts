import { CODES } from "./codes.ts";
import { LANG_RE, checkVersion, code, copy, dict, fail, obj, pattern, snake, string } from "./values.ts";

const KEY_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

export type Term = { text: string; review: string; placeholders: Record<string, string> };
export type Catalog = { schema_version: number; locale: string; terms: Record<string, Term> };

export function parseCatalog(data: unknown): Catalog {
  checkVersion(data, "schema_version", "catalog");
  const r = obj(data, "catalog", ["schema_version", "locale", "terms"]);
  const locale = pattern(r.locale, "catalog.locale", LANG_RE, "a locale tag");
  const terms: Record<string, Term> = {};
  for (const [key, value] of Object.entries(dict(r.terms, "catalog.terms"))) {
    const path = `catalog.terms.${key}`;
    pattern(key, path, KEY_RE, "a dotted snake_case key");
    const t = obj(value, path, ["text", "review", "placeholders"]);
    const text = string(t.text, `${path}.text`, true);
    const placeholders: Record<string, string> = {};
    for (const [name, type] of Object.entries(dict(t.placeholders, `${path}.placeholders`))) {
      placeholders[snake(name, `${path}.placeholders`)] = code(type, `${path}.placeholders.${name}`, CODES.param_types);
    }
    const used = new Set([...text.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]));
    const declared = new Set(Object.keys(placeholders));
    if (used.size !== declared.size || [...used].some((n) => !declared.has(n))) {
      fail(path, "the {placeholders} in the text must equal the declared placeholders");
    }
    terms[key] = { text, review: code(t.review, `${path}.review`, CODES.review_states), placeholders };
  }
  return { schema_version: r.schema_version as number, locale, terms };
}

export function dumpCatalog(catalog: Catalog): Catalog {
  return copy(catalog);
}

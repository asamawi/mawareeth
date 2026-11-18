import { CODES } from "./codes.ts";
import {
  CURRENCY_RE, boolean, checkVersion, code, copy, dict, fail, integer, isObject, isoDate, nullable, obj, pattern, snake,
  string,
} from "./values.ts";

export type Citation = { statute_id: string; article: string; checked_on: string } | { gap_school: string };
export type Preset = {
  schema_version: number; id: string; version: string; default_school: string; default_currency: string;
  settings: Record<string, boolean | number | string>; rules: Record<string, boolean | number | string>;
  citations: Record<string, Citation>; reviewed_by: string | null; reviewed_on: string | null;
};

function parseValues(value: unknown, path: string): Record<string, boolean | number | string> {
  const result: Record<string, boolean | number | string> = {};
  for (const [key, item] of Object.entries(dict(value, path))) {
    snake(key, `${path}.${key}`);
    if (typeof item === "boolean") result[key] = boolean(item, `${path}.${key}`);
    else if (typeof item === "number") result[key] = integer(item, `${path}.${key}`);
    else result[key] = snake(item, `${path}.${key}`);
  }
  return result;
}

function parseCitation(value: unknown, path: string): Citation {
  if (!isObject(value)) fail(path, "must be an object");
  const keys = Object.keys(value as object);
  if (keys.length === 1 && keys[0] === "gap_school") {
    return { gap_school: code((value as Record<string, unknown>).gap_school, `${path}.gap_school`, CODES.schools) };
  }
  const r = obj(value, path, ["statute_id", "article", "checked_on"]);
  return {
    statute_id: string(r.statute_id, `${path}.statute_id`, true), article: string(r.article, `${path}.article`, true),
    checked_on: isoDate(r.checked_on, `${path}.checked_on`),
  };
}

export function parsePreset(data: unknown): Preset {
  checkVersion(data, "schema_version", "preset");
  const r = obj(data, "preset", [
    "schema_version", "id", "version", "default_school", "default_currency", "settings", "rules", "citations",
    "reviewed_by", "reviewed_on",
  ]);
  const settings = parseValues(r.settings, "preset.settings");
  const rules = parseValues(r.rules, "preset.rules");
  const citations: Record<string, Citation> = {};
  for (const [key, item] of Object.entries(dict(r.citations, "preset.citations"))) {
    citations[snake(key, "preset.citations")] = parseCitation(item, `preset.citations.${key}`);
  }
  for (const key of Object.keys(rules)) if (!(key in citations)) fail("preset.rules", `rule '${key}' has no citation`);
  const reviewedBy = nullable((v, p) => string(v, p, true), r.reviewed_by, "preset.reviewed_by");
  const reviewedOn = nullable(isoDate, r.reviewed_on, "preset.reviewed_on");
  if ((reviewedBy === null) !== (reviewedOn === null)) fail("preset", "reviewed_by and reviewed_on are both set or both null");
  return {
    schema_version: r.schema_version as number, id: pattern(r.id, "preset.id", /^[a-z]{2}$/, "two lowercase letters"),
    version: isoDate(r.version, "preset.version"), default_school: code(r.default_school, "preset.default_school", CODES.schools),
    default_currency: pattern(r.default_currency, "preset.default_currency", CURRENCY_RE, "a currency code"),
    settings, rules, citations, reviewed_by: reviewedBy, reviewed_on: reviewedOn,
  };
}

export function dumpPreset(preset: Preset): Preset {
  return copy(preset);
}

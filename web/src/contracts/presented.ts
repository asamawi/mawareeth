import { CODES } from "./codes.ts";
import { parseBasis, type Basis } from "./basis.ts";
import {
  CURRENCY_RE, LANG_RE, array, checkVersion, code, copy, fail, fraction, ident, integer, nullable, obj, pattern, snake,
  string, unique, type Fraction,
} from "./values.ts";

const DIRECTIONS = ["ltr", "rtl"] as const;
const STATES = ["answer", "selection_required", "refused"] as const;

export type Segment = { text: string; lang: string; dir: string };
export type Money = { amount_minor: number; currency: string; text: string };
export type Row = {
  person: string; name: { text: string } | null; relationship: { translated: Segment; original: Segment };
  kind: string; share: { fraction: Fraction; text: string }; amount: Money | null;
};
export type PresentedResult = {
  version: number; locale: string; direction: string; basis: Basis; state: string; comparison_outcome: string | null;
  rows: Row[]; rounding: Money | null; unallocated: { fraction: Fraction; text: string } | null;
  refusals: { school: string | null; reason: string; text: string }[]; notices: { code: string; text: string }[];
};

function parseSegment(value: unknown, path: string, arabic = false): Segment {
  const r = obj(value, path, ["text", "lang", "dir"]);
  const lang = pattern(r.lang, `${path}.lang`, LANG_RE, "a language tag");
  const dir = code(r.dir, `${path}.dir`, DIRECTIONS);
  if (arabic && (lang !== "ar" || dir !== "rtl")) fail(path, "the original relationship is Arabic and right-to-left");
  return { text: string(r.text, `${path}.text`, true), lang, dir };
}

function parseMoney(value: unknown, path: string, minimum?: number): Money | null {
  if (value === null) return null;
  const r = obj(value, path, ["amount_minor", "currency", "text"]);
  return {
    amount_minor: integer(r.amount_minor, `${path}.amount_minor`, minimum),
    currency: pattern(r.currency, `${path}.currency`, CURRENCY_RE, "a currency code"),
    text: string(r.text, `${path}.text`, true),
  };
}

export function parsePresentedResult(data: unknown): PresentedResult {
  checkVersion(data, "version", "presented_result");
  const r = obj(data, "presented_result", [
    "version", "locale", "direction", "basis", "state", "comparison_outcome", "rows", "rounding", "unallocated",
    "refusals", "notices",
  ]);
  const locale = pattern(r.locale, "presented_result.locale", LANG_RE, "a locale tag");
  const direction = code(r.direction, "presented_result.direction", DIRECTIONS);
  const basis = parseBasis(r.basis);
  const state = code(r.state, "presented_result.state", STATES);
  const outcome = nullable((v, p) => code(v, p, CODES.comparison_outcomes), r.comparison_outcome, "presented_result.comparison_outcome");
  const rows = array(r.rows, "presented_result.rows").map((item, i): Row => {
    const p = `presented_result.rows[${i}]`;
    const row = obj(item, p, ["person", "name", "relationship", "kind", "share", "amount"]);
    let name: Row["name"] = null;
    if (row.name !== null) name = { text: string(obj(row.name, `${p}.name`, ["text"]).text, `${p}.name.text`) };
    const rel = obj(row.relationship, `${p}.relationship`, ["translated", "original"]);
    const share = obj(row.share, `${p}.share`, ["fraction", "text"]);
    return {
      person: ident(row.person, `${p}.person`), name,
      relationship: {
        translated: parseSegment(rel.translated, `${p}.relationship.translated`),
        original: parseSegment(rel.original, `${p}.relationship.original`, true),
      },
      kind: code(row.kind, `${p}.kind`, CODES.allocation_kinds),
      share: { fraction: fraction(share.fraction, `${p}.share.fraction`), text: string(share.text, `${p}.share.text`, true) },
      amount: parseMoney(row.amount, `${p}.amount`, 0),
    };
  });
  const rounding = parseMoney(r.rounding, "presented_result.rounding");
  let unallocated: PresentedResult["unallocated"] = null;
  if (r.unallocated !== null) {
    const u = obj(r.unallocated, "presented_result.unallocated", ["fraction", "text"]);
    unallocated = {
      fraction: fraction(u.fraction, "presented_result.unallocated.fraction"),
      text: string(u.text, "presented_result.unallocated.text", true),
    };
  }
  const refusals = array(r.refusals, "presented_result.refusals").map((item, i) => {
    const p = `presented_result.refusals[${i}]`;
    const f = obj(item, p, ["school", "reason", "text"]);
    return {
      school: nullable((v, q) => code(v, q, CODES.schools), f.school, `${p}.school`),
      reason: code(f.reason, `${p}.reason`, CODES.refusal_reasons),
      text: string(f.text, `${p}.text`, true),
    };
  });
  const notices = array(r.notices, "presented_result.notices").map((item, i) => {
    const p = `presented_result.notices[${i}]`;
    const n = obj(item, p, ["code", "text"]);
    return { code: snake(n.code, `${p}.code`), text: string(n.text, `${p}.text`, true) };
  });
  unique(rows.map((r) => r.person), "presented_result.rows", "person");
  if (state === "refused") {
    if (rows.length) fail("presented_result.rows", "a refused answer has no rows");
    if (!refusals.length || rounding !== null || unallocated !== null) {
      fail("presented_result", "a refused answer names a refusal and has no rounding or unallocated share");
    }
  }
  if (state === "selection_required" && (outcome !== "difference" || rows.length)) {
    fail("presented_result", "a required selection follows a difference and has no rows");
  }
  return {
    version: r.version as number, locale, direction, basis, state, comparison_outcome: outcome, rows, rounding,
    unallocated, refusals, notices,
  };
}

export function dumpPresentedResult(presented: PresentedResult): PresentedResult {
  return copy(presented);
}

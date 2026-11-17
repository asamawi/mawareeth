import { CODES } from "./codes.ts";
import { parseBasis, type Basis } from "./basis.ts";
import {
  CURRENCY_RE, LANG_RE, array, boolean, checkVersion, code, copy, dict, fail, fraction, ident, integer,
  nullable, obj, pattern, snake, string, unique, type Fraction,
} from "./values.ts";

type Text = { text: string; dir: "ltr" };
type Label = { code: string; text: string };
export type Segment = { text: string; lang: string; dir: string };
export type FractionText = Text & { fraction: Fraction };
export type Money = { amount_minor: number; currency: string; text: string; dir: "auto" };
export type Row = {
  person: string; name: { text: string; dir: "auto" } | null;
  relationship: { translated: Segment; original: Segment }; kind: string; blocked: boolean;
  share: FractionText; percent: Text; kirat: Text; amount: Money | null;
};
type Refusal = { reason: string; text: string };
type School = {
  school: string; label: string; status: string; refusal: Refusal | null;
  shares: { person: string; blocked: boolean; share: FractionText }[];
};
type Evidence = {
  order: number; deceased: string | null; inherited: FractionText | null;
  heirs: {
    person: string; stage: { step: string; base: number } | null; rule: Label;
    condition: Label | null; blocked_by: Label | null; school_rule: Label | null;
    option: Label | null; verses: Label[];
  }[];
  school_rules: Label[];
  steps: { step: string; text: string; params: Record<string, { type: string; value: unknown }> }[];
  unallocated: FractionText | null;
};
export type PresentedResult = {
  version: number; locale: string; direction: string; basis: Basis; state: string; comparison_outcome: string | null;
  school_line: Label | null; rows: Row[]; rounding: Money | null;
  unallocated: (FractionText & { amount: Money | null }) | null;
  comparison: { schools: School[]; differing_persons: string[] } | null;
  evidence: Evidence[]; refusals: (Refusal & { school: string | null })[];
  notices: { code: string; text: string | null }[];
};

type Reader = (value: unknown, path: string) => void;
const text: Reader = (v, p) => {
  const r = obj(v, p, ["text", "dir"]);
  string(r.text, `${p}.text`, true); code(r.dir, `${p}.dir`, ["ltr"]);
};
const fractionText: Reader = (v, p) => {
  const r = obj(v, p, ["fraction", "text", "dir"]);
  fraction(r.fraction, `${p}.fraction`); text({ text: r.text, dir: r.dir }, p);
};
function money(v: unknown, p: string, signed = false): void {
  if (v === null) return;
  const r = obj(v, p, ["amount_minor", "currency", "text", "dir"]);
  integer(r.amount_minor, `${p}.amount_minor`, signed ? undefined : 0);
  pattern(r.currency, `${p}.currency`, CURRENCY_RE, "a currency code");
  string(r.text, `${p}.text`, true); code(r.dir, `${p}.dir`, ["auto"]);
}
function label(v: unknown, p: string, vocabulary: readonly string[]): void {
  const r = obj(v, p, ["code", "text"]);
  code(r.code, `${p}.code`, vocabulary); string(r.text, `${p}.text`, true);
}
function segment(v: unknown, p: string, arabic = false): void {
  const r = obj(v, p, ["text", "lang", "dir"]);
  string(r.text, `${p}.text`, true); pattern(r.lang, `${p}.lang`, LANG_RE, "a language tag");
  code(r.dir, `${p}.dir`, ["ltr", "rtl"]);
  if (arabic && (r.lang !== "ar" || r.dir !== "rtl")) fail(p, "the original relationship is Arabic and right-to-left");
}
function refusal(v: unknown, p: string, school = false): void {
  const r = obj(v, p, school ? ["school", "reason", "text"] : ["reason", "text"]);
  if (school) nullable((v, q) => code(v, q, CODES.schools), r.school, `${p}.school`);
  code(r.reason, `${p}.reason`, CODES.refusal_reasons); string(r.text, `${p}.text`, true);
}
const comparison: Reader = (v, p) => {
  const r = obj(v, p, ["schools", "differing_persons"]);
  const schools = array(r.schools, `${p}.schools`).map((s, i) => {
    const q = `${p}.schools[${i}]`;
    const row = obj(s, q, ["school", "label", "status", "refusal", "shares"]);
    code(row.school, `${q}.school`, CODES.sunni_schools); string(row.label, `${q}.label`, true);
    code(row.status, `${q}.status`, ["calculated", "refused"]);
    const shares = array(row.shares, `${q}.shares`).map((s, j) => {
      const t = `${q}.shares[${j}]`;
      const h = obj(s, t, ["person", "blocked", "share"]);
      ident(h.person, `${t}.person`); boolean(h.blocked, `${t}.blocked`); fractionText(h.share, `${t}.share`);
      return h;
    });
    unique(shares.map((s) => s.person as string), `${q}.shares`, "person");
    if (row.status === "refused") {
      if (row.refusal === null || shares.length) fail(q, "a refused School names its refusal and has no shares");
      refusal(row.refusal, `${q}.refusal`);
    } else if (row.refusal !== null) fail(q, "a calculated School has no refusal");
    return row;
  });
  if (schools.map((s) => s.school).join() !== CODES.sunni_schools.join()) fail(p, "comparison lists the four Sunni Schools in order");
  const differing = array(r.differing_persons, `${p}.differing_persons`).map((s) => ident(s, `${p}.differing_persons`));
  unique(differing, `${p}.differing_persons`, "person");
  const calculated = schools.filter((s) => s.status === "calculated");
  if (!calculated.length || (!differing.length && calculated.length === schools.length)) fail(p, "a comparison needs a difference or a partial refusal");
};
const evidence: Reader = (v, p) => {
  const r = obj(v, p, ["order", "deceased", "inherited", "heirs", "school_rules", "steps", "unallocated"]);
  integer(r.order, `${p}.order`, 1, 3); nullable(ident, r.deceased, `${p}.deceased`);
  nullable(fractionText, r.inherited, `${p}.inherited`); nullable(fractionText, r.unallocated, `${p}.unallocated`);
  const heirs = array(r.heirs, `${p}.heirs`).map((v, i) => {
    const q = `${p}.heirs[${i}]`;
    const h = obj(v, q, ["person", "stage", "rule", "condition", "blocked_by", "school_rule", "option", "verses"]);
    ident(h.person, `${q}.person`);
    if (h.stage !== null) {
      const s = obj(h.stage, `${q}.stage`, ["step", "base"]);
      code(s.step, `${q}.stage.step`, CODES.proof_steps); integer(s.base, `${q}.stage.base`, 1);
    }
    label(h.rule, `${q}.rule`, CODES.proof_rules);
    for (const [key, vocabulary] of [["condition", CODES.proof_conditions], ["blocked_by", CODES.blocked_by],
      ["school_rule", CODES.school_rules], ["option", CODES.proof_options]] as const) {
      nullable((v, p) => label(v, p, vocabulary), h[key], `${q}.${key}`);
    }
    array(h.verses, `${q}.verses`).forEach((v, i) => label(v, `${q}.verses[${i}]`, ["quran_4_11", "quran_4_12", "quran_4_176"]));
    return h;
  });
  unique(heirs.map((h) => h.person as string), `${p}.heirs`, "person");
  array(r.school_rules, `${p}.school_rules`).forEach((v, i) => label(v, `${p}.school_rules[${i}]`, CODES.school_rules));
  array(r.steps, `${p}.steps`).forEach((v, i) => {
    const q = `${p}.steps[${i}]`;
    const s = obj(v, q, ["step", "text", "params"]);
    code(s.step, `${q}.step`, CODES.proof_steps); string(s.text, `${q}.text`, true);
    for (const [name, v] of Object.entries(dict(s.params, `${q}.params`))) {
      snake(name, `${q}.params`);
      const param = obj(v, `${q}.params.${name}`, ["type", "value"]);
      const kind = code(param.type, `${q}.params.${name}.type`, CODES.param_types);
      const reader = kind === "int" ? integer : kind === "fraction" ? fraction : kind === "person" ? ident : snake;
      reader(param.value, `${q}.params.${name}.value`);
    }
  });
};

export function parsePresentedResult(data: unknown): PresentedResult {
  checkVersion(data, "version", "presented_result");
  const p = "presented_result";
  const r = obj(data, p, ["version", "locale", "direction", "basis", "state", "comparison_outcome", "school_line",
    "rows", "rounding", "unallocated", "comparison", "evidence", "refusals", "notices"]);
  pattern(r.locale, `${p}.locale`, LANG_RE, "a locale tag"); code(r.direction, `${p}.direction`, ["ltr", "rtl"]);
  const basis = parseBasis(r.basis);
  const state = code(r.state, `${p}.state`, ["answer", "selection_required", "refused"]);
  const outcome = nullable((v, p) => code(v, p, CODES.comparison_outcomes), r.comparison_outcome, `${p}.comparison_outcome`);
  nullable((v, p) => label(v, p, ["same_in_all_schools", "school"]), r.school_line, `${p}.school_line`);
  const rows = array(r.rows, `${p}.rows`).map((v, i) => {
    const q = `${p}.rows[${i}]`;
    const h = obj(v, q, ["person", "name", "relationship", "kind", "blocked", "share", "percent", "kirat", "amount"]);
    ident(h.person, `${q}.person`);
    if (h.name !== null) {
      const n = obj(h.name, `${q}.name`, ["text", "dir"]);
      string(n.text, `${q}.name.text`); code(n.dir, `${q}.name.dir`, ["auto"]);
    }
    const rel = obj(h.relationship, `${q}.relationship`, ["translated", "original"]);
    segment(rel.translated, `${q}.relationship.translated`); segment(rel.original, `${q}.relationship.original`, true);
    code(h.kind, `${q}.kind`, CODES.allocation_kinds); boolean(h.blocked, `${q}.blocked`);
    fractionText(h.share, `${q}.share`);
    const share = h.share as FractionText;
    if (h.blocked !== (share.fraction.numerator === 0)) fail(q, "blocked means a zero final share");
    text(h.percent, `${q}.percent`); text(h.kirat, `${q}.kirat`); money(h.amount, `${q}.amount`);
    return h;
  });
  unique(rows.map((h) => h.person as string), `${p}.rows`, "person");
  money(r.rounding, `${p}.rounding`, true);
  if (r.rounding !== null && (r.rounding as Money).amount_minor === 0) fail(`${p}.rounding`, "rounding is emitted only when nonzero");
  if (r.unallocated !== null) {
    const u = obj(r.unallocated, `${p}.unallocated`, ["fraction", "text", "dir", "amount"]);
    fractionText({ fraction: u.fraction, text: u.text, dir: u.dir }, `${p}.unallocated`); money(u.amount, `${p}.unallocated.amount`);
  }
  nullable(comparison, r.comparison, `${p}.comparison`);
  const entries = array(r.evidence, `${p}.evidence`);
  entries.forEach((v, i) => evidence(v, `${p}.evidence[${i}]`));
  if (entries.some((v, i) => (v as Evidence).order !== i + 1)) fail(`${p}.evidence`, "estates must be in death order");
  const refusals = array(r.refusals, `${p}.refusals`);
  refusals.forEach((v, i) => refusal(v, `${p}.refusals[${i}]`, true));
  unique(refusals.map((v) => (v as Refusal).reason), `${p}.refusals`, "reason");
  const notices = array(r.notices, `${p}.notices`).map((v, i) => {
    const q = `${p}.notices[${i}]`;
    const n = obj(v, q, ["code", "text"]);
    code(n.code, `${q}.code`, ["disclaimer", "country_notice", "citation", "civil_law", "obligatory_bequest_prompt", "locale_beta"]);
    nullable((v, p) => string(v, p, true), n.text, `${q}.text`); return n;
  });
  unique(notices.map((n) => n.code as string), `${p}.notices`, "notice");
  if (state === "refused") {
    if (rows.length || r.comparison !== null || r.school_line !== null || entries.length) fail(p, "a refused answer has no rows, comparison, school line or evidence");
    if (!refusals.length || r.rounding !== null || r.unallocated !== null) fail(p, "a refused answer names its refusal and has no amounts");
  } else if (state === "selection_required") {
    if (outcome !== "difference" || rows.length || r.comparison === null || entries.length || r.school_line !== null) fail(p, "selection requires a comparison difference and no answer or evidence");
    if (r.rounding !== null || r.unallocated !== null) fail(p, "selection has no amounts");
  } else if (!rows.length || r.school_line === null || r.comparison !== null || refusals.length) fail(p, "an answer has rows and a school line, without comparison or refusals");
  if (basis.kind === "compare") {
    if (outcome !== { answer: "agreement", selection_required: "difference", refused: "all_refused" }[state]) fail(p, "compare state must match its outcome");
    if (state === "answer" && (r.school_line as Label).code !== "same_in_all_schools") fail(p, "agreement uses the shared School line");
  } else if (outcome !== null || state === "selection_required" || (state === "answer" && (r.school_line as Label).code !== "school")) fail(p, "a School or Country answer has no comparison outcome");
  return copy(data as PresentedResult);
}

export function dumpPresentedResult(presented: PresentedResult): PresentedResult {
  return copy(presented);
}

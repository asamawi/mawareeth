import { CODES } from "./codes.ts";
import { parseResult, type Result } from "./result.ts";
import { array, boolean, checkVersion, code, copy, fail, ident, nullable, obj, unique } from "./values.ts";

export type Comparison = {
  version: number; outcome: string; schools: { school: string; result: Result }[]; differing_persons: string[];
  refusals: { school: string; reason: string }[]; selection_required: boolean; selected_school: string | null;
};

export function parseComparison(data: unknown): Comparison {
  checkVersion(data, "version", "comparison");
  const r = obj(data, "comparison", [
    "version", "outcome", "schools", "differing_persons", "refusals", "selection_required", "selected_school",
  ]);
  const outcome = code(r.outcome, "comparison.outcome", CODES.comparison_outcomes);
  const schools = array(r.schools, "comparison.schools").map((item, i) => {
    const p = `comparison.schools[${i}]`;
    const s = obj(item, p, ["school", "result"]);
    const entry = { school: code(s.school, `${p}.school`, CODES.schools), result: parseResult(s.result) };
    if (entry.result.school !== entry.school) fail(p, "the result belongs to a different School");
    return entry;
  });
  if (!schools.length) fail("comparison.schools", "at least one School is compared");
  unique(schools.map((s) => s.school), "comparison.schools", "School");
  const differing = array(r.differing_persons, "comparison.differing_persons")
    .map((x, i) => ident(x, `comparison.differing_persons[${i}]`));
  unique(differing, "comparison.differing_persons", "person");
  const refusals = array(r.refusals, "comparison.refusals").map((item, i) => {
    const p = `comparison.refusals[${i}]`;
    const f = obj(item, p, ["school", "reason"]);
    return { school: code(f.school, `${p}.school`, CODES.schools), reason: code(f.reason, `${p}.reason`, CODES.refusal_reasons) };
  });
  const selectionRequired = boolean(r.selection_required, "comparison.selection_required");
  const selected = nullable((v, p) => code(v, p, CODES.schools), r.selected_school, "comparison.selected_school");

  const refused = schools.filter((s) => s.result.status === "refused");
  const matches = refusals.length === refused.length &&
    refused.every((s) => refusals.some((f) => f.school === s.school && f.reason === s.result.refusal?.reason));
  if (!matches) fail("comparison.refusals", "refusals must list exactly the refused Schools with their reasons");
  const calculated = schools.filter((s) => s.result.status === "calculated").map((s) => s.school);
  if (selected !== null && !calculated.includes(selected)) {
    fail("comparison.selected_school", "the selected School must be a calculated one");
  }
  if ((calculated.length === 0) !== (outcome === "all_refused")) {
    fail("comparison.outcome", "all_refused holds exactly when every School refused");
  }
  if (outcome === "agreement") {
    if (differing.length || refusals.length || selectionRequired) {
      fail("comparison.outcome", "agreement has no differing persons, refusals or selection");
    }
  } else if (outcome === "all_refused") {
    if (differing.length || selectionRequired || selected !== null) {
      fail("comparison.outcome", "all_refused has no differing persons or selection");
    }
  } else {
    if (!differing.length && !(refusals.length && calculated.length)) {
      fail("comparison.outcome", "difference needs a differing person or a partial refusal");
    }
    if (selectionRequired !== (selected === null)) {
      fail("comparison.selection_required", "selection is required exactly when no School is selected");
    }
  }
  return {
    version: r.version as number, outcome, schools, differing_persons: differing, refusals,
    selection_required: selectionRequired, selected_school: selected,
  };
}

export function dumpComparison(comparison: Comparison): Comparison {
  return copy(comparison);
}

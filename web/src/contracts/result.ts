import { CODES } from "./codes.ts";
import {
  array, checkVersion, code, copy, dict, fail, fraction, ident, integer, isWhole, nullable, obj, snake, unique,
  type Fraction,
} from "./values.ts";

const STATUSES = ["calculated", "refused"] as const;

export type Allocation = {
  person: string; kind: string; share: Fraction; stage: { step: string; base: number } | null; rule: string;
  condition: string | null; blocked_by: string | null; school_rule: string | null; option: string | null;
  citations: string[];
};
export type Param = { type: string; value: number | string | Fraction };
export type Step = { step: string; params: Record<string, Param> };
export type Layer = {
  order: number; deceased: string; inherited: Fraction; allocations: Allocation[]; steps: Step[];
  unallocated: Fraction | null;
};
export type Result = {
  version: number; school: string; status: string; refusal: { reason: string } | null; allocations: Allocation[];
  unallocated: Fraction | null; steps: Step[]; layers: Layer[];
};

function parseAllocation(value: unknown, path: string): Allocation {
  const r = obj(value, path, [
    "person", "kind", "share", "stage", "rule", "condition", "blocked_by", "school_rule", "option", "citations",
  ]);
  const share = fraction(r.share, `${path}.share`);
  const kind = code(r.kind, `${path}.kind`, CODES.allocation_kinds);
  if (kind === "blocked" && share.numerator !== 0) fail(path, "a blocked allocation has a zero share");
  if ((kind === "blocked") !== (r.rule === "blocked")) fail(path, "the kind is blocked exactly when the rule is blocked");
  let stage: Allocation["stage"] = null;
  if (r.stage !== null) {
    const s = obj(r.stage, `${path}.stage`, ["step", "base"]);
    stage = { step: code(s.step, `${path}.stage.step`, CODES.proof_steps), base: integer(s.base, `${path}.stage.base`, 1) };
    if (!isWhole(share, stage.base)) fail(path, "share times the stage base must be a whole number");
  }
  const citations = array(r.citations, `${path}.citations`).map((c, i) => snake(c, `${path}.citations[${i}]`));
  unique(citations, `${path}.citations`, "citation");
  const optional = (key: string, vocabulary: readonly string[]) =>
    nullable((v, p) => code(v, p, vocabulary), r[key], `${path}.${key}`);
  return {
    person: ident(r.person, `${path}.person`), kind, share, stage,
    rule: code(r.rule, `${path}.rule`, CODES.proof_rules),
    condition: optional("condition", CODES.proof_conditions),
    blocked_by: optional("blocked_by", CODES.blocked_by),
    school_rule: optional("school_rule", CODES.school_rules),
    option: optional("option", CODES.proof_options),
    citations,
  };
}

function parseParam(value: unknown, path: string): Param {
  const r = obj(value, path, ["type", "value"]);
  const type = code(r.type, `${path}.type`, CODES.param_types);
  let parsed: Param["value"];
  if (type === "int") parsed = integer(r.value, `${path}.value`);
  else if (type === "fraction") parsed = fraction(r.value, `${path}.value`);
  else if (type === "person") parsed = ident(r.value, `${path}.value`);
  else parsed = snake(r.value, `${path}.value`);
  return { type, value: parsed };
}

function parseSteps(value: unknown, path: string): Step[] {
  return array(value, path).map((item, i) => {
    const p = `${path}[${i}]`;
    const r = obj(item, p, ["step", "params"]);
    const params: Record<string, Param> = {};
    for (const [name, param] of Object.entries(dict(r.params, `${p}.params`))) {
      params[snake(name, `${p}.params`)] = parseParam(param, `${p}.params.${name}`);
    }
    return { step: code(r.step, `${p}.step`, CODES.proof_steps), params };
  });
}

/** Exact: the shares are summed as BigInt fractions, never as floats. */
function sumsToOne(allocations: Allocation[], unallocated: Fraction | null): boolean {
  let n = BigInt(0);
  let d = BigInt(1);
  const shares = allocations.map((a) => a.share);
  if (unallocated) shares.push(unallocated);
  for (const s of shares) {
    n = n * BigInt(s.denominator) + BigInt(s.numerator) * d;
    d *= BigInt(s.denominator);
  }
  return n === d;
}

function parseAllocations(value: unknown, path: string): Allocation[] {
  const items = array(value, path).map((a, i) => parseAllocation(a, `${path}[${i}]`));
  unique(items.map((a) => a.person), path, "person");
  return items;
}

export function parseResult(data: unknown): Result {
  checkVersion(data, "version", "result");
  const r = obj(data, "result", ["version", "school", "status", "refusal", "allocations", "unallocated", "steps", "layers"]);
  const school = code(r.school, "result.school", CODES.schools);
  const status = code(r.status, "result.status", STATUSES);
  let refusal: Result["refusal"] = null;
  if (r.refusal !== null) {
    const f = obj(r.refusal, "result.refusal", ["reason"]);
    refusal = { reason: code(f.reason, "result.refusal.reason", CODES.refusal_reasons) };
  }
  const allocations = parseAllocations(r.allocations, "result.allocations");
  const unallocated = nullable(fraction, r.unallocated, "result.unallocated");
  const steps = parseSteps(r.steps, "result.steps");
  const layers = array(r.layers, "result.layers").map((item, i): Layer => {
    const p = `result.layers[${i}]`;
    const l = obj(item, p, ["order", "deceased", "inherited", "allocations", "steps", "unallocated"]);
    return {
      order: integer(l.order, `${p}.order`, 2, 3), deceased: ident(l.deceased, `${p}.deceased`),
      inherited: fraction(l.inherited, `${p}.inherited`), allocations: parseAllocations(l.allocations, `${p}.allocations`),
      steps: parseSteps(l.steps, `${p}.steps`), unallocated: nullable(fraction, l.unallocated, `${p}.unallocated`),
    };
  });
  if (status === "refused") {
    if (refusal === null) fail("result", "a refused result names its reason");
    if (allocations.length || steps.length || layers.length || unallocated !== null) {
      fail("result", "a refused result has no allocations, steps, layers or unallocated share");
    }
  } else {
    if (refusal !== null) fail("result", "a calculated result has no refusal");
    if (!sumsToOne(allocations, unallocated)) {
      fail("result", "allocations plus the unallocated share must add up to exactly 1");
    }
    if (layers.some((l, i) => i > 0 && l.order <= layers[i - 1].order)) {
      fail("result.layers", "layer orders must be unique and ascending");
    }
    layers.forEach((l, i) => {
      if (!sumsToOne(l.allocations, l.unallocated)) {
        fail(`result.layers[${i}]`, "allocations plus the unallocated share must add up to exactly 1");
      }
    });
  }
  return { version: r.version as number, school, status, refusal, allocations, unallocated, steps, layers };
}

export function dumpResult(result: Result): Result {
  return copy(result);
}

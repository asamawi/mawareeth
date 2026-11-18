import { CODES } from "./codes.ts";
import {
  CURRENCY_RE, array, boolean, checkVersion, code, copy, fail, ident, integer, nullable, obj, pattern, snake, string,
  unique, type Json,
} from "./values.ts";

const EDGE_KINDS = ["parent_of", "spouse_of"] as const;

export type Person = {
  id: string; gender: string; name: string | null; relationship: string | null; status: string; death_order: number | null;
};
export type Edge = { kind: string; from: string; to: string };
export type LayerHeir = { person: string; relationship: string };
export type Estate = { order: number; deceased: string; heirs: LayerHeir[] };
export type Answer = { question: string; person: string | null; value: string | boolean };
export type Amount = { branch: string; amount_minor: number };
export type Family = {
  version: number; root: string; persons: Person[]; edges: Edge[]; estates: Estate[]; answers: Answer[];
  gifts: Amount[]; bequests: Amount[];
  estate: { amount_minor: number | null; currency: { code: string; explicit: boolean } | null };
};

function parsePerson(value: unknown, path: string): Person {
  const r = obj(value, path, ["id", "gender", "name", "relationship", "status", "death_order"]);
  const status = code(r.status, `${path}.status`, CODES.person_statuses);
  const order = nullable((v, p) => integer(v, p, 2, 3), r.death_order, `${path}.death_order`);
  if (status === "died_later" && order === null) fail(path, "died_later needs a death_order");
  if (status !== "died_later" && order !== null) fail(path, `${status} must not carry a death_order`);
  return {
    id: ident(r.id, `${path}.id`),
    gender: code(r.gender, `${path}.gender`, CODES.genders),
    name: nullable((v, p) => string(v, p), r.name, `${path}.name`),
    relationship: nullable((v, p) => code(v, p, CODES.relationships), r.relationship, `${path}.relationship`),
    status,
    death_order: order,
  };
}

function parseAmounts(value: unknown, path: string, known: Set<string>): Amount[] {
  return array(value, path).map((item, i) => {
    const p = `${path}[${i}]`;
    const r = obj(item, p, ["branch", "amount_minor"]);
    const branch = ident(r.branch, `${p}.branch`);
    if (!known.has(branch)) fail(p, `branch '${branch}' is not in the family`);
    return { branch, amount_minor: integer(r.amount_minor, `${p}.amount_minor`, 0) };
  });
}

export function parseFamily(data: unknown): Family {
  checkVersion(data, "version", "family");
  const r = obj(data, "family", ["version", "root", "persons", "edges", "estates", "answers", "gifts", "bequests", "estate"]);
  const root = ident(r.root, "family.root");
  const persons = array(r.persons, "family.persons").map((p, i) => parsePerson(p, `family.persons[${i}]`));
  unique(persons.map((p) => p.id), "family.persons", "person id");
  const byId = new Map(persons.map((p) => [p.id, p]));
  if (byId.has(root)) fail("family.persons", "the root is not listed as a person");
  const known = new Set([...byId.keys(), root]);

  const edges = array(r.edges, "family.edges").map((item, i): Edge => {
    const p = `family.edges[${i}]`;
    const e = obj(item, p, ["kind", "from", "to"]);
    const edge = { kind: code(e.kind, `${p}.kind`, EDGE_KINDS), from: ident(e.from, `${p}.from`), to: ident(e.to, `${p}.to`) };
    if (!known.has(edge.from) || !known.has(edge.to)) fail(p, "edge points at an id that is not in the family");
    if (edge.from === edge.to) fail(p, "edge must join two different persons");
    return edge;
  });

  const estates = array(r.estates, "family.estates").map((item, i): Estate => {
    const p = `family.estates[${i}]`;
    const e = obj(item, p, ["order", "deceased", "heirs"]);
    const order = integer(e.order, `${p}.order`, 1, 3);
    const deceased = ident(e.deceased, `${p}.deceased`);
    if (order !== i + 1) fail(p, "estate orders must run 1, 2, 3 without gaps");
    if (order === 1 && deceased !== root) fail(p, "the first estate belongs to the root");
    if (order > 1) {
      const person = byId.get(deceased);
      if (!person || person.status !== "died_later" || person.death_order !== order) {
        fail(p, "a later estate belongs to a person who died later in that order");
      }
    }
    const heirs = array(e.heirs, `${p}.heirs`).map((h, j): LayerHeir => {
      const hp = `${p}.heirs[${j}]`;
      const hr = obj(h, hp, ["person", "relationship"]);
      const person = ident(hr.person, `${hp}.person`);
      const heir = byId.get(person);
      if (!heir) fail(hp, `heir '${person}' is not in the family`);
      if (heir!.status === "died_before_or_with" || (heir!.status === "died_later" && (heir!.death_order as number) <= order)) {
        fail(hp, `heir '${person}' was already dead at this estate`);
      }
      if (person === deceased) fail(hp, "a person cannot inherit from themselves");
      return { person, relationship: code(hr.relationship, `${hp}.relationship`, CODES.relationships) };
    });
    unique(heirs.map((h) => h.person), `${p}.heirs`, "heir");
    return { order, deceased, heirs };
  });
  if (!estates.length) fail("family.estates", "the first estate is required");
  const withEstate = new Set(estates.slice(1).map((e) => e.deceased));
  for (const person of persons) {
    if (person.status === "died_later" && !withEstate.has(person.id)) {
      fail("family.persons", `'${person.id}' died later but has no estate of their own`);
    }
  }

  const first = new Map(estates[0].heirs.map((h) => [h.person, h.relationship]));
  const later = new Set(estates.slice(1).flatMap((e) => e.heirs.map((h) => h.person)));
  for (const person of persons) {
    if (first.has(person.id) && person.relationship !== first.get(person.id)) {
      fail("family.persons", `'${person.id}' relationship differs from the first estate`);
    }
    if (person.relationship === null && (first.has(person.id) || !later.has(person.id))) {
      fail("family.persons", `'${person.id}' has no relationship but is not only a later deceased relative`);
    }
  }

  const answers = array(r.answers, "family.answers").map((item, i): Answer => {
    const p = `family.answers[${i}]`;
    const a = obj(item, p, ["question", "person", "value"]);
    const person = nullable(ident, a.person, `${p}.person`);
    if (person !== null && !known.has(person)) fail(p, `person '${person}' is not in the family`);
    const value = typeof a.value === "boolean" ? a.value : snake(a.value, `${p}.value`);
    return { question: snake(a.question, `${p}.question`), person, value };
  });

  const gifts = parseAmounts(r.gifts, "family.gifts", known);
  const bequests = parseAmounts(r.bequests, "family.bequests", known);

  const est = obj(r.estate, "family.estate", ["amount_minor", "currency"]);
  let currency: { code: string; explicit: boolean } | null = null;
  if (est.currency !== null) {
    const c: Json = obj(est.currency, "family.estate.currency", ["code", "explicit"]);
    currency = {
      code: pattern(c.code, "family.estate.currency.code", CURRENCY_RE, "a currency code"),
      explicit: boolean(c.explicit, "family.estate.currency.explicit"),
    };
  }
  const amount = nullable((v, p) => integer(v, p, 0), est.amount_minor, "family.estate.amount_minor");
  return {
    version: r.version as number, root, persons, edges, estates, answers, gifts, bequests,
    estate: { amount_minor: amount, currency },
  };
}

export function dumpFamily(family: Family): Family {
  return copy(family);
}

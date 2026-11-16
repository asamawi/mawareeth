import { CODES } from "./codes.ts";
import { ContractError } from "./errors.ts";
import { copy, isObject, isoDate, type Json } from "./values.ts";

export type Basis =
  | { kind: "compare" }
  | { kind: "school"; school: string }
  | { kind: "country"; preset_id: string; preset_version: string };

function bad(detail: string): never {
  throw new ContractError("invalid_basis", `basis: ${detail}`);
}

const KEYS: Record<string, string[]> = {
  compare: ["kind"],
  school: ["kind", "school"],
  country: ["kind", "preset_id", "preset_version"],
};

/** Parse only: the resolver, which needs the preset lookup, lives on the server. */
export function parseBasis(data: unknown): Basis {
  if (!isObject(data)) bad("must be an object");
  const record = data as Json;
  const kind = record.kind;
  if (typeof kind !== "string" || !CODES.basis_kinds.includes(kind)) bad("unknown kind");
  const keys = KEYS[kind as string];
  const actual = Object.keys(record);
  if (actual.length !== keys.length || !keys.every((k) => actual.includes(k))) {
    bad(`a ${kind} basis has exactly the keys ${JSON.stringify([...keys].sort())}`);
  }
  if (kind === "compare") return { kind: "compare" };
  if (kind === "school") {
    if (typeof record.school !== "string" || !CODES.schools.includes(record.school)) bad("unknown school");
    return { kind: "school", school: record.school as string };
  }
  if (typeof record.preset_id !== "string" || !/^[a-z]{2}$/.test(record.preset_id)) {
    bad("preset_id must be two lowercase letters");
  }
  try {
    isoDate(record.preset_version, "preset_version");
  } catch {
    bad("preset_version must be a YYYY-MM-DD date");
  }
  return { kind: "country", preset_id: record.preset_id as string, preset_version: record.preset_version as string };
}

export function dumpBasis(basis: Basis): Basis {
  return copy(basis);
}

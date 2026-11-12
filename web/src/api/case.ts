import { fetchSession } from "./session.ts";

/** In display order. The server accepts exactly these. */
export const MADHAB_IDS = ["hanafi", "maliki", "shafii", "hanbali", "jafari"] as const;

export type MadhabId = (typeof MADHAB_IDS)[number];

export function isMadhabId(value: unknown): value is MadhabId {
  return typeof value === "string" && (MADHAB_IDS as readonly string[]).includes(value);
}

/** In display order. The server accepts exactly these, for every school. */
export const RELATIONSHIP_IDS = [
  "father",
  "mother",
  "husband",
  "wife",
  "son",
  "daughter",
  "son_of_son",
  "daughter_of_son",
  "grandfather",
  "paternal_grandmother",
  "maternal_grandmother",
  "brother",
  "sister",
  "paternal_brother",
  "paternal_sister",
  "maternal_brother",
  "maternal_sister",
  "son_of_brother",
  "son_of_paternal_brother",
  "uncle",
  "paternal_uncle",
  "son_of_uncle",
  "son_of_paternal_uncle",
] as const;

export type RelationshipId = (typeof RELATIONSHIP_IDS)[number];

export function isRelationshipId(value: unknown): value is RelationshipId {
  return typeof value === "string" && (RELATIONSHIP_IDS as readonly string[]).includes(value);
}

export type Gender = "male" | "female";

export function isGender(value: unknown): value is Gender {
  return value === "male" || value === "female";
}

/** At most this many heirs per case; the server enforces it too. */
export const MAX_HEIRS = 50;

export type Deceased = {
  gender: Gender;
  /** The whole estate as a decimal string with no currency, or null when left out. */
  estate: string | null;
};

export type Heir = {
  id: string;
  relationship: RelationshipId;
  /** Derived from the relationship by the server. */
  gender: Gender;
  name: string | null;
  /** In a later layer: the id of the person's earliest row. The server resolves `name` from it. */
  same_as?: string;
  /**
   * What adding a relative would meet if this heir were removed — computed server-side without
   * this heir in the family. Used for the blur check in the edit form.
   */
  edit_options: HeirOptions;
};

/** The first death plus up to two later ones; the server enforces it too. */
export const MAX_LATER_DEATHS = 2;

/** One later death: its own layer of heirs. The first deceased is `Case.deceased` and `Case.heirs`. */
export type Death = {
  /** The id of the person's earliest row. */
  heir_id: string;
  /** 2 or 3: the place in the order of death, the first deceased being 1. */
  order: 2 | 3;
  gender: Gender;
  heir_options: HeirOptions;
  heirs: Heir[];
};

/**
 * What adding a relative to the whole family would meet, decided by the server. The client
 * holds no fiqh rules: it only reads this.
 */
export type HeirOptions = {
  /** Relationships that would inherit nothing (hajb): labelled in the add form, never refused. */
  blocked: RelationshipId[];
  /** A relationship to the code of the kinship rule it would break (such as a second father). */
  invalid: Partial<Record<RelationshipId, string>>;
};

/** The kinship codes the server can send in `invalid`; anything else reads as no options. */
export const KINSHIP_CODES: readonly string[] = [
  "second_father",
  "second_mother",
  "second_husband",
  "second_grandfather",
  "second_paternal_grandmother",
  "second_maternal_grandmother",
  "fifth_wife",
  "husband_of_male",
  "wife_of_female",
];

/** A fresh empty value each time, so no caller can change what another reads. */
export const noHeirOptions = (): HeirOptions => ({ blocked: [], invalid: {} });

export type Case = {
  id: string;
  started_at: string;
  /** Null until the visitor continues from the selector. */
  madhab: MadhabId | null;
  deceased: Deceased | null;
  heirs: Heir[];
  /** Nothing labelled and nothing invalid when the server sent none or sent it malformed. */
  heir_options: HeirOptions;
  /** The later deaths in order; empty for a case without any. */
  deaths: Death[];
};

/** A field name to the code of its broken rule. */
export type FieldErrorCodes = Record<string, string>;

export type RelativeQuestion = {
  id: string;
  kind: "relative" | "shared_father";
  person: string;
  options: string[];
  suggested: string;
};
export type RelativeAnswers = { relatives?: Record<string, string>; shared_father?: string };

export function parseQuestions(value: unknown): RelativeQuestion[] | null {
  if (!Array.isArray(value)) return null;
  const result: RelativeQuestion[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "object" || item === null || !hasExactKeys(item, ["id", "kind", "person", "options", "suggested"])) return null;
    const { id, kind, person, options, suggested } = item as Record<string, unknown>;
    if (!isCode(id) || seen.has(id) || !isCode(person) ||
        (kind !== "relative" && kind !== "shared_father") || !Array.isArray(options) ||
        options.length < 2 || (kind === "relative" && !options.includes("none")) || !options.every((v) => kind === "shared_father"
          ? v === "yes" || v === "no" : v === "none" || isRelationshipId(v)) ||
        new Set(options).size !== options.length || typeof suggested !== "string" || !options.includes(suggested)) return null;
    seen.add(id);
    result.push({ id, kind, person, options, suggested });
  }
  return result;
}

export type AnswerResult =
  | { kind: "saved"; case: Case }
  /** The server refused the input; nothing was stored. */
  | { kind: "invalid"; errors: FieldErrorCodes; questions?: RelativeQuestion[] }
  /** There is no live case any more. */
  | { kind: "gone" }
  /** The case this tab meant was replaced; `case` is the live one. */
  | { kind: "replaced"; case: Case }
  /** The heir no longer exists; `case` is the live case. */
  | { kind: "missing"; case: Case }
  | { kind: "throttled" }
  | { kind: "failed" };

export type MadhabResult =
  | { kind: "updated"; case: Case }
  /** There is no live case any more. */
  | { kind: "gone" }
  /** The case this tab meant was replaced; `case` is the live one. */
  | { kind: "replaced"; case: Case }
  | { kind: "throttled" }
  | { kind: "failed" };

export type StartResult =
  | { kind: "started"; case: Case }
  /** A case already exists and the visitor has not chosen to replace it. */
  | { kind: "exists"; case: Case }
  | { kind: "throttled" }
  | { kind: "failed" };

export const CASE_TIMEOUT_MS = 10_000;

const CASE_URL = "/api/v1/case/";

type CaseBody = {
  id: string;
  started_at: string;
  madhab?: unknown;
  deceased?: unknown;
  heirs?: unknown;
  heir_options?: unknown;
  deaths?: unknown;
};

function isCaseBody(value: unknown): value is CaseBody {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as CaseBody).id === "string" &&
    typeof (value as CaseBody).started_at === "string"
  );
}

const STORED_ESTATE = /^(0|[1-9][0-9]{0,14})(\.[0-9]{1,2})?$/;

function parseDeceased(value: unknown): Deceased | null {
  if (typeof value !== "object" || value === null) return null;
  const { gender, estate } = value as { gender?: unknown; estate?: unknown };
  if (!isGender(gender)) return null;
  // An estate that is not a stored amount (which the server writes without leading zeros)
  // reads as none, so it can never reach the display as "NaN".
  return { gender, estate: typeof estate === "string" && STORED_ESTATE.test(estate) ? estate : null };
}

function parseHeirs(value: unknown): Heir[] {
  if (!Array.isArray(value)) return [];
  const heirs: Heir[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const { id, relationship, gender, name, edit_options } = item as Record<string, unknown>;
    if (typeof id !== "string" || !isRelationshipId(relationship) || !isGender(gender)) continue;
    heirs.push({ id, relationship, gender, name: typeof name === "string" ? name : null, edit_options: parseHeirOptions(edit_options) });
  }
  return heirs;
}

const DEATH_KEYS = ["heir_id", "order", "gender", "heir_options", "heirs"];
const ROW_KEYS = ["id", "relationship", "gender", "name", "same_as", "edit_options"];

function onlyKeys(value: object, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

/**
 * Strict: a death, or a row inside it, that is malformed, has unknown keys or points at a row
 * that does not come earlier is dropped, and the rest still parses. Never throws.
 */
function parseDeaths(value: unknown, first: readonly Heir[]): Death[] {
  if (!Array.isArray(value)) return [];
  const deaths: Death[] = [];
  const ids = new Set<string>(first.map((heir) => heir.id));
  // Earliest rows only: the people a death or a link may point at.
  const people = new Set<string>(first.map((heir) => heir.id));
  for (const item of value as unknown[]) {
    if (deaths.length >= MAX_LATER_DEATHS) break;
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    if (!onlyKeys(item, DEATH_KEYS) || !DEATH_KEYS.every((key) => Object.hasOwn(item, key))) continue;
    const { heir_id, order, gender, heir_options, heirs } = item as Record<string, unknown>;
    if (order !== deaths.length + 2 || typeof heir_id !== "string" || !people.has(heir_id)) continue;
    if (deaths.some((death) => death.heir_id === heir_id) || !isGender(gender) || !Array.isArray(heirs)) continue;
    const rows: Heir[] = [];
    const linked = new Set<string>();
    const earliest: string[] = [];
    for (const raw of heirs as unknown[]) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw) || !onlyKeys(raw, ROW_KEYS)) continue;
      const { id, relationship, gender: rowGender, name, same_as, edit_options: rowEditOptions } = raw as Record<string, unknown>;
      if (typeof id !== "string" || ids.has(id) || !isRelationshipId(relationship) || !isGender(rowGender)) continue;
      if (name !== undefined && name !== null && typeof name !== "string") continue;
      const row: Heir = { id, relationship, gender: rowGender, name: typeof name === "string" ? name : null, edit_options: parseHeirOptions(rowEditOptions) };
      if (same_as !== undefined) {
        if (typeof same_as !== "string" || !people.has(same_as) || same_as === heir_id || linked.has(same_as)) continue;
        if (deaths.some((death) => death.heir_id === same_as)) continue;
        linked.add(same_as);
        row.same_as = same_as;
      } else {
        earliest.push(id);
      }
      ids.add(id);
      rows.push(row);
    }
    for (const id of earliest) people.add(id);
    deaths.push({
      heir_id,
      order: order as 2 | 3,
      gender,
      heir_options: parseHeirOptions(heir_options),
      heirs: rows,
    });
  }
  return deaths;
}

/** Strict: anything malformed or unknown reads as no options, so nothing is ever flagged by a guess. */
export function parseHeirOptions(value: unknown): HeirOptions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return noHeirOptions();
  const { blocked, invalid } = value as { blocked?: unknown; invalid?: unknown };
  if (!Array.isArray(blocked) || !blocked.every(isRelationshipId)) return noHeirOptions();
  if (typeof invalid !== "object" || invalid === null || Array.isArray(invalid)) return noHeirOptions();
  const codes: Partial<Record<RelationshipId, string>> = {};
  for (const [relationship, code] of Object.entries(invalid)) {
    if (!isRelationshipId(relationship) || !KINSHIP_CODES.includes(code as string)) return noHeirOptions();
    codes[relationship] = code;
  }
  // A relationship cannot be both labelled and invalid: the server never sends that.
  if (blocked.some((relationship) => relationship in codes)) return noHeirOptions();
  return { blocked: [...new Set(blocked)], invalid: codes };
}

export function parseCase(body: unknown): Case | null {
  const value =
    typeof body === "object" && body !== null ? (body as { case?: unknown }).case : undefined;
  if (value === null) return null;
  if (!isCaseBody(value)) throw new Error("Case endpoint returned an unexpected body");
  // A missing or unknown madhab, deceased or heirs (an older shape) reads as none.
  const heirs = parseHeirs(value.heirs);
  return {
    id: value.id,
    started_at: value.started_at,
    madhab: isMadhabId(value.madhab) ? value.madhab : null,
    deceased: parseDeceased(value.deceased),
    heirs,
    heir_options: parseHeirOptions(value.heir_options),
    deaths: parseDeaths(value.deaths, heirs),
  };
}

export function readCsrfToken(cookie: string = document.cookie): string | undefined {
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "csrftoken") return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/** Rejects when the API cannot be reached, is too slow, or does not answer with a case. */
export async function fetchCase(
  signal: AbortSignal,
  options: { timeoutMs?: number } = {},
): Promise<Case | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, options.timeoutMs ?? CASE_TIMEOUT_MS);
  signal.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(CASE_URL, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Case read failed with status ${response.status}`);
    }
    return parseCase(await response.json());
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export type WriteOptions = { timeoutMs?: number; cookie?: () => string };

/**
 * Makes exactly one write attempt and never throws; `null` means it failed. The session
 * probe issues the CSRF cookie, so it runs first when the browser has none. `handle`
 * turns the response into a result, and may throw to report a failure.
 */
export async function write<T>(
  signal: AbortSignal,
  options: WriteOptions,
  init: { method: string; body?: string; url?: string; headers?: Record<string, string> },
  handle: (response: Response) => Promise<T | null>,
): Promise<T | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, options.timeoutMs ?? CASE_TIMEOUT_MS);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const cookie = options.cookie ?? (() => document.cookie);
  try {
    let token = readCsrfToken(cookie());
    if (!token) {
      await fetchSession(controller.signal);
      token = readCsrfToken(cookie());
    }
    if (!token) return null;

    const response = await fetch(init.url ?? CASE_URL, {
      method: init.method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRFToken": token,
        ...init.headers,
      },
      body: init.body,
      signal: controller.signal,
    });
    return await handle(response);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export async function startCase(
  signal: AbortSignal,
  /** `caseId` is the case the visitor is replacing: the server refuses when another is live. */
  options: WriteOptions & { replace?: boolean; caseId?: string } = {},
): Promise<StartResult> {
  const result = await write<StartResult>(
    signal,
    options,
    { method: "POST", body: JSON.stringify(
        options.replace ? { replace: true, ...(options.caseId ? { case_id: options.caseId } : {}) } : {},
      ),
    },
    async (response) => {
      if (response.status === 429) return { kind: "throttled" };
      if (response.status === 409) {
        const existing = parseCase(await response.json());
        return existing ? { kind: "exists", case: existing } : null;
      }
      if (!response.ok) return null;
      const started = parseCase(await response.json());
      return started ? { kind: "started", case: started } : null;
    },
  );
  return result ?? { kind: "failed" };
}

/** Stores the madhab on the case this tab is showing. One attempt; never throws. */
export async function setMadhab(
  signal: AbortSignal,
  madhab: MadhabId,
  /** Required: it is what lets the server refuse a write from a tab on a replaced case. */
  caseId: string,
  options: WriteOptions = {},
): Promise<MadhabResult> {
  const result = await write<MadhabResult>(
    signal,
    options,
    { method: "PATCH", body: JSON.stringify({ madhab, case_id: caseId }) },
    async (response) => {
      if (response.status === 429) return { kind: "throttled" };
      if (response.status === 404) return { kind: "gone" };
      if (response.status === 409) {
        const live = parseCase(await response.json());
        return live ? { kind: "replaced", case: live } : null;
      }
      if (!response.ok) return null;
      const updated = parseCase(await response.json());
      return updated ? { kind: "updated", case: updated } : null;
    },
  );
  return result ?? { kind: "failed" };
}

function parseErrors(body: unknown): FieldErrorCodes | null {
  const errors =
    typeof body === "object" && body !== null ? (body as { errors?: unknown }).errors : undefined;
  if (typeof errors !== "object" || errors === null || Array.isArray(errors)) return null;
  const codes: FieldErrorCodes = {};
  for (const [field, code] of Object.entries(errors)) {
    if (typeof code === "string") codes[field] = code;
  }
  return Object.keys(codes).length > 0 ? codes : null;
}

/** One write to the interview answers; every one needs the case id it was made for. */
async function answer(
  signal: AbortSignal,
  options: WriteOptions,
  method: string,
  url: string,
  caseId: string,
  /** Null for a write with no body: a DELETE carries the case id in the URL instead. */
  fields: Record<string, unknown> | null,
): Promise<AnswerResult> {
  const result = await write<AnswerResult>(
    signal,
    options,
    { method, url, body: fields ? JSON.stringify({ ...fields, case_id: caseId }) : undefined },
    async (response) => {
      if (response.status === 429) return { kind: "throttled" };
      if (response.status === 400) {
        const body = await response.json();
        const errors = parseErrors(body);
        const raw =
          typeof body === "object" && body !== null && !Array.isArray(body)
            ? (body as { questions?: unknown }).questions
            : undefined;
        // Malformed questions must not hide the error codes: they are just left out.
        const questions = raw === undefined ? undefined : parseQuestions(raw);
        return errors ? { kind: "invalid", errors, ...(questions ? { questions } : {}) } : null;
      }
      if (response.status === 404) {
        const live = parseCase(await response.json());
        return live ? { kind: "missing", case: live } : { kind: "gone" };
      }
      if (response.status === 409) {
        const live = parseCase(await response.json());
        return live ? { kind: "replaced", case: live } : null;
      }
      if (!response.ok) return null;
      const saved = parseCase(await response.json());
      return saved ? { kind: "saved", case: saved } : null;
    },
  );
  return result ?? { kind: "failed" };
}

export type DeceasedFields = { gender: Gender; estate: string | null };
export type HeirFields = {
  relationship: RelationshipId;
  name: string | null;
  /** The death (a person's heir id) whose heirs this row joins; left out for the first deceased. */
  layer?: string;
  /** Joins an earlier person instead of entering a new one. */
  same_as?: string;
};

const DECEASED_URL = "/api/v1/case/deceased/";
const HEIRS_URL = "/api/v1/case/heirs/";
const DEATHS_URL = "/api/v1/case/deaths/";

/** Stores the deceased, replacing the earlier one. One attempt; never throws. */
export function saveDeceased(
  signal: AbortSignal,
  caseId: string,
  fields: DeceasedFields,
  options: WriteOptions = {},
): Promise<AnswerResult> {
  return answer(signal, options, "PUT", DECEASED_URL, caseId, fields);
}

export function addHeir(
  signal: AbortSignal,
  caseId: string,
  fields: HeirFields,
  options: WriteOptions = {},
): Promise<AnswerResult> {
  return answer(signal, options, "POST", HEIRS_URL, caseId, fields);
}

export function updateHeir(
  signal: AbortSignal,
  caseId: string,
  heirId: string,
  fields: HeirFields,
  options: WriteOptions = {},
): Promise<AnswerResult> {
  return answer(signal, options, "PUT", `${HEIRS_URL}${encodeURIComponent(heirId)}/`, caseId, fields);
}

export function removeHeir(
  signal: AbortSignal,
  caseId: string,
  heirId: string,
  options: WriteOptions = {},
): Promise<AnswerResult> {
  // Intermediaries may drop a DELETE body, so the case id is in the query string.
  const url = `${HEIRS_URL}${encodeURIComponent(heirId)}/?case_id=${encodeURIComponent(caseId)}`;
  return answer(signal, options, "DELETE", url, caseId, null);
}

/**
 * Marks a person as also deceased. `first` answers the order question: the heir id of the
 * person who died first, or `simultaneous` / `unknown`, which the server refuses.
 */
export function markDeceased(
  signal: AbortSignal,
  caseId: string,
  heirId: string,
  first?: string,
  options: WriteOptions = {},
  answers: RelativeAnswers = {},
): Promise<AnswerResult> {
  return answer(
    signal,
    options,
    "POST",
    DEATHS_URL,
    caseId,
    { heir_id: heirId, ...(first === undefined ? {} : { first }), ...answers },
  );
}

/** Removes a death with its layer of heirs. */
export function unmarkDeceased(
  signal: AbortSignal,
  caseId: string,
  heirId: string,
  options: WriteOptions = {},
): Promise<AnswerResult> {
  const url = `${DEATHS_URL}${encodeURIComponent(heirId)}/?case_id=${encodeURIComponent(caseId)}`;
  return answer(signal, options, "DELETE", url, caseId, null);
}

/** The reasons the engine refuses a case, which the dictionary has a sentence for. */
export const PREVIEW_REASONS = [
  "school_not_supported",
  "malikiyya_disputed",
  "invalid_family",
  "manasikhat_unsupported",
] as const;

export type PreviewReason = (typeof PREVIEW_REASONS)[number];

export function isPreviewReason(value: unknown): value is PreviewReason {
  return typeof value === "string" && (PREVIEW_REASONS as readonly string[]).includes(value);
}

export type FractionBody = { numerator: number; denominator: number };

export type PreviewShare = FractionBody & {
  heir_id: string;
  /** True when the heir receives nothing. */
  blocked: boolean;
  /** The amount with 2 decimals, or null when the case has no estate. */
  amount: string | null;
};

/** What a preview was made for, with no names; compared with the case on screen. */
export type PreviewBasis = {
  madhab: MadhabId;
  gender: Gender;
  estate: string | null;
  heirs: { id: string; relationship: RelationshipId }[];
  deaths?: {
    heir_id: string;
    order: number;
    heirs: { id: string; relationship: RelationshipId; same_as?: string }[];
  }[];
};

/** A label for each code of a heir's proof, in the language of the request; null where there is no code. */
export type PreviewProofLabels = {
  rule: string;
  condition: string | null;
  blocked_by: string | null;
  verse: string | null;
  school_rule: string | null;
  option: string | null;
};

export type PreviewProofHeir = {
  /** The session id of the heir. */
  heir: string;
  relationship: RelationshipId;
  rule: string;
  condition: string | null;
  blocked_by: string | null;
  /** The prescribed fraction for a fixed share; null for any other rule. */
  fraction: FractionBody | null;
  /** The final share of the whole estate. */
  share: FractionBody;
  verse: string | null;
  school_rule: string | null;
  option: string | null;
  labels: PreviewProofLabels;
};

export type PreviewProofStep = {
  step: string;
  /** A whole number, or a fraction for the unallocated part. */
  value: number | FractionBody;
  label: string;
};

/** Why each heir gets their share: stable codes with labels, version 1. Nothing shows it yet. */
export type PreviewProof = {
  version: 1;
  madhab: MadhabId;
  school_rules: string[];
  /** The label of each of `school_rules`, in the same order. */
  school_rule_labels: string[];
  heirs: PreviewProofHeir[];
  steps: PreviewProofStep[];
};

export type LayeredProof = {
  version: 2; madhab: MadhabId;
  people: { row: string; person: string }[];
  layers: { order: number; deceased: string | null; heir: string | null; estate: FractionBody; proof: PreviewProof }[];
  final: { heir: string; fraction: FractionBody }[];
  base: number;
};
export type LayeredTable = {
  layers: { order: number; heir: string | null; table: PreviewTable; p: number | null; base: number;
    gcd: number | null; old_multiplier: number; new_multiplier: number;
    relation: "tamathul" | "tawafuq" | "tabayun" | "no_share" | null;
    jamia: number; unallocated_cells: number[]; parts: { heir: string; value: number }[]; unallocated: number }[];
  rows: { heir: string }[];
  unallocated: boolean;
};

export const TABLE_COLUMNS = ["base", "awl", "radd", "remainder", "radd_calc", "radd_union", "correction"] as const;
export type TableColumnCode = (typeof TABLE_COLUMNS)[number];

export type PreviewTableColumn = {
  code: TableColumnCode;
  /** The column's total, a positive whole number: the engine's own. */
  total: number;
  /** The caption in the request's language. */
  label: string;
};

/** One cell: `value` is the engine's whole number (null for a blocked heir). `span` is the rows a
 * merged group cell covers, 0 for a row that an earlier cell in the column covers. */
export type PreviewTableCell = { value: number | null; span: number };

export type PreviewTableRow = {
  /** The session id of the heir. */
  heir: string;
  blocked: boolean;
  /** The fixed fraction; null for a residuary or a blocked heir. */
  prescribed: FractionBody | null;
  /** The prescribed cell span; 0 means covered by the group's first row. */
  group_span: number;
  /** One cell per column, in column order. */
  cells: PreviewTableCell[];
};

/** The scholars' table of a single-death case: the legacy columns with totals. The first column is `base`. */
export type PreviewTable = { columns: PreviewTableColumn[]; rows: PreviewTableRow[] };

export type Preview =
  | { status: "not_ready" }
  /** `reason` is any code the server sends; one with no sentence shows the generic text only. */
  | { status: "unavailable"; madhab: MadhabId; reason: string; basis: PreviewBasis }
  | {
      status: "available";
      madhab: MadhabId;
      basis: PreviewBasis;
      shares: PreviewShare[];
      /** The part of the estate no heir takes, for a spouse alone; otherwise null. */
      unallocated: FractionBody | null;
      /** The labelled v1 proof for one death or v2 proof for successive deaths. */
      proof: PreviewProof | LayeredProof | null;
      /** A server table; null only when a successive-death table failed its consistency check. */
      table: PreviewTable | LayeredTable | null;
    };

export type PreviewResult =
  | { kind: "preview"; preview: Preview }
  /** The case this tab meant was replaced (409): no numbers for it. */
  | { kind: "replaced" }
  /** There is no live case any more (404, such as an expired session). */
  | { kind: "gone" }
  | { kind: "throttled" }
  | { kind: "failed" };

/** The preview is a luxury: it gives up sooner than the interview's own requests. */
export const PREVIEW_TIMEOUT_MS = 5_000;

const PREVIEW_URL = "/api/v1/case/preview/";
const PREVIEW_AMOUNT = /^[0-9]{1,17}\.[0-9]{2}$/;

function parseFraction(value: unknown): FractionBody | null {
  if (typeof value !== "object" || value === null) return null;
  const { numerator, denominator } = value as Record<string, unknown>;
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) return null;
  const top = numerator as number;
  const bottom = denominator as number;
  // A share is a part of the estate: never negative, never more than the whole.
  return bottom > 0 && top >= 0 && top <= bottom ? { numerator: top, denominator: bottom } : null;
}

function parseBasis(value: unknown): PreviewBasis | null {
  if (typeof value !== "object" || value === null) return null;
  const { madhab, gender, estate, heirs } = value as Record<string, unknown>;
  if (!isMadhabId(madhab) || !isGender(gender) || !Array.isArray(heirs)) return null;
  if (estate !== null && !(typeof estate === "string" && STORED_ESTATE.test(estate))) return null;
  const list: PreviewBasis["heirs"] = [];
  for (const item of heirs as unknown[]) {
    if (typeof item !== "object" || item === null) return null;
    const { id, relationship } = item as Record<string, unknown>;
    if (typeof id !== "string" || !isRelationshipId(relationship)) return null;
    list.push({ id, relationship });
  }
  const result: PreviewBasis = { madhab, gender, estate, heirs: list };
  if (Object.hasOwn(value, "deaths")) {
    const deaths = (value as Record<string, unknown>).deaths;
    if (!Array.isArray(deaths) || deaths.length === 0 || deaths.length > 2) return null;
    const parsed: NonNullable<PreviewBasis["deaths"]> = [];
    for (const item of deaths as unknown[]) {
      if (typeof item !== "object" || item === null || !hasExactKeys(item, ["heir_id", "order", "heirs"])) return null;
      const { heir_id, order, heirs } = item as Record<string, unknown>;
      if (!isCode(heir_id) || order !== parsed.length + 2 || !Array.isArray(heirs)) return null;
      const rows: NonNullable<PreviewBasis["deaths"]>[number]["heirs"] = [];
      for (const row of heirs as unknown[]) {
        if (typeof row !== "object" || row === null) return null;
        const linked = Object.hasOwn(row, "same_as");
        if (!hasExactKeys(row, linked ? ["id", "relationship", "same_as"] : ["id", "relationship"])) return null;
        const { id, relationship, same_as } = row as Record<string, unknown>;
        if (!isCode(id) || !isRelationshipId(relationship) || (linked && !isCode(same_as))) return null;
        rows.push(linked ? { id, relationship, same_as: same_as as string } : { id, relationship });
      }
      parsed.push({ heir_id, order: order as number, heirs: rows });
    }
    result.deaths = parsed;
  }
  return result;
}

function isCode(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** A code or null, and a label that is a string exactly when the code is. */
function parseCoded(code: unknown, label: unknown): boolean {
  return code === null ? label === null : isCode(code) && typeof label === "string" && label !== "";
}

const PROOF_STEPS = ["base", "awl", "radd", "correction", "unallocated"] as const;
const PROOF_KEYS = ["version", "madhab", "school_rules", "school_rule_labels", "heirs", "steps"];
const PROOF_HEIR_KEYS = [
  "heir", "relationship", "rule", "condition", "blocked_by", "fraction", "share", "verse", "school_rule", "option",
  "labels",
];
const PROOF_STEP_KEYS = ["step", "value", "label"];

/** True when the object has exactly these keys, no more and no fewer. */
function hasExactKeys(value: object, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && keys.every((key) => own.includes(key));
}

function parseProofHeir(item: unknown): PreviewProofHeir | null {
  if (typeof item !== "object" || item === null) return null;
  const value = item as Record<string, unknown>;
  if (!hasExactKeys(value, PROOF_HEIR_KEYS)) return null;
  const { heir, relationship, rule, condition, blocked_by, verse, school_rule, option, labels } = value;
  if (typeof heir !== "string" || !isRelationshipId(relationship) || !isCode(rule)) return null;
  if (typeof labels !== "object" || labels === null) return null;
  const given = labels as Record<string, unknown>;
  if (Object.keys(given).length !== 6 || typeof given.rule !== "string" || given.rule === "") return null;
  const pairs: [unknown, unknown][] = [
    [condition, given.condition],
    [blocked_by, given.blocked_by],
    [verse, given.verse],
    [school_rule, given.school_rule],
    [option, given.option],
  ];
  if (!pairs.every(([code, label]) => parseCoded(code, label))) return null;
  const share = parseFraction(value.share);
  if (!share) return null;
  let fraction: FractionBody | null = null;
  if (value.fraction !== null) {
    fraction = parseFraction(value.fraction);
    if (!fraction) return null;
  }
  return {
    heir,
    relationship,
    rule,
    condition: condition as string | null,
    blocked_by: blocked_by as string | null,
    fraction,
    share,
    verse: verse as string | null,
    school_rule: school_rule as string | null,
    option: option as string | null,
    labels: {
      rule: given.rule,
      condition: given.condition as string | null,
      blocked_by: given.blocked_by as string | null,
      verse: given.verse as string | null,
      school_rule: given.school_rule as string | null,
      option: given.option as string | null,
    },
  };
}

function parseProof(value: unknown, madhab: MadhabId, shares: readonly PreviewShare[]): PreviewProof | null {
  if (typeof value !== "object" || value === null || !hasExactKeys(value, PROOF_KEYS)) return null;
  const { version, school_rules, school_rule_labels, heirs, steps } = value as Record<string, unknown>;
  if (version !== 1 || (value as Record<string, unknown>).madhab !== madhab) return null;
  if (!Array.isArray(school_rules) || !Array.isArray(school_rule_labels) || !Array.isArray(heirs) || !Array.isArray(steps)) {
    return null;
  }
  if (!school_rules.every(isCode) || !school_rule_labels.every(isCode)) return null;
  if (school_rules.length !== school_rule_labels.length) return null;
  // sorted and unique, as the engine lists them
  if (!school_rules.every((code, index) => index === 0 || (school_rules[index - 1] as string) < code)) return null;
  const parsedHeirs: PreviewProofHeir[] = [];
  for (const item of heirs as unknown[]) {
    const parsed = parseProofHeir(item);
    if (!parsed) return null;
    if (parsed.school_rule !== null && !school_rules.includes(parsed.school_rule)) return null;
    parsedHeirs.push(parsed);
  }
  // every share's heir has exactly one entry, with the same fraction
  if (parsedHeirs.length !== shares.length) return null;
  for (const share of shares) {
    const matches = parsedHeirs.filter((heir) => heir.heir === share.heir_id);
    if (matches.length !== 1) return null;
    const mine = matches[0].share;
    if (mine.numerator * share.denominator !== share.numerator * mine.denominator) return null;
  }
  const parsedSteps: PreviewProofStep[] = [];
  for (const item of steps as unknown[]) {
    if (typeof item !== "object" || item === null || !hasExactKeys(item, PROOF_STEP_KEYS)) return null;
    const { step, value: amount, label } = item as Record<string, unknown>;
    if (!isCode(label) || !(PROOF_STEPS as readonly unknown[]).includes(step)) return null;
    if (parsedSteps.some((done) => done.step === step)) return null;
    // the unallocated part is a fraction; every other step is a whole number of parts
    const parsedValue =
      step === "unallocated"
        ? parseFraction(amount)
        : typeof amount === "number" && Number.isSafeInteger(amount) && amount > 0
          ? amount
          : null;
    if (parsedValue === null) return null;
    parsedSteps.push({ step: step as string, value: parsedValue, label });
  }
  if (parsedSteps.length === 0 || parsedSteps[0].step !== "base") return null;
  return {
    version: 1,
    madhab,
    school_rules: school_rules as string[],
    school_rule_labels: school_rule_labels as string[],
    heirs: parsedHeirs,
    steps: parsedSteps,
  };
}

const TABLE_KEYS = ["columns", "rows"];
const TABLE_COLUMN_KEYS = ["code", "total", "label"];
const TABLE_ROW_KEYS = ["heir", "blocked", "prescribed", "group_span", "cells"];
const TABLE_CELL_KEYS = ["value", "span"];

function isWhole(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function parseTable(value: unknown, shares: readonly PreviewShare[], proof: PreviewProof | null): PreviewTable | null {
  if (typeof value !== "object" || value === null || !hasExactKeys(value, TABLE_KEYS)) return null;
  const { columns, rows } = value as Record<string, unknown>;
  if (!Array.isArray(columns) || !Array.isArray(rows) || columns.length === 0) return null;
  const parsedColumns: PreviewTableColumn[] = [];
  for (const item of columns as unknown[]) {
    if (typeof item !== "object" || item === null || !hasExactKeys(item, TABLE_COLUMN_KEYS)) return null;
    const { code, total, label } = item as Record<string, unknown>;
    if (!(TABLE_COLUMNS as readonly unknown[]).includes(code) || !isCode(label)) return null;
    if (!isWhole(total) || total < 1) return null;
    if (parsedColumns.some((done) => done.code === code)) return null;
    parsedColumns.push({ code: code as TableColumnCode, total, label });
  }
  if (parsedColumns[0].code !== "base") return null;
  // legacy order, and at most one of the two shortage columns
  const order = parsedColumns.map((column) => TABLE_COLUMNS.indexOf(column.code));
  if (!order.every((index, position) => position === 0 || order[position - 1] < index)) return null;
  // the combinations the engine can give: awl excludes the shortage columns; the radd calculation
  // and its union come together, and only with radd
  const has = (code: TableColumnCode) => parsedColumns.some((column) => column.code === code);
  if (has("awl") && (has("radd") || has("remainder"))) return null;
  if (has("radd") && has("remainder")) return null;
  if (has("radd_calc") !== has("radd_union") || (has("radd_calc") && !has("radd"))) return null;
  if (rows.length !== shares.length) return null;
  const parsedRows: PreviewTableRow[] = [];
  const seen = new Set<string>();
  for (const item of rows as unknown[]) {
    if (typeof item !== "object" || item === null || !hasExactKeys(item, TABLE_ROW_KEYS)) return null;
    const { heir, blocked, prescribed, group_span, cells } = item as Record<string, unknown>;
    if (!isCode(heir) || typeof blocked !== "boolean" || seen.has(heir)) return null;
    if (!isWhole(group_span) || (blocked && group_span !== 1)) return null;
    const share = shares.find((candidate) => candidate.heir_id === heir);
    if (!share || !proof) return null;
    // blocked means the proof says so; a blocked heir has no share. A heir who is not blocked may still
    // have nothing (a residuary left no remainder): then the share is 0 and every cell is 0.
    if (blocked !== (proof.heirs.find((entry) => entry.heir === heir)?.rule === "blocked")) return null;
    if (blocked && !share.blocked) return null;
    seen.add(heir);
    let fraction: FractionBody | null = null;
    if (prescribed !== null) {
      fraction = parseFraction(prescribed);
      if (!fraction) return null;
    }
    if (!Array.isArray(cells) || cells.length !== parsedColumns.length) return null;
    const parsedCells: PreviewTableCell[] = [];
    for (const cell of cells as unknown[]) {
      if (typeof cell !== "object" || cell === null || !hasExactKeys(cell, TABLE_CELL_KEYS)) return null;
      const { value: amount, span } = cell as Record<string, unknown>;
      if (!isWhole(span) || (amount !== null && !isWhole(amount))) return null;
      // a blocked heir's cells are empty, and nobody else's are
      if ((amount === null) !== blocked) return null;
      parsedCells.push({ value: amount as number | null, span });
    }
    if (!blocked && share.blocked && (share.numerator !== 0 || parsedCells.some((cell) => cell.value !== 0))) return null;
    parsedRows.push({ heir, blocked, prescribed: fraction, group_span, cells: parsedCells });
  }
  // A shared prescribed cell starts with its row count, followed by rows it covers, which share it.
  // Share cells may merge wider than it: akdariyya pools two heirs whose own shares differ.
  for (let start = 0; start < parsedRows.length;) {
    const first = parsedRows[start];
    const span = first.group_span;
    if (span === 0 || span > parsedRows.length - start) return null;
    for (let offset = 1; offset < span; offset++) {
      const row = parsedRows[start + offset];
      if (row.group_span !== 0 || row.blocked) return null;
      if (row.prescribed?.numerator !== first.prescribed?.numerator ||
          row.prescribed?.denominator !== first.prescribed?.denominator) return null;
    }
    start += span;
  }
  // a merged cell covers exactly the next `span - 1` rows, which are not cells of their own
  for (let column = 0; column < parsedColumns.length; column++) {
    for (let row = 0; row < parsedRows.length; row++) {
      const span = parsedRows[row].cells[column].span;
      if (span === 0) return null;
      for (let covered = 1; covered < span; covered++) {
        const next = parsedRows[row + covered]?.cells[column];
        if (!next || next.span !== 0 || next.value !== parsedRows[row].cells[column].value) return null;
      }
      row += span - 1;
    }
  }
  // the last column, read as a fraction of its total, is the share: a merged cell is the sum of its rows
  const last = parsedColumns.length - 1;
  const total = BigInt(parsedColumns[last].total);
  for (let row = 0; row < parsedRows.length; row++) {
    const cell = parsedRows[row].cells[last];
    if (cell.value === null || cell.span === 0) continue;
    let top = BigInt(0);
    let bottom = BigInt(1);
    for (const covered of parsedRows.slice(row, row + cell.span)) {
      const share = shares.find((candidate) => candidate.heir_id === covered.heir);
      if (!share) return null;
      top = top * BigInt(share.denominator) + BigInt(share.numerator) * bottom;
      bottom *= BigInt(share.denominator);
    }
    if (BigInt(cell.value) * bottom !== top * total) return null;
  }
  return { columns: parsedColumns, rows: parsedRows };
}

function exact(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && hasExactKeys(value, keys);
}
function sameFraction(a: FractionBody, b: FractionBody): boolean {
  return BigInt(a.numerator) * BigInt(b.denominator) === BigInt(b.numerator) * BigInt(a.denominator);
}

function gcd(a: bigint, b: bigint): bigint {
  return b === BigInt(0) ? a : gcd(b, a % b);
}

export function parseLayeredProof(value: unknown, basis: PreviewBasis, shares: PreviewShare[]): LayeredProof | null {
  if (!exact(value, ["version", "madhab", "people", "layers", "final", "base"]) || value.version !== 2 || value.madhab !== basis.madhab) return null;
  if (!Array.isArray(value.people) || !Array.isArray(value.layers) || !Array.isArray(value.final) || !isWhole(value.base) || value.base < 1) return null;
  const deaths = basis.deaths;
  if (!deaths || value.layers.length !== deaths.length + 1) return null;
  const identity = new Map<string, string>();
  const expected: { row: string; person: string }[] = [];
  for (const rows of [basis.heirs, ...deaths.map((d) => d.heirs)]) {
    for (const row of rows) {
      if (identity.has(row.id)) return null;
      const link = "same_as" in row && typeof row.same_as === "string" ? row.same_as : undefined;
      const person = link ? identity.get(link) : row.id;
      if (!person) return null;
      identity.set(row.id, person);
      if (person !== row.id) expected.push({ row: row.id, person });
    }
  }
  if (value.people.length !== expected.length || !value.people.every((p) => exact(p, ["row", "person"]) && expected.some((e) => e.row === p.row && e.person === p.person)) || new Set(value.people.map((p) => p.row)).size !== expected.length) return null;
  const layers: LayeredProof["layers"] = [];
  for (const [index, layer] of value.layers.entries()) {
    if (!exact(layer, ["order", "deceased", "heir", "estate", "proof"]) || layer.order !== index + 1) return null;
    const heir = index === 0 ? null : deaths[index - 1].heir_id;
    if (layer.heir !== heir || layer.deceased !== heir) return null;
    const estate = parseFraction(layer.estate);
    if (!estate || !exact(layer.estate, ["numerator", "denominator"])) return null;
    const rows = index === 0 ? basis.heirs : deaths[index - 1].heirs;
    if (!exact(layer.proof, PROOF_KEYS) || !Array.isArray(layer.proof.heirs)) return null;
    const entries = layer.proof.heirs.map(parseProofHeir);
    if (entries.some((e) => !e) || entries.length !== rows.length) return null;
    const localShares: PreviewShare[] = [];
    for (const row of rows) {
      const entry = entries.find((e) => e?.heir === row.id);
      if (!entry || entry.relationship !== row.relationship) return null;
      localShares.push({ heir_id: row.id, ...entry.share, blocked: entry.share.numerator === 0, amount: null });
    }
    const proof = parseProof(layer.proof, basis.madhab, localShares);
    if (!proof) return null;
    if (new Set(rows.map((r) => identity.get(r.id))).size !== rows.length) return null;
    for (const entry of layer.proof.heirs) {
      if (!exact(entry.share, ["numerator", "denominator"]) || (entry.fraction !== null && !exact(entry.fraction, ["numerator", "denominator"]))) return null;
    }
    for (const step of proof.steps) {
      if (typeof step.value === "object" && !exact(step.value, ["numerator", "denominator"])) return null;
    }
    layers.push({ order: index + 1, deceased: heir, heir, estate, proof });
  }
  // Verify the v2 proof even when a table was deliberately suppressed by the server.
  type Ratio = { top: bigint; bottom: bigint };
  const running = new Map<string, Ratio>();
  const dead = new Set<string>();
  for (const layer of layers) {
    const person = layer.heir === null ? null : identity.get(layer.heir);
    if (person === undefined || (person !== null && dead.has(person))) return null;
    const estate = person === null ? { top: BigInt(1), bottom: BigInt(1) } : running.get(person) ?? { top: BigInt(0), bottom: BigInt(1) };
    if (estate.top * BigInt(layer.estate.denominator) !== BigInt(layer.estate.numerator) * estate.bottom) return null;
    if (person !== null) { running.delete(person); dead.add(person); }
    for (const entry of layer.proof.heirs) {
      const id = identity.get(entry.heir)!;
      if (dead.has(id)) return null;
      const previous = running.get(id) ?? { top: BigInt(0), bottom: BigInt(1) };
      const top = estate.top * BigInt(entry.share.numerator);
      const bottom = estate.bottom * BigInt(entry.share.denominator);
      running.set(id, { top: previous.top * bottom + top * previous.bottom, bottom: previous.bottom * bottom });
    }
  }
  if (value.final.length !== shares.length || running.size !== shares.length) return null;
  for (const share of shares) {
    const computed = running.get(share.heir_id);
    if (!computed || computed.top * BigInt(share.denominator) !== BigInt(share.numerator) * computed.bottom) return null;
  }
  const final: LayeredProof["final"] = [];
  for (const entry of value.final) {
    if (!exact(entry, ["heir", "fraction"]) || !isCode(entry.heir) || identity.get(entry.heir) !== entry.heir || final.some((e) => e.heir === entry.heir)) return null;
    const fraction = parseFraction(entry.fraction);
    const share = shares.find((s) => s.heir_id === entry.heir);
    if (!fraction || !exact(entry.fraction, ["numerator", "denominator"]) || !share || !sameFraction(fraction, share) || BigInt(fraction.numerator) * BigInt(value.base) % BigInt(fraction.denominator) !== BigInt(0)) return null;
    final.push({ heir: entry.heir, fraction });
  }
  let base = BigInt(1);
  for (const entry of final) {
    const denominator = BigInt(entry.fraction.denominator) / gcd(BigInt(entry.fraction.numerator), BigInt(entry.fraction.denominator));
    base = base / gcd(base, denominator) * denominator;
  }
  if (base !== BigInt(value.base)) return null;
  return { version: 2, madhab: basis.madhab, people: expected, layers, final, base: value.base };
}

export function parseLayeredTable(value: unknown, proof: LayeredProof, shares: PreviewShare[], remainder: FractionBody | null, basis: PreviewBasis): LayeredTable | null {
  if (!exact(value, ["layers", "rows", "unallocated"]) || !Array.isArray(value.layers) || !Array.isArray(value.rows) || typeof value.unallocated !== "boolean" || value.layers.length !== proof.layers.length) return null;
  const identities = new Map(proof.people.map((p) => [p.row, p.person]));
  const people = [...new Set([...basis.heirs, ...(basis.deaths ?? []).flatMap((d) => d.heirs)].map((r) => identities.get(r.id) ?? r.id))];
  if (value.rows.length !== people.length || !value.rows.every((r, i) => exact(r, ["heir"]) && r.heir === people[i]) || new Set(value.rows.map((r) => r.heir)).size !== people.length) return null;
  const layers: LayeredTable["layers"] = [];
  for (const [index, layer] of value.layers.entries()) {
    if (!exact(layer, ["order", "heir", "table", "p", "base", "gcd", "old_multiplier", "new_multiplier", "relation", "jamia", "parts", "unallocated", "unallocated_cells"])) return null;
    const source = proof.layers[index];
    if (layer.order !== source.order || layer.heir !== source.heir || !Array.isArray(layer.parts)) return null;
    if (![layer.base, layer.old_multiplier, layer.new_multiplier, layer.jamia, layer.unallocated].every(isWhole) || !layer.base || !layer.jamia) return null;
    const table = parseTable(layer.table, source.proof.heirs.map((h) => ({ heir_id: h.heir, ...h.share, blocked: h.share.numerator === 0, amount: null })), source.proof);
    if (!table || layer.base !== table.columns.at(-1)?.total) return null;
    for (const column of table.columns) {
      if (["base", "awl", "correction"].includes(column.code) && source.proof.steps.find((step) => step.step === column.code)?.value !== column.total) return null;
    }
    if (!Array.isArray(layer.unallocated_cells) || layer.unallocated_cells.length !== table.columns.length || !layer.unallocated_cells.every(isWhole)) return null;
    for (const [c, column] of table.columns.entries()) {
      const allocated = table.rows.reduce((sum, row) => row.cells[c].span > 0 ? sum + BigInt(row.cells[c].value ?? 0) : sum, BigInt(0));
      const left = BigInt(column.total) - allocated;
      if (BigInt(layer.unallocated_cells[c]) !== (left > BigInt(0) ? left : BigInt(0))) return null;
    }
    if (index === 0) {
      if (layer.p !== null || layer.gcd !== null || layer.relation !== null || layer.jamia !== layer.base || layer.old_multiplier !== 1 || layer.new_multiplier !== 1) return null;
    } else {
      if (!isWhole(layer.p) || !isWhole(layer.gcd) || layer.gcd < 1 || !["tamathul", "tawafuq", "tabayun", "no_share"].includes(layer.relation as string)) return null;
      const previous = layers[index - 1];
      const person = identities.get(source.heir!) ?? source.heir;
      if (layer.p !== previous.parts.find((p) => p.heir === person)?.value || !sameFraction(source.estate, { numerator: layer.p, denominator: previous.jamia })) return null;
      const g = gcd(BigInt(layer.p), BigInt(layer.base as number));
      if (BigInt(layer.gcd) !== g) return null;
      const relation = layer.p === 0 ? "no_share" : layer.p % (layer.base as number) === 0 ? "tamathul" : g > BigInt(1) ? "tawafuq" : "tabayun";
      if (layer.relation !== relation || BigInt(layer.old_multiplier as number) !== (layer.p === 0 ? BigInt(1) : BigInt(layer.base as number) / g) || BigInt(layer.new_multiplier as number) !== BigInt(layer.p) / g || BigInt(layer.jamia as number) !== BigInt(previous.jamia) * BigInt(layer.old_multiplier as number)) return null;
    }
    if (layer.parts.length !== people.length) return null;
    const parts: { heir: string; value: number }[] = [];
    for (const part of layer.parts) {
      if (!exact(part, ["heir", "value"]) || !isCode(part.heir) || !people.includes(part.heir) || !isWhole(part.value) || parts.some((p) => p.heir === part.heir)) return null;
      parts.push({ heir: part.heir, value: part.value });
    }
    const previous = layers[index - 1];
    const deceased = source.heir === null ? null : identities.get(source.heir) ?? source.heir;
    for (const part of parts) {
      const old = index === 0 || part.heir === deceased ? 0 : previous.parts.find((p) => p.heir === part.heir)!.value;
      const entries = source.proof.heirs.filter((h) => (identities.get(h.heir) ?? h.heir) === part.heir);
      const local = entries[0]?.share ?? { numerator: 0, denominator: 1 };
      const numerator = BigInt(local.numerator) * BigInt(layer.base as number);
      if (numerator % BigInt(local.denominator) !== BigInt(0) || BigInt(part.value) !== BigInt(old) * BigInt(layer.old_multiplier as number) + numerator / BigInt(local.denominator) * BigInt(layer.new_multiplier as number)) return null;
    }
    const localLeft = layer.unallocated_cells.at(-1)!;
    if (BigInt(layer.unallocated as number) !== BigInt(previous?.unallocated ?? 0) * BigInt(layer.old_multiplier as number) + BigInt(localLeft) * BigInt(layer.new_multiplier as number)) return null;
    if (parts.reduce((sum, p) => sum + BigInt(p.value), BigInt(layer.unallocated as number)) !== BigInt(layer.jamia as number)) return null;
    layers.push({ ...layer, table, parts } as LayeredTable["layers"][number]);
  }
  const last = layers.at(-1)!;
  for (const person of people) {
    const share = shares.find((s) => s.heir_id === person) ?? { numerator: 0, denominator: 1 };
    if (!sameFraction({ numerator: last.parts.find((p) => p.heir === person)!.value, denominator: last.jamia }, share)) return null;
  }
  if (!sameFraction({ numerator: last.unallocated, denominator: last.jamia }, remainder ?? { numerator: 0, denominator: 1 }) || value.unallocated !== layers.some((l) => l.unallocated > 0)) return null;
  return { layers, rows: value.rows as { heir: string }[], unallocated: value.unallocated };
}

/** Strict: anything that is not exactly the documented shape is rejected, never repaired. */
export function parsePreview(body: unknown): Preview | null {
  if (typeof body !== "object" || body === null) return null;
  const value = body as Record<string, unknown>;
  if (value.status === "not_ready") return { status: "not_ready" };
  if (!isMadhabId(value.madhab)) return null;
  const basis = parseBasis(value.basis);
  if (!basis || (basis.deaths && basis.madhab !== value.madhab)) return null;
  if (value.status === "unavailable") {
    return typeof value.reason === "string" && value.reason !== ""
      ? { status: "unavailable", madhab: value.madhab, reason: value.reason, basis }
      : null;
  }
  if (value.status !== "available" || !Array.isArray(value.shares)) return null;
  const rowIds = new Set([...basis.heirs, ...(basis.deaths ?? []).flatMap((death) => death.heirs)].map((row) => row.id));
  const seen = new Set<string>();
  const shares: PreviewShare[] = [];
  for (const item of value.shares as unknown[]) {
    const fraction = parseFraction(item);
    if (!fraction) return null;
    const { heir_id, blocked, amount } = item as Record<string, unknown>;
    if (typeof heir_id !== "string" || typeof blocked !== "boolean") return null;
    if (amount !== null && !(typeof amount === "string" && PREVIEW_AMOUNT.test(amount))) return null;
    if (!rowIds.has(heir_id) || seen.has(heir_id)) return null;
    seen.add(heir_id);
    shares.push({ ...fraction, heir_id, blocked, amount });
  }
  let unallocated: FractionBody | null = null;
  if (value.unallocated !== null) {
    unallocated = parseFraction(value.unallocated);
    if (!unallocated) return null;
  }
  const proof = basis.deaths ? parseLayeredProof(value.proof, basis, shares) : parseProof(value.proof, value.madhab, shares);
  if (!proof) return null;
  const table = proof.version === 2
    ? value.table === null ? null : parseLayeredTable(value.table, proof, shares, unallocated, basis)
    : parseTable(value.table, shares, proof);
  if (table === null && !(basis.deaths && value.table === null)) return null;
  if (basis.deaths) {
    let top = BigInt(0), bottom = BigInt(1);
    for (const fraction of [...shares, unallocated ?? { numerator: 0, denominator: 1 }]) {
      top = top * BigInt(fraction.denominator) + BigInt(fraction.numerator) * bottom;
      bottom *= BigInt(fraction.denominator);
    }
    if (top !== bottom) return null;
  }
  return { status: "available", madhab: value.madhab, basis, shares, unallocated, proof, table };
}

/**
 * Asks for the shares of the saved case. One attempt, and it never throws: a hung, failed or
 * malformed answer is `failed`. A read, so it needs no token and does not touch the session.
 */
export async function fetchPreview(
  signal: AbortSignal,
  caseId: string,
  options: { timeoutMs?: number; locale?: string } = {},
): Promise<PreviewResult> {
  const controller = new AbortController();
  // the server labels the proof and the table in the language it is asked for: the page's, not the browser's
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.locale) headers["Accept-Language"] = options.locale;
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, options.timeoutMs ?? PREVIEW_TIMEOUT_MS);
  signal.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(`${PREVIEW_URL}?case_id=${encodeURIComponent(caseId)}`, {
      credentials: "same-origin",
      headers,
      signal: controller.signal,
    });
    if (response.status === 429) return { kind: "throttled" };
    if (response.status === 404) return { kind: "gone" };
    if (response.status === 409) return { kind: "replaced" };
    if (!response.ok) return { kind: "failed" };
    const preview = parsePreview(await response.json());
    return preview ? { kind: "preview", preview } : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export type DraftReportResult =
  | { kind: "download"; blob: Blob }
  | { kind: "gone" | "replaced" | "unavailable" | "throttled" | "failed" | "timeout" };

/** One bounded, ephemeral server PDF request. Failure leaves the preview untouched. */
export async function downloadDraftReport(
  caseId: string,
  locale: string,
  options: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<DraftReportResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, options.timeoutMs ?? 30_000);
  try {
    if (controller.signal.aborted) return { kind: "failed" };
    const response = await fetch(`/api/v1/reports/draft/?case_id=${encodeURIComponent(caseId)}`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/pdf", "Accept-Language": locale },
      signal: controller.signal,
    });
    if (response.status === 404) return { kind: "gone" };
    if (response.status === 429) return { kind: "throttled" };
    if (response.status === 503) return { kind: "failed" };
    if (response.status === 409) {
      const body: unknown = await response.json();
      return { kind: typeof body === "object" && body !== null && "status" in body && (body.status === "not_ready" || body.status === "unavailable") ? "unavailable" : "replaced" };
    }
    if (!response.ok || response.headers.get("Content-Type")?.split(";")[0].trim() !== "application/pdf") return { kind: "failed" };
    const blob = await response.blob();
    return blob.size && !controller.signal.aborted ? { kind: "download", blob } : { kind: "failed" };
  } catch {
    return { kind: timedOut ? "timeout" : "failed" };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}

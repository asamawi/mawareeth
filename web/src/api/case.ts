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
};

/** A field name to the code of its broken rule. */
export type FieldErrorCodes = Record<string, string>;

export type AnswerResult =
  | { kind: "saved"; case: Case }
  /** The server refused the input; nothing was stored. */
  | { kind: "invalid"; errors: FieldErrorCodes }
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
    const { id, relationship, gender, name } = item as Record<string, unknown>;
    if (typeof id !== "string" || !isRelationshipId(relationship) || !isGender(gender)) continue;
    heirs.push({ id, relationship, gender, name: typeof name === "string" ? name : null });
  }
  return heirs;
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

function parseCase(body: unknown): Case | null {
  const value =
    typeof body === "object" && body !== null ? (body as { case?: unknown }).case : undefined;
  if (value === null) return null;
  if (!isCaseBody(value)) throw new Error("Case endpoint returned an unexpected body");
  // A missing or unknown madhab, deceased or heirs (an older shape) reads as none.
  return {
    id: value.id,
    started_at: value.started_at,
    madhab: isMadhabId(value.madhab) ? value.madhab : null,
    deceased: parseDeceased(value.deceased),
    heirs: parseHeirs(value.heirs),
    heir_options: parseHeirOptions(value.heir_options),
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

type WriteOptions = { timeoutMs?: number; cookie?: () => string };

/**
 * Makes exactly one write attempt and never throws; `null` means it failed. The session
 * probe issues the CSRF cookie, so it runs first when the browser has none. `handle`
 * turns the response into a result, and may throw to report a failure.
 */
async function write<T>(
  signal: AbortSignal,
  options: WriteOptions,
  init: { method: string; body?: string; url?: string },
  handle: (response: Response) => Promise<T | null>,
): Promise<T | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, options.timeoutMs ?? CASE_TIMEOUT_MS);
  signal.addEventListener("abort", abort, { once: true });
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
        const errors = parseErrors(await response.json());
        return errors ? { kind: "invalid", errors } : null;
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
export type HeirFields = { relationship: RelationshipId; name: string | null };

const DECEASED_URL = "/api/v1/case/deceased/";
const HEIRS_URL = "/api/v1/case/heirs/";

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

/** The reasons the engine refuses a case, which the dictionary has a sentence for. */
export const PREVIEW_REASONS = [
  "school_not_supported",
  "malikiyya_disputed",
  "radd_disputed",
  "invalid_family",
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
      proof: PreviewProof;
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
  return { madhab, gender, estate, heirs: list };
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

/** Strict: anything that is not exactly the documented shape is rejected, never repaired. */
export function parsePreview(body: unknown): Preview | null {
  if (typeof body !== "object" || body === null) return null;
  const value = body as Record<string, unknown>;
  if (value.status === "not_ready") return { status: "not_ready" };
  if (!isMadhabId(value.madhab)) return null;
  const basis = parseBasis(value.basis);
  if (!basis) return null;
  if (value.status === "unavailable") {
    return typeof value.reason === "string" && value.reason !== ""
      ? { status: "unavailable", madhab: value.madhab, reason: value.reason, basis }
      : null;
  }
  if (value.status !== "available" || !Array.isArray(value.shares)) return null;
  const shares: PreviewShare[] = [];
  for (const item of value.shares as unknown[]) {
    const fraction = parseFraction(item);
    if (!fraction) return null;
    const { heir_id, blocked, amount } = item as Record<string, unknown>;
    if (typeof heir_id !== "string" || typeof blocked !== "boolean") return null;
    if (amount !== null && !(typeof amount === "string" && PREVIEW_AMOUNT.test(amount))) return null;
    shares.push({ ...fraction, heir_id, blocked, amount });
  }
  let unallocated: FractionBody | null = null;
  if (value.unallocated !== null) {
    unallocated = parseFraction(value.unallocated);
    if (!unallocated) return null;
  }
  const proof = parseProof(value.proof, value.madhab, shares);
  if (!proof) return null;
  return { status: "available", madhab: value.madhab, basis, shares, unallocated, proof };
}

/**
 * Asks for the shares of the saved case. One attempt, and it never throws: a hung, failed or
 * malformed answer is `failed`. A read, so it needs no token and does not touch the session.
 */
export async function fetchPreview(
  signal: AbortSignal,
  caseId: string,
  options: { timeoutMs?: number } = {},
): Promise<PreviewResult> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeout = setTimeout(abort, options.timeoutMs ?? PREVIEW_TIMEOUT_MS);
  signal.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetch(`${PREVIEW_URL}?case_id=${encodeURIComponent(caseId)}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
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

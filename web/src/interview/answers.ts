import {
  isGender,
  isRelationshipId,
  MAX_HEIRS,
  RELATIONSHIP_IDS,
  type RelationshipId,
  type Case,
  type DeceasedFields,
  type Heir,
  type HeirFields,
  type HeirOptions,
} from "../api/case.ts";

export const MAX_NAME_LENGTH = 100;

export type FormName = "deceased" | "heir";

/** What the visitor has typed: always strings, as the inputs hold them. */
export type DeceasedValues = { gender: string; estate: string };
export type HeirValues = { relationship: string; name: string };

/** A field name to the code of its broken rule; the dictionary turns codes into text. */
export type Errors = Record<string, string>;

export const DECEASED_FIELDS = ["gender", "estate"] as const;
export const HEIR_FIELDS = ["relationship", "name"] as const;

export const BLANK_DECEASED: DeceasedValues = { gender: "", estate: "" };
export const BLANK_HEIR: HeirValues = { relationship: "", name: "" };

/** Eastern Arabic and Persian digits, and the Arabic decimal separator, to ASCII. */
export function normalizeDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹٫]/g, (char) => {
    if (char === "٫") return ".";
    const code = char.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** The estate to send, canonical: null when left out. `code` is set when it breaks a rule. */
export function parseEstate(raw: string): { value: string | null; code: string | null } {
  const text = normalizeDigits(raw.trim());
  if (text === "") return { value: null, code: null };
  const match = /^([0-9]+)(?:([.,])([0-9]+))?$/.exec(text);
  if (!match) return { value: null, code: "invalid" };
  const [, digits, separator, fraction] = match;
  // A comma is a decimal separator only with one or two digits after it: "1,250" is a
  // thousands separator and stays invalid.
  if (separator === "," && fraction.length > 2) return { value: null, code: "invalid" };
  const whole = digits.replace(/^0+/, "") || "0";
  if (whole.length > 15) return { value: null, code: "too_large" };
  if (fraction !== undefined && fraction.length > 2) return { value: null, code: "decimals" };
  if (/^0*$/.test(whole) && /^0*$/.test(fraction ?? "")) return { value: null, code: "not_positive" };
  return { value: fraction === undefined ? whole : `${whole}.${fraction}`, code: null };
}

export function validateGender(raw: string): string | null {
  if (raw === "") return "required";
  return isGender(raw) ? null : "invalid";
}

export function validateRelationship(raw: string): string | null {
  if (raw === "") return "required";
  return isRelationshipId(raw) ? null : "invalid";
}

/** Bidirectional embeddings, overrides and isolates can reorder the text around a name. */
function isBidiControl(code: number): boolean {
  return (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
}

/** Controls, line and paragraph separators, lone surrogates and bidi controls, by code point. */
function hasForbiddenCharacter(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) return true;
    if (code >= 0xd800 && code <= 0xdfff) return true;
    if (isBidiControl(code)) return true;
  }
  return false;
}

/** Spaces, controls and format characters show nothing; joiners are legal but not visible. */
function isInvisible(code: number): boolean {
  return (
    code <= 0x20 ||
    (code >= 0x7f && code <= 0xa0) ||
    code === 0xad ||
    code === 0x061c ||
    code === 0x1680 ||
    code === 0x180e ||
    (code >= 0x2000 && code <= 0x200f) ||
    (code >= 0x2028 && code <= 0x202f) ||
    (code >= 0x205f && code <= 0x206f) ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

/** The trimmed name to send (null when left out or showing nothing), or the broken rule. */
export function parseName(raw: string): { value: string | null; code: string | null } {
  const text = raw.trim();
  if (hasForbiddenCharacter(text)) return { value: null, code: "invalid" };
  const characters = [...text];
  if (characters.length > MAX_NAME_LENGTH) return { value: null, code: "too_long" };
  if (characters.every((char) => isInvisible(char.codePointAt(0) ?? 0))) return { value: null, code: null };
  return { value: text, code: null };
}

export type Checked<T> = { errors: Errors; fields: T | null };

export function validateDeceased(values: DeceasedValues): Checked<DeceasedFields> {
  const errors: Errors = {};
  const genderCode = validateGender(values.gender);
  if (genderCode) errors.gender = genderCode;
  const estate = parseEstate(values.estate);
  if (estate.code) errors.estate = estate.code;
  if (Object.keys(errors).length > 0 || !isGender(values.gender)) return { errors, fields: null };
  return { errors, fields: { gender: values.gender, estate: estate.value } };
}

export function validateHeir(values: HeirValues): Checked<HeirFields> {
  const errors: Errors = {};
  const relationshipCode = validateRelationship(values.relationship);
  if (relationshipCode) errors.relationship = relationshipCode;
  const name = parseName(values.name);
  if (name.code) errors.name = name.code;
  if (Object.keys(errors).length > 0 || !isRelationshipId(values.relationship)) {
    return { errors, fields: null };
  }
  return { errors, fields: { relationship: values.relationship, name: name.value } };
}

/** The code for one field of a form, or null when it is fine (validation on blur). */
export function validateField(
  form: FormName,
  field: string,
  values: Record<string, string>,
): string | null {
  if (form === "deceased") {
    if (field === "gender") return validateGender(values.gender ?? "");
    if (field === "estate") return parseEstate(values.estate ?? "").code;
    return null;
  }
  if (field === "relationship") return validateRelationship(values.relationship ?? "");
  if (field === "name") return parseName(values.name ?? "").code;
  return null;
}

/**
 * The server's code for a relationship the add form should flag on blur, or null: advice only,
 * because the server decides every save. A relative who would inherit nothing (hajb) is never
 * flagged, only labelled. It only reads `heir_options` from the case, so no rule is held here.
 * An edit is left to the server: the options describe adding to the whole family, and an edit
 * leaves that heir out.
 */
export function relationshipIssue(
  kase: Pick<Case, "heir_options">,
  editingHeir: string | null,
  relationship: string,
): string | null {
  if (editingHeir !== null || !isRelationshipId(relationship)) return null;
  return kase.heir_options.invalid[relationship] ?? null;
}

/**
 * The relationship list for the heir form, in contract order. Every relationship is offered;
 * the ones the server says would inherit nothing with the family so far carry a label saying
 * so. The edit form (`labelled` false) shows plain labels.
 */
export function heirOptionLabels(
  options: HeirOptions,
  labelled: boolean,
  names: Record<RelationshipId, string>,
  blockedTemplate: string,
): { id: RelationshipId; label: string; blocked: boolean }[] {
  return RELATIONSHIP_IDS.map((id) => {
    const blocked = labelled && options.blocked.includes(id);
    return { id, blocked, label: blocked ? blockedTemplate.replace("{relationship}", names[id]) : names[id] };
  });
}

/** The first field, in screen order, that has an error. */
export function firstInvalid(form: FormName, errors: Errors): string | null {
  const order: readonly string[] = form === "deceased" ? DECEASED_FIELDS : HEIR_FIELDS;
  return order.find((field) => errors[field] !== undefined) ?? null;
}

/** Whether another heir would break the per-case limit. */
export function heirLimitReached(heirs: readonly Heir[]): boolean {
  return heirs.length >= MAX_HEIRS;
}

/**
 * The estate as an amount for the language, with no currency, percentage or kirat. The whole
 * part goes through BigInt and the fraction is joined with the language's own separator, so
 * nothing is ever rounded through a double.
 */
export function formatEstate(estate: string, locale: string): string {
  const [whole, fraction] = estate.split(".");
  const wholeText = new Intl.NumberFormat(locale).format(BigInt(whole));
  if (fraction === undefined) return wholeText;
  const separator =
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === "decimal")?.value ?? ".";
  // Two digits when the amount has a fraction at all, so 12.5 reads 12.50.
  const digits = fraction.padEnd(2, "0");
  const fractionText = new Intl.NumberFormat(locale, {
    useGrouping: false,
    minimumIntegerDigits: digits.length,
  }).format(BigInt(digits));
  return `${wholeText}${separator}${fractionText}`;
}

/** Puts the heir into a template. A replacer-free split, so "$&" in a name stays as typed. */
export function fill(template: string, heir: string): string {
  return template.split("{heir}").join(heir);
}

/** The template split around the placeholder, for rendering the name in its own element. */
export function templateParts(template: string): [string, string] {
  const at = template.indexOf("{heir}");
  return at < 0 ? [template, ""] : [template.slice(0, at), template.slice(at + "{heir}".length)];
}

/**
 * The position (from 1) of an unnamed heir among the unnamed heirs of the same relationship,
 * only when there is more than one, so identical labels can be told apart.
 */
export function unnamedOrdinal(heirs: readonly Pick<Heir, "id" | "name" | "relationship">[], id: string): number | null {
  const heir = heirs.find((item) => item.id === id);
  if (!heir || heir.name !== null) return null;
  const same = heirs.filter((item) => item.name === null && item.relationship === heir.relationship);
  return same.length > 1 ? same.findIndex((item) => item.id === id) + 1 : null;
}

/** An heir is shown by name, or by relationship (numbered when needed) when unnamed. */
export function heirLabel(
  heir: Pick<Heir, "name" | "relationship">,
  relationships: Record<string, string>,
  numbered: string,
  ordinal: number | null = null,
): string {
  if (heir.name !== null) return heir.name;
  const label = relationships[heir.relationship] ?? heir.relationship;
  return ordinal === null ? label : numbered.split("{heir}").join(label).split("{n}").join(String(ordinal));
}

/** The label of every heir in a list, by id. */
export function heirLabels(
  heirs: readonly Heir[],
  relationships: Record<string, string>,
  numbered: string,
): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const heir of heirs) {
    labels[heir.id] = heirLabel(heir, relationships, numbered, unnamedOrdinal(heirs, heir.id));
  }
  return labels;
}

/** The form open in this tab, kept so a language switch or reload continues it. */
export type FormRecord = {
  caseId: string;
  form: FormName;
  /** The heir being edited; null for the deceased and for a new heir. */
  heirId: string | null;
  values: Record<string, string>;
  /**
   * A new-heir draft set aside while an edit is open, and put back when the edit is saved or
   * cancelled, so starting an edit never throws away what was typed.
   */
  parked?: Record<string, string>;
};

export type FormStore = {
  get: () => FormRecord | null;
  set: (record: FormRecord | null) => void;
};

const FORM_KEY = "mawareeth.form-record";

function isStringMap(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

/**
 * Storage errors (blocked, full, private mode) are swallowed: the page works without it. Then
 * the record lives in memory, so a form that is rebuilt still gets what was typed back.
 * The record can hold a name or an amount, so it stays in sessionStorage, which ends with the tab.
 */
export function formStore(
  storage?: () => Pick<Storage, "getItem" | "setItem" | "removeItem">,
): FormStore {
  const open = storage ?? (() => sessionStorage);
  let memory: FormRecord | null = null;
  let broken = false;
  return {
    get() {
      let raw: string | null = null;
      try {
        raw = open().getItem(FORM_KEY);
      } catch {
        broken = true;
      }
      if (broken) return memory;
      try {
        const parsed: unknown = JSON.parse(raw ?? "null");
        if (typeof parsed !== "object" || parsed === null) return null;
        const { caseId, form, heirId, values, parked } = parsed as Record<string, unknown>;
        if (typeof caseId !== "string") return null;
        if (form !== "deceased" && form !== "heir") return null;
        if (heirId !== null && typeof heirId !== "string") return null;
        if (!isStringMap(values)) return null;
        if (parked !== undefined && !isStringMap(parked)) return null;
        return parked === undefined ? { caseId, form, heirId, values } : { caseId, form, heirId, values, parked };
      } catch {
        return null;
      }
    },
    set(record) {
      memory = record;
      try {
        if (record) open().setItem(FORM_KEY, JSON.stringify(record));
        else open().removeItem(FORM_KEY);
      } catch {
        broken = true;
      }
    },
  };
}

/** The record, only when it belongs to this case. */
export function formFor(record: FormRecord | null, caseId: string): FormRecord | null {
  return record && record.caseId === caseId ? record : null;
}

/** The record's values when it is the given form of the case, else the fallback. */
export function valuesFor<T extends Record<string, string>>(
  record: FormRecord | null,
  caseId: string,
  form: FormName,
  heirId: string | null,
  fallback: T,
): T {
  const own = formFor(record, caseId);
  if (!own || own.form !== form || own.heirId !== heirId) return fallback;
  const values = { ...fallback };
  for (const key of Object.keys(fallback)) {
    const stored = own.values[key];
    if (typeof stored === "string") (values as Record<string, string>)[key] = stored;
  }
  return values;
}

export function deceasedValues(deceased: { gender: string; estate: string | null } | null): DeceasedValues {
  return deceased ? { gender: deceased.gender, estate: deceased.estate ?? "" } : BLANK_DECEASED;
}

export function heirValues(heir: Pick<Heir, "relationship" | "name"> | undefined): HeirValues {
  return heir ? { relationship: heir.relationship, name: heir.name ?? "" } : BLANK_HEIR;
}

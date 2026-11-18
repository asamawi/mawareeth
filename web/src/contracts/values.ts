import { CONTRACT_VERSIONS } from "./codes.ts";
import { ContractError } from "./errors.ts";

export type Fraction = { numerator: number; denominator: number };
export type Json = Record<string, unknown>;

export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const SNAKE_RE = /^[a-z][a-z0-9_]*$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const CURRENCY_RE = /^[A-Z]{3}$/;
export const LANG_RE = /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/;

export function fail(path: string, message: string, code = "invalid_contract"): never {
  throw new ContractError(code, `${path}: ${message}`);
}

/** Reject a non-object, a missing or unknown version, before any other key is looked at. */
export function checkVersion(data: unknown, key: string, contract: keyof typeof CONTRACT_VERSIONS): void {
  if (!isObject(data)) fail(contract, "must be an object");
  const record = data as Json;
  if (!(key in record)) fail(contract, `${key} is required`);
  const version = record[key];
  if (typeof version !== "number" || !Number.isInteger(version)) fail(`${contract}.${key}`, "must be an integer");
  if (version !== CONTRACT_VERSIONS[contract]) fail(`${contract}.${key}`, `${version} is not supported`, "unsupported_version");
}

export function isObject(value: unknown): value is Json {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** An object with exactly these keys: unknown and missing keys are both rejected. */
export function obj(value: unknown, path: string, keys: readonly string[]): Json {
  if (!isObject(value)) fail(path, "must be an object");
  const record = value as Json;
  const extra = Object.keys(record).filter((k) => !keys.includes(k));
  if (extra.length) fail(path, `unknown key '${extra[0]}'`);
  const missing = keys.filter((k) => !(k in record));
  if (missing.length) fail(path, `missing key '${missing[0]}'`);
  return record;
}

export function dict(value: unknown, path: string): Json {
  if (!isObject(value)) fail(path, "must be an object");
  return value as Json;
}

export function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, "must be an array");
  return value as unknown[];
}

export function integer(value: unknown, path: string, minimum?: number, maximum?: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) fail(path, "must be a safe integer");
  const n = value as number;
  if (minimum !== undefined && n < minimum) fail(path, `must be at least ${minimum}`);
  if (maximum !== undefined && n > maximum) fail(path, `must be at most ${maximum}`);
  return n;
}

export function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "must be a boolean");
  return value as boolean;
}

export function string(value: unknown, path: string, nonempty = false): string {
  if (typeof value !== "string") fail(path, "must be a string");
  if (nonempty && !(value as string).trim()) fail(path, "must not be empty");
  return value as string;
}

export function code(value: unknown, path: string, vocabulary: readonly string[]): string {
  if (typeof value !== "string" || !vocabulary.includes(value)) fail(path, "is not a known code");
  return value as string;
}

export function pattern(value: unknown, path: string, regex: RegExp, what: string): string {
  if (typeof value !== "string" || !regex.test(value)) fail(path, `must be ${what}`);
  return value as string;
}

export const snake = (value: unknown, path: string) => pattern(value, path, SNAKE_RE, "a lowercase snake_case code");
export const ident = (value: unknown, path: string) => pattern(value, path, ID_RE, "a stable id");

export function isoDate(value: unknown, path: string): string {
  if (typeof value !== "string" || !DATE_RE.test(value)) fail(path, "must be a YYYY-MM-DD date");
  const [y, m, d] = (value as string).split("-").map(Number);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > days) fail(path, "must be a real date");
  return value as string;
}

export function nullable<T>(reader: (value: unknown, path: string) => T, value: unknown, path: string): T | null {
  return value === null ? null : reader(value, path);
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** `{numerator, denominator}`. Never normalises: an unreduced fraction is rejected. */
export function fraction(value: unknown, path: string): Fraction {
  const record = obj(value, path, ["numerator", "denominator"]);
  const numerator = integer(record.numerator, `${path}.numerator`, 0);
  const denominator = integer(record.denominator, `${path}.denominator`, 1);
  if (gcd(numerator, denominator) !== 1) fail(path, "must be a reduced fraction");
  return { numerator, denominator };
}

export function unique(items: readonly string[], path: string, what: string): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item)) fail(path, `duplicate ${what} '${item}'`);
    seen.add(item);
  }
}

/** Dumping a parsed document is a copy: parsing already built a fresh, validated value. */
export function copy<T>(value: T): T {
  return structuredClone(value);
}

/** `share * base` is a whole number, in exact integer arithmetic. */
export function isWhole(share: Fraction, base: number): boolean {
  return (BigInt(share.numerator) * BigInt(base)) % BigInt(share.denominator) === BigInt(0);
}

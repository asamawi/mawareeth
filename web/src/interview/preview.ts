import type { Case, Preview, PreviewBasis, PreviewResult } from "../api/case.ts";

/**
 * What a preview was made for: the case, the school, the deceased's gender and estate, and each
 * heir's id and relationship, which are everything a share depends on. Names are left out, because
 * a rename changes no share and needs no new request. A result is shown only while its key equals
 * the current one.
 */
export function previewKey(kase: Case): string {
  return keyOf(kase.id, {
    madhab: kase.madhab,
    gender: kase.deceased?.gender ?? null,
    estate: kase.deceased?.estate ?? null,
    heirs: kase.heirs,
    // A shared fixture's case may leave `deaths` out: that reads as none.
    deaths: (kase.deaths ?? []).map((death) => ({
      heir_id: death.heir_id,
      order: death.order,
      heirs: death.heirs,
    })),
  });
}

/** The key of a case id and what its numbers depend on; the server's `basis` has the same shape. */
function keyOf(
  caseId: string,
  basis: {
    madhab: string | null;
    gender: string | null;
    estate: string | null;
    heirs: readonly { id: string; relationship: string }[];
    deaths?: readonly {
      heir_id: string;
      order: number;
      heirs: readonly { id: string; relationship: string; same_as?: string }[];
    }[];
  },
): string {
  const key: unknown[] = [
    caseId,
    basis.madhab,
    basis.gender,
    basis.estate,
    basis.heirs.map((heir) => [heir.id, heir.relationship]),
  ];
  // A case without deaths keeps exactly the key it always had.
  if (basis.deaths && basis.deaths.length > 0) {
    key.push(
      basis.deaths.map((death) => [
        death.heir_id,
        death.order,
        death.heirs.map((heir) => [heir.id, heir.relationship, heir.same_as ?? null]),
      ]),
    );
  }
  return JSON.stringify(key);
}

/** The key of the family the server worked out, for the case this tab asked about. */
export function basisKey(caseId: string, basis: PreviewBasis): string {
  return keyOf(caseId, basis);
}

/**
 * A server answer is for the family in the session, which another tab may have changed since
 * this tab's last save. An answer whose basis is not this tab's family is treated like a 409:
 * no numbers.
 */
export function reconcile(key: string, caseId: string, outcome: PreviewResult): PreviewResult {
  if (outcome.kind !== "preview") return outcome;
  // This tab asks only for a case it holds ready, so "not ready" means the family changed.
  if (outcome.preview.status === "not_ready") return { kind: "replaced" };
  return basisKey(caseId, outcome.preview.basis) === key ? outcome : { kind: "replaced" };
}

/**
 * Whether the case has what the engine needs: a school, a deceased and at least one heir, and
 * every person who died has heirs of their own.
 */
export function previewReady(kase: Case): boolean {
  return (
    kase.madhab !== null &&
    kase.deceased !== null &&
    kase.heirs.length > 0 &&
    (kase.deaths ?? []).every((death) => death.heirs.length > 0)
  );
}

export type PreviewRow = {
  heirId: string;
  /** True when the heir receives nothing; the other fields are then null. */
  blocked: boolean;
  /** "1/8", always ASCII. The screen puts it in the language's digits. */
  fraction: string | null;
  /** The percentage to one decimal, half up, such as "12.5". */
  percent: string | null;
  /** The share in 24ths with 2 decimals, half up, such as "3.00"; null for a blocked heir. */
  kirat: string | null;
  /** The amount with 2 decimals from the server, or null when the case has no estate. */
  amount: string | null;
};

export type PreviewRows = {
  rows: PreviewRow[];
  unallocated: { fraction: string; percent: string } | null;
};

/** A part of the whole as a percentage with one decimal, rounded half up, with no float. */
export function percentOf(numerator: number, denominator: number): string {
  const top = BigInt(numerator);
  const bottom = BigInt(denominator);
  const tenths = (top * BigInt(2000) + bottom) / (BigInt(2) * bottom);
  return `${tenths / BigInt(10)}.${tenths % BigInt(10)}`;
}

/** A share in kirat (24ths of the estate) with 2 decimals, rounded half up, with no float. */
export function kiratOf(numerator: number, denominator: number): string {
  const top = BigInt(numerator);
  const bottom = BigInt(denominator);
  const hundredths = (top * BigInt(4800) + bottom) / (BigInt(2) * bottom);
  return `${hundredths / BigInt(100)}.${(hundredths % BigInt(100)).toString().padStart(2, "0")}`;
}

/** What to show for an available preview, in the order the server gave the heirs. */
export function previewRows(preview: Extract<Preview, { status: "available" }>): PreviewRows {
  return {
    rows: preview.shares.map((share) =>
      share.blocked
        ? { heirId: share.heir_id, blocked: true, fraction: null, percent: null, kirat: null, amount: null }
        : {
            heirId: share.heir_id,
            blocked: false,
            fraction: `${share.numerator}/${share.denominator}`,
            percent: percentOf(share.numerator, share.denominator),
            kirat: kiratOf(share.numerator, share.denominator),
            amount: share.amount,
          },
    ),
    unallocated: preview.unallocated
      ? {
          fraction: `${preview.unallocated.numerator}/${preview.unallocated.denominator}`,
          percent: percentOf(preview.unallocated.numerator, preview.unallocated.denominator),
        }
      : null,
  };
}

/** What a request came back with, and what it was asked for. */
export type Settled<T> = { key: string; attempt: number; outcome: T };

/** The outcome to show: only a result for the current key and attempt, else nothing. */
export function shown<T>(current: { key: string; attempt: number }, settled: Settled<T> | null): T | null {
  return settled && settled.key === current.key && settled.attempt === current.attempt
    ? settled.outcome
    : null;
}

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
 * Keeps a preview only when it was computed from the revision of the case on screen. An older
 * one is discarded (null: never displayed, never stored); a newer one means this tab's case is
 * stale, which reads like a 409. A body with no revision (shared or legacy) is kept.
 */
export function acceptRevision(revision: number | null, outcome: PreviewResult): PreviewResult | null {
  if (outcome.kind !== "preview" || outcome.revision === undefined || revision === null) return outcome;
  if (outcome.revision < revision) return null;
  return outcome.revision > revision ? { kind: "replaced" } : outcome;
}

/**
 * What a page that read `kase` once shows for the preview it then fetched (the results page). The
 * preview must be for that same revision: a newer one means another tab changed the case in
 * between, perhaps only a name, which reads like a 409; an older one is never shown and can be
 * retried. Then, as everywhere, it must be for the same family.
 */
export function previewForCase(kase: Case, fetched: PreviewResult): PreviewResult {
  const accepted = acceptRevision(kase.revision, fetched) ?? { kind: "failed" };
  return reconcile(previewKey(kase), kase.id, accepted);
}

/**
 * Whether the case has what the engine needs: a deceased and at least one heir, and every person
 * who died has heirs of their own. A school is not needed: without one the server compares the four.
 */
export function previewReady(kase: Case): boolean {
  return (
    kase.deceased !== null &&
    kase.heirs.length > 0 &&
    (kase.deaths ?? []).every((death) => death.heirs.length > 0)
  );
}

/** One heir's row as the server presented it: every field is a display string, never a number to format. */
export type PreviewRow = {
  heirId: string;
  /** True when the heir receives nothing; the other fields are then null. */
  blocked: boolean;
  /** The reduced share, such as "1/8", in the language's digits. */
  fraction: string | null;
  /** The percentage, such as "12.5%". */
  percent: string | null;
  /** The share in 24ths, such as "3.00"; null for a blocked heir. */
  kirat: string | null;
  /** The amount with its currency, or null when the case has no estate. */
  amount: string | null;
  /** The translated relationship and its Arabic original, each with its language and direction. */
  relationship: { translated: Segment; original: Segment };
};

export type PreviewRows = {
  rows: PreviewRow[];
  /** What no heir takes: its share and amount strings, or null. */
  unallocated: { fraction: string; amount: string | null } | null;
  /** The rounding line, which is separate from the unallocated share, or null. */
  rounding: string | null;
};

type Segment = { text: string; lang: string; dir: string };

/** What to show for an available preview, in the order the server gave the heirs: its presented strings only. */
export function previewRows(preview: Extract<Preview, { status: "available" }>): PreviewRows {
  const presented = preview.presented;
  if (!presented) return { rows: [], unallocated: null, rounding: null };
  return {
    rows: presented.rows.map((row) =>
      row.blocked
        ? { heirId: row.person, blocked: true, fraction: null, percent: null, kirat: null, amount: null, relationship: row.relationship }
        : {
            heirId: row.person,
            blocked: false,
            fraction: row.share.text,
            percent: row.percent.text,
            kirat: row.kirat.text,
            amount: row.amount ? row.amount.text : null,
            relationship: row.relationship,
          },
    ),
    unallocated: presented.unallocated
      ? { fraction: presented.unallocated.text, amount: presented.unallocated.amount ? presented.unallocated.amount.text : null }
      : null,
    rounding: presented.rounding ? presented.rounding.text : null,
  };
}

/** What a request came back with, and what it was asked for. */
export type Settled<T> = { key: string; attempt: number; revision?: number | null; outcome: T };

/** What a request is for: the family key, the attempt and, when it matters, the case revision. */
export type Asked = { key: string; attempt: number; revision?: number | null };

/** The outcome to show: only a result for the current key, attempt and revision, else nothing. */
export function shown<T>(current: Asked, settled: Settled<T> | null): T | null {
  return settled &&
    settled.key === current.key &&
    settled.attempt === current.attempt &&
    (current.revision === undefined || settled.revision === current.revision)
    ? settled.outcome
    : null;
}

/**
 * Whether a request for `current` is still unanswered. A same-family change such as a rename moves
 * only the revision, so the revision counts: the old answer is shown but is no longer current.
 */
export function isPending<T>(ready: boolean, current: Asked, settled: Settled<T> | null): boolean {
  return ready && shown(current, settled) === null;
}

import type { Case, Preview, PreviewProofHeir, PreviewResult } from "../api/case.ts";
import { previewReady, previewRows, type PreviewRow, type PreviewRows } from "./preview.ts";

/** One heir of the results: the server's share and, for a single-death case, the server's proof. */
export type ResultEntry = { row: PreviewRow; proof: PreviewProofHeir | null };

export type AvailablePreview = Extract<Preview, { status: "available" }>;
export type ChoosePreview = Extract<Preview, { status: "choose_school" }>;

/** Why a result has no numbers; the texts are the interview preview's. */
export type ResultsError = "failed" | "throttled" | "gone" | "replaced";

export type ResultsState =
  /** No live case. */
  | { kind: "empty" }
  /** The case lacks a deceased or heirs. */
  | { kind: "incomplete" }
  /** The case is complete and its preview is still on its way. */
  | { kind: "loading" }
  | { kind: "unavailable"; reason: string }
  /** No school is chosen and the schools differ: the visitor must choose before the results. */
  | { kind: "choose_school"; preview: ChoosePreview }
  | { kind: "error"; error: ResultsError }
  | { kind: "available"; preview: AvailablePreview };

/**
 * What the results page shows. `outcome` must already be reconciled with the case (`reconcile`):
 * numbers appear only for an available preview of this very case.
 */
export function resultsState(kase: Case | null, outcome: PreviewResult | null): ResultsState {
  if (kase === null) return { kind: "empty" };
  if (!previewReady(kase)) return { kind: "incomplete" };
  if (outcome === null) return { kind: "loading" };
  if (outcome.kind !== "preview") return { kind: "error", error: outcome.kind };
  const { preview } = outcome;
  if (preview.status === "available") return { kind: "available", preview };
  if (preview.status === "unavailable") return { kind: "unavailable", reason: preview.reason };
  if (preview.status === "choose_school") return { kind: "choose_school", preview };
  // A "not ready" answer for a case this tab holds ready means the family changed.
  return { kind: "error", error: "replaced" };
}

/** Each heir's row joined to that heir's proof entry by heir id, in the server's order. */
export function resultEntries(preview: AvailablePreview): {
  entries: ResultEntry[];
  unallocated: PreviewRows["unallocated"];
} {
  const { rows, unallocated } = previewRows(preview);
  const proofs = new Map((preview.proof?.version === 1 ? preview.proof.heirs : []).map((heir) => [heir.heir, heir]));
  return { entries: rows.map((row) => ({ row, proof: proofs.get(row.heirId) ?? null })), unallocated };
}

/** Identify successive deaths from the calculation basis, including fallback results. */
export function isLayeredPreview(preview: AvailablePreview): boolean {
  return Boolean(preview.basis.deaths);
}

/** Where a text comes from: the results dictionary, the interview's, or its refusal sentences by reason code. */
export type TextRef =
  | { from: "results"; key: "emptyCase" | "incompleteCase" | "loadFailed" | "loading" }
  | { from: "interview"; key: "previewUnavailable" | "previewThrottled" | "previewGone" | "previewExpired" | "previewFailed" }
  | { from: "reason"; key: string };

/** What a state with no numbers shows: its texts in order, whether they are an alert, and whether Retry is offered. */
export type Presentation = { texts: TextRef[]; alert: boolean; retry: boolean };

/** The presentation of every state that has no numbers; `load_failed` is the case failing to load at all. */
export function presentationOf(
  state: Exclude<ResultsState, { kind: "available" | "choose_school" }> | { kind: "load_failed" },
): Presentation {
  switch (state.kind) {
    case "load_failed":
      return { texts: [{ from: "results", key: "loadFailed" }], alert: true, retry: true };
    case "empty":
      return { texts: [{ from: "results", key: "emptyCase" }], alert: false, retry: false };
    case "incomplete":
      return { texts: [{ from: "results", key: "incompleteCase" }], alert: false, retry: false };
    case "loading":
      return { texts: [{ from: "results", key: "loading" }], alert: false, retry: false };
    case "unavailable":
      return {
        texts: [{ from: "interview", key: "previewUnavailable" }, { from: "reason", key: state.reason }],
        alert: false,
        retry: false,
      };
    case "error": {
      const key = {
        throttled: "previewThrottled",
        replaced: "previewGone",
        gone: "previewExpired",
        failed: "previewFailed",
      }[state.error] as "previewThrottled" | "previewGone" | "previewExpired" | "previewFailed";
      return {
        texts: [{ from: "interview", key }],
        alert: true,
        retry: state.error === "failed" || state.error === "replaced",
      };
    }
  }
}

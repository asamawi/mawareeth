"use client";

import type { PresentedResult } from "@/contracts/presented";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { fetchPreview, type Case, type PreviewResult, type SunniId } from "@/api/case";
import type { Messages } from "@/i18n/messages";
import { rowLabels } from "@/interview/layers";
import { evidenceNotes, relationsOf, tableOf, tableView } from "@/interview/table";
import {
  acceptRevision,
  previewKey,
  previewReady,
  previewRows,
  reconcile,
  shown,
  type Settled,
} from "@/interview/preview";

import { InheritanceTable } from "../results/inheritance-table";
import { buttonClass } from "./form-bits";
import { RelationshipText } from "./relationship-text";
import { SchoolChoice } from "./school-choice";

/**
 * The shares of the saved case under its school, as the engine gives them. It asks once after
 * each saved change that matters to a share, and shows a result only while it matches the
 * current case; until then it shows a waiting line. It never moves focus and blocks nothing.
 */
export function SharePreview({
  messages,
  results,
  locale,
  kase,
  saving = false,
  failed = null,
  onChooseSchool,
  onPresented,
}: {
  messages: Messages["interview"];
  /** The results dictionary: the table's captions and the side note's. */
  results: Messages["results"];
  locale: string;
  /** The saved case: it changes only when a save succeeds, so a save in flight changes nothing. */
  kase: Case;
  /** A save is in flight, so choosing a school waits. */
  saving?: boolean;
  /** The last choice of a school could not be saved. */
  failed?: "failed" | "throttled" | null;
  /** Receives the shown PresentedResult of an available preview for the current case, or null. */
  onPresented?: (p: PresentedResult | null) => void;
  /** Saves the school the visitor chose when the schools differ for this family. */
  onChooseSchool?: (madhab: SunniId) => void;
}) {
  const key = previewKey(kase);
  const ready = previewReady(kase);
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<PreviewResult> | null>(null);
  const caseId = kase.id;
  const revision = kase.revision;

  useEffect(() => {
    if (!ready) return;
    const own = new AbortController();
    void fetchPreview(own.signal, caseId, { locale }).then((fetched) => {
      if (own.signal.aborted) return;
      // A preview computed for an older revision is never shown.
      const outcome = acceptRevision(revision, fetched);
      if (outcome !== null) setSettled({ key, attempt, outcome: reconcile(key, caseId, outcome) });
    });
    // A change or leaving drops the request in flight.
    return () => own.abort();
  }, [key, attempt, ready, caseId, locale, revision]);

  const outcome = ready ? shown({ key, attempt }, settled) : null;
  const preview = outcome?.kind === "preview" ? outcome.preview : null;
  const presented = preview?.status === "available" ? preview.presented ?? null : null;
  useEffect(() => { onPresented?.(presented); }, [onPresented, presented]);
  // Every layer's rows are labelled, so a share never reads as a raw id.
  const labels = useMemo(
    () => rowLabels(kase, messages.relationships, messages.heirNumbered, messages.previewOf),
    [kase, messages.relationships, messages.heirNumbered, messages.previewOf],
  );

  let status = "";
  let body: React.ReactNode = null;
  if (!ready) {
    body = <p>{kase.deaths.length > 0 && kase.heirs.length > 0 ? messages.previewLayerPrompt : messages.previewPrompt}</p>;
  } else if (outcome === null) {
    body = <p>{messages.previewWaiting}</p>;
  } else if (outcome.kind === "preview" && preview?.status === "available") {
    status = messages.previewUpdated;
    const { rows, unallocated } = previewRows(preview);
    const proofs = Object.fromEntries(Object.entries(evidenceNotes(preview)).map(([id, notes]) => [id, notes[0].proof]));
    const relations = relationsOf(kase);
    const data = tableOf(preview);
    const list = (
        <ul aria-label={messages.previewHeading} className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.heirId}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-md border border-current/60 p-3"
            >
              <strong>
                <bdi>{labels[row.heirId] ?? row.heirId}</bdi>
                {" "}
                <small className="font-normal"><RelationshipText relationship={row.relationship} /></small>
              </strong>
              {row.blocked || row.fraction === null || row.percent === null ? (
                <span>{messages.previewNoShare}</span>
              ) : (
                <span className="flex flex-wrap gap-x-3">
                  <span>
                    {messages.previewShare}: <bdi dir="ltr">{row.fraction}</bdi>{" "}
                    (<bdi dir="ltr">{row.percent}</bdi>)
                  </span>
                  {row.amount !== null && (
                    <span>
                      {messages.previewAmount}: <bdi dir="auto">{row.amount}</bdi>
                    </span>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
    );
    body = (
      <>
        {data ? (
          <InheritanceTable
            text={results}
            relationships={messages.relationships}
            view={tableView(data, preview)}
            labels={labels}
            relations={relations}
            segments={Object.fromEntries(rows.map((row) => [row.heirId, row.relationship]))}
            proofs={proofs}
          />
        ) : (
          list
        )}
        {unallocated && (
          <p>
            {messages.previewUnallocated}: <bdi dir="ltr">{unallocated.fraction}</bdi>
            {unallocated.amount !== null && <>{" "}(<bdi dir="auto">{unallocated.amount}</bdi>)</>}
          </p>
        )}
        <p className="text-sm">
          {preview.presented?.school_line?.code === "school"
            ? messages.previewSchool.split("{school}").join(preview.presented.school_line.text)
            : preview.presented?.school_line?.text}
        </p>
        <p>
          <Link href={`/${locale}/results/`} prefetch={false} className="underline underline-offset-4">
            {messages.previewResultsLink}
          </Link>
        </p>
      </>
    );
  } else if (outcome.kind === "preview" && preview?.status === "choose_school") {
    status = messages.schoolsDiffer;
    body = (
      <SchoolChoice
        messages={messages}
        preview={preview}
        labels={labels}
        disabled={saving}
        failed={failed}
        onChoose={(madhab) => onChooseSchool?.(madhab)}
      />
    );
  } else if (outcome.kind === "preview" && preview?.status === "unavailable") {
    // A code with no sentence shows the generic text alone.
    const reason = (messages.previewReasons as Record<string, string | undefined>)[preview.reason] ?? null;
    status = reason ? `${messages.previewUnavailable} ${reason}` : messages.previewUnavailable;
    body = (
      <>
        <p>{messages.previewUnavailable}</p>
        {reason && <p>{reason}</p>}
      </>
    );
  } else if (outcome.kind === "preview") {
    // Not reachable: a "not ready" answer is reconciled into "replaced" before it is stored.
    body = <p>{messages.previewPrompt}</p>;
  } else {
    const text =
      outcome.kind === "throttled"
        ? messages.previewThrottled
        : outcome.kind === "replaced"
          ? messages.previewGone
          : outcome.kind === "gone"
            ? messages.previewExpired
            : messages.previewFailed;
    status = text;
    body = (
      <>
        <p>{text}</p>
        {outcome.kind !== "throttled" && outcome.kind !== "gone" && (
          <div>
            <button type="button" className={buttonClass} onClick={() => setAttempt((count) => count + 1)}>
              {messages.previewRetry}
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <section
      data-wide
      aria-labelledby="preview-heading"
      aria-busy={ready && outcome === null}
      className="flex w-full flex-col gap-3"
    >
      <h3 id="preview-heading" className="text-lg font-semibold">
        {messages.previewHeading}
      </h3>
      {/* Present before its text changes, so screen readers announce it once; it never moves focus. */}
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      {body}
    </section>
  );
}

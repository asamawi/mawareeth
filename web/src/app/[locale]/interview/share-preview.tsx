"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { fetchPreview, type Case, type PreviewResult } from "@/api/case";
import type { Messages } from "@/i18n/messages";
import { formatEstate } from "@/interview/answers";
import { localFraction, localPercent } from "@/interview/format";
import { rowLabels } from "@/interview/layers";
import {
  previewKey,
  previewReady,
  previewRows,
  reconcile,
  shown,
  type Settled,
} from "@/interview/preview";

import { buttonClass } from "./form-bits";

/**
 * The shares of the saved case under its school, as the engine gives them. It asks once after
 * each saved change that matters to a share, and shows a result only while it matches the
 * current case; until then it shows a waiting line. It never moves focus and blocks nothing.
 */
export function SharePreview({
  messages,
  locale,
  kase,
}: {
  messages: Messages["interview"];
  locale: string;
  /** The saved case: it changes only when a save succeeds, so a save in flight changes nothing. */
  kase: Case;
}) {
  const key = previewKey(kase);
  const ready = previewReady(kase);
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<PreviewResult> | null>(null);
  const caseId = kase.id;

  useEffect(() => {
    if (!ready) return;
    const own = new AbortController();
    void fetchPreview(own.signal, caseId).then((outcome) => {
      if (!own.signal.aborted) setSettled({ key, attempt, outcome: reconcile(key, caseId, outcome) });
    });
    // A change or leaving drops the request in flight.
    return () => own.abort();
  }, [key, attempt, ready, caseId]);

  const outcome = ready ? shown({ key, attempt }, settled) : null;
  const preview = outcome?.kind === "preview" ? outcome.preview : null;
  const school = kase.madhab ? messages.madhabs[kase.madhab].name : "";
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
    body = (
      <>
        <ul aria-label={messages.previewHeading} className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.heirId}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-md border border-current/60 p-3"
            >
              <strong>
                <bdi>{labels[row.heirId] ?? row.heirId}</bdi>
              </strong>
              {row.blocked || row.fraction === null || row.percent === null ? (
                <span>{messages.previewNoShare}</span>
              ) : (
                <span className="flex flex-wrap gap-x-3">
                  <span>
                    {messages.previewShare}: <bdi dir="ltr">{localFraction(row.fraction, locale)}</bdi>{" "}
                    (<bdi dir="ltr">{localPercent(row.percent, locale)}</bdi>)
                  </span>
                  {row.amount !== null && (
                    <span>
                      {messages.previewAmount}: <bdi dir="ltr">{formatEstate(row.amount, locale)}</bdi>
                    </span>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
        {unallocated && (
          <p>
            {messages.previewUnallocated}: <bdi dir="ltr">{localFraction(unallocated.fraction, locale)}</bdi>{" "}
            (<bdi dir="ltr">{localPercent(unallocated.percent, locale)}</bdi>)
          </p>
        )}
        <p className="text-sm">{messages.previewSchool.split("{school}").join(school)}</p>
        <p>
          <Link href={`/${locale}/results/`} prefetch={false} className="underline underline-offset-4">
            {messages.previewResultsLink}
          </Link>
        </p>
      </>
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
    <section aria-labelledby="preview-heading" aria-busy={ready && outcome === null} className="flex flex-col gap-3">
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

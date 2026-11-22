"use client";

import type { PresentedResult } from "@/contracts/presented";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { fetchPreview, type Case, type Preview, type PreviewResult, type SunniId } from "@/api/case";
import type { Messages } from "@/i18n/messages";
import type { AnnounceKind } from "@/interview/announce";
import { rowLabels } from "@/interview/layers";
import { evidenceNotes, relationsOf, tableOf, tableView } from "@/interview/table";
import {
  acceptRevision,
  isPending,
  previewKey,
  previewReady,
  previewRows,
  reconcile,
  shown,
  type Settled,
} from "@/interview/preview";

import { InheritanceTable } from "../results/inheritance-table";
import { buttonClass } from "./form-bits";
import { useOnline } from "./online";
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
  post,
  drop,
  heirCount,
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
  /** Posts to the Interview's one polite status; the preview speaks only through it. */
  post?: (kind: AnnounceKind, text: string) => void;
  /** Drops pending messages of these kinds: a request that is over must not speak late. */
  drop?: (...kinds: AnnounceKind[]) => void;
  /** The heirs of the active estate, for the "shares ready" sentence. */
  heirCount?: number;
}) {
  const key = previewKey(kase);
  const ready = previewReady(kase);
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<PreviewResult> | null>(null);
  // The last answer with shares, kept on screen (muted) while the next one is awaited.
  const [last, setLast] = useState<Last | null>(null);
  // Which request the slow status belongs to, and how far along it is.
  const [slow, setSlow] = useState<{ id: string; level: 1 | 2 } | null>(null);
  const [reserve, setReserve] = useState(0);
  const body_ = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  const names = useRef<{ labels: Record<string, string>; relations: Record<string, string> }>({ labels: {}, relations: {} });
  const online = useOnline();
  const caseId = kase.id;
  const revision = kase.revision;
  const requestId = `${key}|${attempt}|${revision}`;
  const latest = useRef({ messages, heirCount, post, drop });
  useEffect(() => { latest.current = { messages, heirCount, post, drop }; });
  // A request that failed while offline: its rows stay, and one more request goes out on reconnect.
  const failedOffline = useRef(false);
  useEffect(() => {
    const back = () => {
      if (!failedOffline.current) return;
      failedOffline.current = false;
      setAttempt((count) => count + 1);
    };
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, []);

  useEffect(() => {
    // Only a preview of a case that was already ready on arrival is quiet; the first add from an empty estate is not.
    if (!ready) { loaded.current = true; return; }
    failedOffline.current = false;
    // What the last request left unspoken is about an older family.
    latest.current.drop?.("preview", "progress");
    const own = new AbortController();
    const say = (text: string) => latest.current.post?.("progress", text);
    // The slow status is a quiet line after three seconds, and a firmer one after ten.
    setReserve(body_.current?.offsetHeight ?? 0);
    const slower = setTimeout(() => {
      setSlow({ id: requestId, level: 1 });
      if (navigator.onLine) say(latest.current.messages.previewWaiting);
    }, SLOW_AFTER);
    const slowest = setTimeout(() => {
      setSlow({ id: requestId, level: 2 });
      if (navigator.onLine) say(latest.current.messages.previewStillWorking);
    }, STILL_AFTER);
    void fetchPreview(own.signal, caseId, { locale }).then((fetched) => {
      if (own.signal.aborted) return;
      // A preview computed for an older revision is never shown.
      const outcome = acceptRevision(revision, fetched);
      if (outcome === null) return;
      clearTimeout(slower);
      clearTimeout(slowest);
      latest.current.drop?.("progress");
      const reconciled = reconcile(key, caseId, outcome);
      setSettled({ key, attempt, revision, outcome: reconciled });
      if (reconciled.kind === "preview" && reconciled.preview.status === "available") {
        setLast({ caseId, preview: reconciled.preview, ...names.current });
      }
      const { messages: text, heirCount: count, post: speak } = latest.current;
      if (reconciled.kind === "failed" && !navigator.onLine) {
        // Offline: the last shares stay, and nothing is said about a failure the visitor already knows of.
        failedOffline.current = true;
        loaded.current = true;
        return;
      }
      // The first shares of a page load are not a change the visitor made, so they are not spoken;
      // every later settle, and any failure, is.
      const quiet = loaded.current === false && reconciled.kind === "preview" && reconciled.preview.status === "available";
      loaded.current = true;
      if (!quiet) speak?.("preview", settledText(reconciled, text, count ?? 0));
    });
    // A change or leaving drops the request in flight.
    return () => {
      latest.current.drop?.("progress");
      own.abort();
      clearTimeout(slower);
      clearTimeout(slowest);
    };
  }, [key, attempt, ready, caseId, locale, revision, requestId]);

  const asked = { key, attempt, revision };
  const outcome = ready ? shown(asked, settled) : null;
  const pending = isPending(ready, asked, settled);
  const preview = outcome?.kind === "preview" ? outcome.preview : null;
  const presented = preview?.status === "available" ? preview.presented ?? null : null;
  useEffect(() => { onPresented?.(presented); }, [onPresented, presented]);
  // Every layer's rows are labelled, so a share never reads as a raw id.
  const labels = useMemo(
    () => rowLabels(kase, messages.relationships, messages.heirNumbered, messages.previewOf),
    [kase, messages.relationships, messages.heirNumbered, messages.previewOf],
  );

  const relations = useMemo(() => relationsOf(kase), [kase]);
  useEffect(() => { names.current = { labels, relations }; });
  const kept = (pending || (!online && outcome?.kind === "failed")) && last !== null && last.caseId === caseId ? last : null;

  const available = (shownPreview: Extract<Preview, { status: "available" }>, names: Record<string, string>, relationOf: Record<string, string>) => {
    const { rows, unallocated } = previewRows(shownPreview);
    const proofs = Object.fromEntries(Object.entries(evidenceNotes(shownPreview)).map(([id, notes]) => [id, notes[0].proof]));
    const data = tableOf(shownPreview);
    const list = (
        <ul aria-label={messages.previewHeading} className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.heirId}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-md border border-current/60 p-3"
            >
              <strong>
                <bdi>{names[row.heirId] ?? row.heirId}</bdi>
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
    return (
      <>
        {data ? (
          <InheritanceTable
            text={results}
            relationships={messages.relationships}
            view={tableView(data, shownPreview)}
            labels={names}
            relations={relationOf}
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
          {shownPreview.presented?.school_line?.code === "school"
            ? messages.previewSchool.split("{school}").join(shownPreview.presented.school_line.text)
            : shownPreview.presented?.school_line?.text}
        </p>
        <p>
          <Link href={`/${locale}/results/`} prefetch={false} className="underline underline-offset-4">
            {messages.previewResultsLink}
          </Link>
        </p>
      </>
    );
  };

  const slowLevel = pending && online && slow?.id === requestId ? slow.level : 0;
  let body: React.ReactNode = null;
  if (!ready) {
    body = <p>{kase.deaths.length > 0 && kase.heirs.length > 0 ? messages.previewLayerPrompt : messages.previewPrompt}</p>;
  } else if (kept) {
    body = available(kept.preview, kept.labels, kept.relations);
  } else if (outcome === null) {
    body = slowLevel === 0 ? <p>{messages.previewWaiting}</p> : null;
  } else if (outcome.kind === "preview" && preview?.status === "available") {
    body = available(preview, labels, relations);
  } else if (outcome.kind === "preview" && preview?.status === "choose_school") {
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

  const slowText = slowLevel === 2 ? messages.previewStillWorking : messages.previewWaiting;
  return (
    <section
      data-wide
      aria-labelledby="preview-heading"
      aria-busy={pending}
      className="flex w-full flex-col gap-3"
    >
      <h3 id="preview-heading" className="text-lg font-semibold">
        {messages.previewHeading}
      </h3>
      {/* Held at its height while an answer is awaited, so the swap does not move the page. The shares
          are the last good ones, in the muted pair (no opacity). It is silent: the Interview's one
          status region speaks for it. */}
      <div
        ref={body_}
        data-preview-body
        data-pending={kept ? "" : undefined}
        style={pending && reserve > 0 ? { minHeight: reserve } : undefined}
        className={`flex flex-col gap-3 ${kept ? "bg-surface text-muted" : ""}`}
      >
        {body}
      </div>
      {slowLevel > 0 && (
        <p data-slow className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-muted">
          {slowText}
        </p>
      )}
    </section>
  );
}

const SLOW_AFTER = 3000;
const STILL_AFTER = 10000;

/** The shares last shown, with the names and relationships they were shown under. */
type Last = {
  caseId: string;
  preview: Extract<Preview, { status: "available" }>;
  labels: Record<string, string>;
  relations: Record<string, string>;
};

/** The one sentence a settled preview adds to the status. */
function settledText(outcome: PreviewResult, messages: Messages["interview"], count: number): string {
  if (outcome.kind === "preview") {
    const preview = outcome.preview;
    if (preview.status === "available") return messages.previewReadyCount.split("{count}").join(String(count));
    if (preview.status === "choose_school") return messages.schoolsDiffer;
    if (preview.status === "unavailable") {
      const reason = (messages.previewReasons as Record<string, string | undefined>)[preview.reason] ?? null;
      return reason ? `${messages.previewUnavailable} ${reason}` : messages.previewUnavailable;
    }
    return "";
  }
  return outcome.kind === "throttled"
    ? messages.previewThrottled
    : outcome.kind === "replaced"
      ? messages.previewGone
      : outcome.kind === "gone"
        ? messages.previewExpired
        : messages.previewFailed;
}

"use client";

import type { PresentedResult } from "@/contracts/presented";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";

import { fetchPreview, type Case, type Preview, type PreviewResult, type SunniId } from "@/api/case";
import type { Messages } from "@/i18n/messages";
import type { AnnounceKind } from "@/interview/announce";
import { noticeText } from "@/interview/notices";
import { rowLabels } from "@/interview/layers";
import { useObstruction } from "@/interview/obstruction";
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

import { primaryButton } from "../ui";
import { buttonClass } from "./form-bits";
import { useOnline } from "./online";
import { RelationshipText } from "./relationship-text";
import { SchoolChoice } from "./school-choice";

type Available = Extract<Preview, { status: "available" }>;

/** The settled signal the Interview root exposes as `data-preview-state`. */
export type PreviewState = "idle" | "pending" | "ready" | "choose-school" | "refused" | "error";

/** What the body draws, already decided by the lifecycle. */
export type PreviewContent =
  | { kind: "prompt"; layered: boolean }
  | { kind: "waiting" }
  | { kind: "none" }
  | { kind: "available"; preview: Available; labels: Record<string, string> }
  | { kind: "choose"; preview: Extract<Preview, { status: "choose_school" }>; labels: Record<string, string> }
  | { kind: "refused"; reason: string | null; refusals?: string[] }
  | { kind: "error"; text: string; retry: boolean };

/** Everything `SharePreviewBody` needs from the lifecycle; 11.3 renders `<SharePreviewBody {...view} />`. */
export type SharePreviewView = {
  state: PreviewState;
  /** The revision of the accepted calculation, or null while none is accepted. */
  revision: number | null;
  pending: boolean;
  /** Whether the content is the last available answer, kept (muted) while the next is awaited. */
  kept: boolean;
  slowLevel: 0 | 1 | 2;
  /** The heirs of the active estate, for the summary bar. */
  heirCount: number;
  content: PreviewContent;
  /** Height held while an answer is awaited, so the swap does not move the page. */
  reserve: number;
  bodyRef: RefObject<HTMLDivElement | null>;
  retry: () => void;
};

/**
 * The lifecycle of the shares of the saved case under its school, as the engine gives them. It asks
 * once after each saved change that matters to a share, and yields a result only while it matches the
 * current case; until then it is waiting. It never moves focus and blocks nothing.
 */
export function useSharePreview({
  messages,
  locale,
  kase,
  onPresented,
  post,
  drop,
  heirCount = 0,
}: {
  messages: Messages["interview"];
  locale: string;
  /** The saved case: it changes only when a save succeeds, so a save in flight changes nothing. */
  kase: Case;
  /** Receives the shown PresentedResult of an available preview for the current case, or null. */
  onPresented?: (p: PresentedResult | null) => void;
  /** Posts to the Interview's one polite status; the preview speaks only through it. */
  post?: (kind: AnnounceKind, text: string) => void;
  /** Drops pending messages of these kinds: a request that is over must not speak late. */
  drop?: (...kinds: AnnounceKind[]) => void;
  /** The heirs of the active estate, for the "shares ready" sentence. */
  heirCount?: number;
}): SharePreviewView {
  const key = previewKey(kase);
  const ready = previewReady(kase);
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled<PreviewResult> | null>(null);
  // The last answer with shares, kept on screen (muted) while the next one is awaited.
  const [last, setLast] = useState<Last | null>(null);
  // Which request the slow status belongs to, and how far along it is.
  const [slow, setSlow] = useState<{ id: string; level: 1 | 2 } | null>(null);
  const [reserve, setReserve] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const loaded = useRef(false);
  const names = useRef<{ labels: Record<string, string> }>({ labels: {} });
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
    setReserve(bodyRef.current?.offsetHeight ?? 0);
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

  useEffect(() => { names.current = { labels }; });
  const kept = (pending || (!online && outcome?.kind === "failed")) && last !== null && last.caseId === caseId ? last : null;

  const slowLevel: 0 | 1 | 2 = pending && online && slow?.id === requestId ? slow.level : 0;
  let content: PreviewContent;
  if (!ready) {
    content = { kind: "prompt", layered: kase.deaths.length > 0 && kase.heirs.length > 0 };
  } else if (kept) {
    content = { kind: "available", preview: kept.preview, labels: kept.labels };
  } else if (outcome === null) {
    content = slowLevel === 0 ? { kind: "waiting" } : { kind: "none" };
  } else if (outcome.kind === "preview" && preview?.status === "available") {
    content = { kind: "available", preview, labels };
  } else if (outcome.kind === "preview" && preview?.status === "choose_school") {
    content = { kind: "choose", preview, labels };
  } else if (outcome.kind === "preview" && preview?.status === "unavailable") {
    // A code with no sentence shows the generic text alone.
    const refusals = [...new Set((preview.presented?.refusals ?? []).map((refusal) => refusal.text))];
    content = {
      kind: "refused",
      reason: (messages.previewReasons as Record<string, string | undefined>)[preview.reason] ?? null,
      ...(refusals.length > 1 ? { refusals } : {}),
    };
  } else if (outcome.kind === "preview") {
    // Not reachable: a "not ready" answer is reconciled into "replaced" before it is stored.
    content = { kind: "prompt", layered: false };
  } else {
    content = {
      kind: "error",
      text:
        outcome.kind === "throttled"
          ? messages.previewThrottled
          : outcome.kind === "replaced"
            ? messages.previewGone
            : outcome.kind === "gone"
              ? messages.previewExpired
              : messages.previewFailed,
      retry: outcome.kind !== "throttled" && outcome.kind !== "gone",
    };
  }

  let state: PreviewState = "idle";
  if (ready) {
    if (pending || outcome === null) state = "pending";
    else if (outcome.kind !== "preview") state = "error";
    else if (preview?.status === "available") state = "ready";
    else if (preview?.status === "choose_school") state = "choose-school";
    else if (preview?.status === "unavailable") state = "refused";
  }

  return {
    state,
    revision: ready && outcome !== null && settled ? settled.revision ?? null : null,
    pending,
    kept: kept !== null,
    slowLevel,
    heirCount,
    content,
    reserve,
    bodyRef,
    retry: () => setAttempt((count) => count + 1),
  };
}

/**
 * The shares as the server presented them, with no request of its own: it draws the view the
 * lifecycle hands it, so it can sit in any container. It is silent (no live region).
 */
export function SharePreviewBody({
  messages,
  locale,
  content,
  pending,
  kept,
  slowLevel,
  reserve,
  bodyRef,
  saving = false,
  failed = null,
  onRetry,
  onChooseSchool,
  retry,
  state,
  hideHeading = false,
}: SharePreviewView & {
  messages: Messages["interview"];
  locale: string;
  /** The hosting sheet supplies the heading (`#preview-heading`), so the body omits its own. */
  hideHeading?: boolean;
  saving?: boolean;
  failed?: "failed" | "throttled" | null;
  /** Defaults to the view's own `retry`. */
  onRetry?: () => void;
  onChooseSchool?: (madhab: SunniId) => void;
}) {
  let body: React.ReactNode = null;
  if (content.kind === "prompt") {
    body = <p>{content.layered ? messages.previewLayerPrompt : messages.previewPrompt}</p>;
  } else if (content.kind === "waiting") {
    body = <p>{messages.previewWaiting}</p>;
  } else if (content.kind === "available") {
    body = <AvailableShares messages={messages} locale={locale} preview={content.preview} labels={content.labels} />;
  } else if (content.kind === "choose") {
    body = (
      <SchoolChoice
        messages={messages}
        preview={content.preview}
        labels={content.labels}
        disabled={saving || !onChooseSchool}
        failed={failed}
        onChoose={(madhab) => onChooseSchool?.(madhab)}
      />
    );
  } else if (content.kind === "refused") {
    body = (
      <>
        <p>{messages.previewUnavailable}</p>
        {content.refusals
          ? content.refusals.map((line) => <p key={line}>{line}</p>)
          : content.reason && <p>{content.reason}</p>}
      </>
    );
  } else if (content.kind === "error") {
    body = (
      <>
        <p>{content.text}</p>
        {content.retry && (
          <div>
            <button type="button" className={buttonClass} onClick={onRetry ?? retry}>
              {messages.previewRetry}
            </button>
          </div>
        )}
      </>
    );
  }

  // Kept rows stay on screen through an offline failure: the error and Retry come with them.
  if (state === "error" && kept && content.kind === "available") {
    body = (
      <>
        {body}
        <p data-kept-error>{messages.previewFailed}</p>
        <div>
          <button type="button" className={buttonClass} onClick={onRetry ?? retry}>
            {messages.previewRetry}
          </button>
        </div>
      </>
    );
  }

  const slowText = slowLevel === 2 ? messages.previewStillWorking : messages.previewWaiting;
  // The disclaimer is always present; a supplied Beta notice comes with its explanation.
  const presented = content.kind === "available" || content.kind === "choose" ? content.preview.presented : undefined;
  const disclaimer = noticeText(presented, "disclaimer", locale);
  const beta = presented?.notices.some((notice) => notice.code === "locale_beta") ? noticeText(presented, "locale_beta", locale) : null;
  const box = "rounded-[6px] border border-current/60 p-3";
  return (
    <section data-wide aria-labelledby="preview-heading" aria-busy={pending} className="flex w-full flex-col gap-3 bg-surface p-6">
      {!hideHeading && (
        <h3 id="preview-heading" className="text-lg font-semibold">
          {messages.previewHeading}
        </h3>
      )}
      {/* Held at its height while an answer is awaited, so the swap does not move the page. The shares
          are the last good ones, in the muted pair (no opacity). It is silent: the Interview's one
          status region speaks for it. */}
      <div
        ref={bodyRef}
        data-preview-body
        data-pending={kept ? "" : undefined}
        style={pending && reserve > 0 ? { minHeight: reserve } : undefined}
        className={`flex flex-col gap-3 ${kept ? "text-muted" : ""}`}
      >
        {body}
      </div>
      {disclaimer && <p data-notice="disclaimer" className={`${box} font-semibold`}>{disclaimer}</p>}
      {beta && <p data-notice="locale_beta" className={box}>{beta}</p>}
      {slowLevel > 0 && (
        <p data-slow className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-muted">
          {slowText}
        </p>
      )}
    </section>
  );
}

function AvailableShares({
  messages,
  locale,
  preview,
  labels,
}: {
  messages: Messages["interview"];
  locale: string;
  preview: Available;
  labels: Record<string, string>;
}) {
  const { rows, unallocated, rounding } = previewRows(preview);
  const presented = preview.presented;
  return (
    <>
      {presented?.school_line?.code === "same_in_all_schools" && (
        <p data-school-agreement className="font-semibold text-accent">{presented.school_line.text}</p>
      )}
      <ul aria-label={messages.previewHeading} className="flex flex-col">
        {rows.map((row) => {
          const blocked = row.blocked || row.fraction === null || row.percent === null;
          return (
            <li
              key={row.heirId}
              data-blocked={blocked ? "" : undefined}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line py-3 last:border-b-0"
            >
              <span className={`flex min-w-0 flex-col ${blocked ? "text-muted" : ""}`}>
                <bdi>{labels[row.heirId] ?? row.heirId}</bdi>
                <small className="text-muted"><RelationshipText relationship={row.relationship} /></small>
              </span>
              {blocked ? (
                <span className="text-sm text-muted">{messages.treeNoShare}</span>
              ) : (
                <span className="ms-auto flex flex-wrap items-baseline justify-end gap-x-3 font-semibold">
                  <bdi dir="ltr">{row.fraction}</bdi>
                  <bdi dir="ltr">{row.percent}</bdi>
                  {row.amount !== null && <bdi dir="auto">{row.amount}</bdi>}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {unallocated && (
        <p>
          {messages.previewUnallocated}: <bdi dir="ltr">{unallocated.fraction}</bdi>
          {unallocated.amount !== null && <>{" "}(<bdi dir="auto">{unallocated.amount}</bdi>)</>}
        </p>
      )}
      {rounding && (
        <p data-rounding>
          {messages.previewRounding}: <bdi dir="auto">{rounding}</bdi>
        </p>
      )}
      {presented?.school_line?.code === "school" && (
        <p className="text-sm">{messages.previewSchool.split("{school}").join(presented.school_line.text)}</p>
      )}
      <p>
        <Link href={`/${locale}/results/`} prefetch={false} className={primaryButton}>
          {messages.previewResultsLink}
        </Link>
      </p>
    </>
  );
}

const SLOW_AFTER = 3000;
const STILL_AFTER = 10000;

/** The shares last shown, with the names and relationships they were shown under. */
type Last = {
  caseId: string;
  preview: Available;
  labels: Record<string, string>;
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

/** The settled signal the Interview root carries, so tests can wait for an accepted calculation. */
export type PreviewSignal = { state: PreviewState; revision: number | null };

/** The bar's one sentence, from existing messages only; it never says "ready" unless shares are settled. */
function barText(view: SharePreviewView, messages: Messages["interview"]): string {
  if (view.state === "pending") return messages.previewWaiting;
  if (view.state === "error") return view.content.kind === "error" ? view.content.text : messages.previewFailed;
  // Only behind an open sheet: the bar is kept while the content no longer has shares.
  if (view.state === "refused") return messages.previewUnavailable;
  if (view.state === "idle") return messages.previewPrompt;
  return messages.previewReadyCount.split("{count}").join(String(view.heirCount));
}

/** Phone landscape and 400% zoom: the fixed bar would cover too much, so an in-flow button replaces it. */
export const COMPACT_LANDSCAPE_QUERY = "(orientation: landscape) and (max-height: 479.98px)";

/** The in-flow opener shown in place of the bar in compact landscape. */
function SummaryOpenButton({
  messages,
  open,
  onOpen,
  buttonRef,
}: {
  messages: Messages["interview"];
  open: boolean;
  onOpen: () => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div data-summary-inflow>
      <button
        ref={buttonRef}
        type="button"
        data-summary-open
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onOpen}
        className={`${primaryButton} min-h-11 w-full`}
      >
        {messages.previewHeading}
      </button>
    </div>
  );
}

/**
 * The fixed bottom bar: heir count, readiness, Full results and a separate expand control. It adds no
 * live region; the Interview's one status speaks.
 */
function SummaryBar({
  view,
  messages,
  locale,
  inert,
  open,
  onOpen,
  chevronRef,
}: {
  view: SharePreviewView;
  messages: Messages["interview"];
  locale: string;
  inert: boolean;
  open: boolean;
  onOpen: () => void;
  chevronRef: RefObject<HTMLButtonElement | null>;
}) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  useObstruction("bar", box);
  return (
    <div
      ref={setBox}
      data-summary-bar
      inert={inert}
      className="fixed inset-x-0 bottom-0 z-30 flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-2 max-[359.98px]:flex-col max-[359.98px]:items-stretch border-t-2 border-foreground bg-background px-4 py-2 shadow-summary-bar"
    >
      <span data-summary-text className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center max-[359.98px]:w-full max-[359.98px]:flex-none" onClick={onOpen}>
        {barText(view, messages)}
      </span>
      <div className="flex items-center gap-2 max-[359.98px]:justify-between">
        <Link href={`/${locale}/results/`} prefetch={false} className={primaryButton}>
          {messages.previewResultsLink}
        </Link>
        <button
          ref={chevronRef}
          type="button"
          data-summary-expand
          aria-label={messages.previewHeading}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={onOpen}
          className={`${buttonClass} inline-flex min-w-11 items-center justify-center px-2`}
        >
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5-5 5 5" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * The summary bar and modal sheet of one lifecycle view. The bar shows only for the root estate with
 * shares (`showBar`); the sheet hosts `SharePreviewBody` and keeps no request of its own.
 */
export function SharePreviewSummary({
  view,
  messages,
  locale,
  showBar,
  onChooseSchool,
  saving = false,
  failed = null,
  focusRoot,
  onStatusSlot,
}: {
  view: SharePreviewView;
  messages: Messages["interview"];
  locale: string;
  /** The root estate is open. */
  showBar: boolean;
  onChooseSchool?: (madhab: SunniId) => void;
  saving?: boolean;
  failed?: "failed" | "throttled" | null;
  /** Where focus goes when the chevron is gone at close. */
  focusRoot?: () => void;
  /** Receives the slot inside the open dialog that hosts the Interview's one status node, or null. */
  onStatusSlot?: (slot: HTMLElement | null) => void;
}) {
  const { content } = view;
  const hasShares = content.kind === "available" || content.kind === "choose";
  const [open, setOpen] = useState(false);
  // The bar appears with shares; an open sheet keeps itself and the bar through every later state of
  // the root estate, and ends only on Close, Escape, a scrim click or when the root estate is left.
  if (open && !showBar) setOpen(false);
  const visible = showBar && (hasShares || open);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const chevron = useRef<HTMLButtonElement>(null);
  const inflow = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const carryFocus = useRef(false);
  const subscribeCompact = useCallback((notify: () => void) => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
    const mql = window.matchMedia(COMPACT_LANDSCAPE_QUERY);
    const onChange = () => {
      // The opener in focus is about to be swapped out; remember it so focus can follow to the new one.
      const active = document.activeElement;
      carryFocus.current = active !== null && (active === chevron.current || active === inflow.current);
      notify();
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  const compact = useSyncExternalStore(
    subscribeCompact,
    () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(COMPACT_LANDSCAPE_QUERY).matches,
    () => false,
  );
  const sheetOpen = open && showBar;
  const openSheet = useCallback(() => setOpen(true), []);

  useEffect(() => {
    onStatusSlot?.(slot);
    return () => onStatusSlot?.(null);
  }, [slot, onStatusSlot]);

  useEffect(() => {
    const modal = dialog.current;
    if (sheetOpen) {
      if (modal && !modal.open) modal.showModal();
      heading.current?.focus();
      wasOpen.current = true;
    } else {
      if (modal?.open) modal.close();
      if (wasOpen.current) {
        wasOpen.current = false;
        const opener = chevron.current ?? inflow.current;
        if (opener) opener.focus();
        else focusRoot?.();
      }
    }
  }, [sheetOpen, focusRoot]);

  useEffect(() => {
    if (!carryFocus.current) return;
    carryFocus.current = false;
    (compact ? inflow.current : chevron.current)?.focus();
  }, [compact]);

  if (!visible) return null;
  return (
    <>
      {compact ? (
        <SummaryOpenButton messages={messages} open={sheetOpen} onOpen={openSheet} buttonRef={inflow} />
      ) : (
        <SummaryBar view={view} messages={messages} locale={locale} inert={sheetOpen} open={sheetOpen} onOpen={openSheet} chevronRef={chevron} />
      )}
      <dialog
        ref={dialog}
        aria-labelledby="preview-heading"
        data-summary-sheet
        // Escape and the native close both end here; the effect above restores focus.
        onClose={() => setOpen(false)}
        // A click on the dialog itself (not its content) is a click on the scrim.
        onClick={(event) => { if (event.target === event.currentTarget) setOpen(false); }}
        className="fixed inset-x-0 top-auto bottom-0 m-0 max-h-[78dvh] w-full max-w-none flex-col overflow-hidden rounded-t-sheet border-0 border-t-2 border-foreground bg-background p-0 text-foreground shadow-summary-sheet backdrop:bg-scrim open:flex summary-sheet"
      >
        {/* Nothing is rendered while the sheet is closed: no heading, rows or body outside it. */}
        {sheetOpen && (
          <>
            <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-3">
              <h2 id="preview-heading" ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">
                {messages.previewHeading}
              </h2>
              <button type="button" className={buttonClass} onClick={() => setOpen(false)}>
                {messages.editClose}
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {/* The Interview's one status node is moved here while the sheet is open. */}
              <div ref={setSlot} data-status-slot />
              <SharePreviewBody
                {...view}
                messages={messages}
                locale={locale}
                hideHeading
                saving={saving}
                failed={failed}
                onChooseSchool={onChooseSchool}
              />
            </div>
          </>
        )}
      </dialog>
    </>
  );
}

/**
 * Runs the lifecycle on the Interview and reports the settled signal for the root's `data-preview-*`
 * attributes. It is the one owner of the hook; the summary bar and sheet draw from its one view.
 */
export function SharePreviewController({
  onSignal,
  showBar,
  onChooseSchool,
  saving,
  failed,
  focusRoot,
  onStatusSlot,
  ...options
}: Parameters<typeof useSharePreview>[0] & {
  onSignal: (signal: PreviewSignal) => void;
  showBar: boolean;
  onChooseSchool?: (madhab: SunniId) => void;
  saving?: boolean;
  failed?: "failed" | "throttled" | null;
  focusRoot?: () => void;
  onStatusSlot?: (slot: HTMLElement | null) => void;
}) {
  const view = useSharePreview(options);
  const { state, revision } = view;
  useEffect(() => { onSignal({ state, revision }); }, [onSignal, state, revision]);
  useEffect(() => () => onSignal({ state: "idle", revision: null }), [onSignal]);
  return (
    <SharePreviewSummary
      view={view}
      messages={options.messages}
      locale={options.locale}
      showBar={showBar}
      onChooseSchool={onChooseSchool}
      saving={saving}
      failed={failed}
      focusRoot={focusRoot}
      onStatusSlot={onStatusSlot}
    />
  );
}

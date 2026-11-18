"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { downloadDraftReport, fetchCase, fetchPreview, setMadhab, type Case, type DraftReportResult, type PreviewResult, type SunniId } from "@/api/case";
import type { Messages } from "@/i18n/messages";
import { breadcrumb, layersOf, rowLabels } from "@/interview/layers";
import { previewKey, previewReady, reconcile } from "@/interview/preview";
import { evidenceNotes, relationsOf, tableOf, tableView } from "@/interview/table";
import {
  isLayeredPreview,
  presentationOf,
  resultEntries,
  resultsState,
  type AvailablePreview,
  type ChoosePreview,
  type ResultEntry,
} from "@/interview/results";

import { FamilyTree } from "../interview/family-tree";
import { crumbTextOf } from "../interview/death-breadcrumb";
import { buttonClass } from "../interview/form-bits";
import { RelationshipText } from "../interview/relationship-text";
import { SchoolChoice } from "../interview/school-choice";
import { AuthGate } from "./auth-gate";
import { InheritanceTable, ProofList } from "./inheritance-table";

type Loaded =
  | { kind: "case"; kase: Case | null; outcome: PreviewResult | null }
  | { kind: "failed" };

const linkClass = "underline underline-offset-4";

/**
 * The full results of the session case: every heir's share with its derivation, the calculation
 * steps and the family tree. It loads once on mount and offers retry; it never polls. Numbers and
 * proof are the server's, shown only while the preview matches the loaded case.
 */
export function ResultsView({ messages, locale }: { messages: Messages; locale: string }) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ attempt: number; value: Loaded } | null>(null);
  const text = messages.results;

  useEffect(() => {
    const own = new AbortController();
    void (async () => {
      let value: Loaded;
      try {
        const kase = await fetchCase(own.signal);
        let outcome: PreviewResult | null = null;
        if (kase !== null && previewReady(kase)) {
          const key = previewKey(kase);
          outcome = reconcile(key, kase.id, await fetchPreview(own.signal, kase.id, { locale }));
        }
        value = { kind: "case", kase, outcome };
      } catch {
        value = { kind: "failed" };
      }
      if (!own.signal.aborted) setLoaded({ attempt, value });
    })();
    return () => own.abort();
  }, [attempt, locale]);

  const current = loaded && loaded.attempt === attempt ? loaded.value : null;
  const interview = messages.interview;
  // Stable, so the gate's save and share callbacks are not rebuilt on every render.
  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  const back = (
    <p>
      <Link href={`/${locale}/interview/`} prefetch={false} className={linkClass}>
        {text.backToInterview}
      </Link>
    </p>
  );

  if (current === null) {
    return (
      <div data-js-only className="mx-auto flex w-full max-w-xl flex-col gap-3">
        <p role="status">{text.loading}</p>
      </div>
    );
  }
  const render = (state: Parameters<typeof presentationOf>[0], extra?: React.ReactNode) => {
    const presentation = presentationOf(state);
    const reasons = interview.previewReasons as Record<string, string | undefined>;
    const lines = presentation.texts
      .map((ref) => (ref.from === "results" ? text[ref.key] : ref.from === "interview" ? interview[ref.key] : reasons[ref.key]))
      .filter((line): line is string => line !== undefined);
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col gap-3">
        {lines.map((line, index) => (
          <p key={index} role={presentation.alert && index === 0 ? "alert" : undefined}>
            {line}
          </p>
        ))}
        {presentation.retry && (
          <div>
            <button type="button" className={buttonClass} onClick={() => setAttempt((count) => count + 1)}>
              {state.kind === "load_failed" ? text.loadRetry : interview.previewRetry}
            </button>
          </div>
        )}
        {extra}
      </div>
    );
  };
  if (current.kind === "failed") return render({ kind: "load_failed" }, back);

  const { kase, outcome } = current;
  const state = resultsState(kase, outcome);

  if (state.kind === "available" && kase !== null) {
    return (
      <Available
        messages={messages}
        locale={locale}
        kase={kase}
        preview={state.preview}
        back={back}
        onSchoolRequired={reload}
      />
    );
  }
  if (state.kind === "available") return null;
  if (state.kind === "choose_school" && kase !== null) {
    return (
      <ChooseSchool
        key={kase.id}
        messages={messages}
        kase={kase}
        preview={state.preview}
        back={back}
        onChosen={reload}
      />
    );
  }
  if (state.kind === "choose_school") return null;
  return render(
    state,
    state.kind === "empty" ? (
      <p>
        <Link href={`/${locale}/interview/`} prefetch={false} className={linkClass}>
          {text.startInterview}
        </Link>
      </p>
    ) : (
      back
    ),
  );
}

/** The schools differ for this family and none is chosen: the visitor chooses, and then sees the results. */
function ChooseSchool({
  messages,
  kase,
  preview,
  back,
  onChosen,
}: {
  messages: Messages;
  kase: Case;
  preview: ChoosePreview;
  back: React.ReactNode;
  onChosen: () => void;
}) {
  const interview = messages.interview;
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<"failed" | "throttled" | null>(null);
  const labels = useMemo(
    () => rowLabels(kase, interview.relationships, interview.heirNumbered, interview.previewOf),
    [kase, interview.relationships, interview.heirNumbered, interview.previewOf],
  );
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, []);
  async function choose(madhab: SunniId) {
    if (saving) return;
    const own = new AbortController();
    request.current = own;
    setSaving(true);
    setFailed(null);
    const result = await setMadhab(own.signal, madhab, kase.id, kase.revision);
    if (!mounted.current || own.signal.aborted) return;
    if (result.kind === "updated" || result.kind === "replaced" || result.kind === "gone") onChosen();
    else setFailed(result.kind);
    setSaving(false);
  }
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <SchoolChoice
        messages={interview}
        preview={preview}
        labels={labels}
        disabled={saving}
        failed={failed}
        onChoose={(madhab) => void choose(madhab)}
      />
      {back}
    </div>
  );
}

/** The results body. The shared page reuses it read-only: no save/share gate, and its own PDF download. */
export function Available({
  messages,
  locale,
  kase,
  preview,
  back,
  gate = true,
  download,
  onSchoolRequired,
}: {
  messages: Messages;
  locale: string;
  kase: Case;
  preview: AvailablePreview;
  back: React.ReactNode;
  gate?: boolean;
  download?: (signal: AbortSignal) => Promise<DraftReportResult>;
  /** The server refused a save because no school is chosen and the schools differ: show the choice. */
  onSchoolRequired?: () => void;
}) {
  const text = messages.results;
  const interview = messages.interview;
  const { entries, unallocated } = useMemo(() => resultEntries(preview), [preview]);
  const layered = isLayeredPreview(preview);
  const labels = useMemo(
    () => rowLabels(kase, interview.relationships, interview.heirNumbered, interview.previewOf),
    [kase, interview.relationships, interview.heirNumbered, interview.previewOf],
  );
  const crumbs = useMemo(
    () => breadcrumb(kase, interview.relationships, interview.heirNumbered),
    [kase, interview.relationships, interview.heirNumbered],
  );
  const layers = layersOf(kase);
  const presented = preview.presented;
  const schoolLine = presented?.school_line ?? null;
  // A single estate shows the calculation steps; the evidence lists one entry per death otherwise.
  const single = presented !== undefined && presented.evidence.length === 1 ? presented.evidence[0] : null;
  const data = tableOf(preview);
  const table = data ? tableView(data, preview) : null;
  const proofs = useMemo(() => Object.fromEntries(Object.entries(evidenceNotes(preview)).map(([id, notes]) => [id, notes[0].proof])), [preview]);
  const relations = useMemo(() => relationsOf(kase), [kase]);
  const segments = useMemo(() => Object.fromEntries(entries.map((entry) => [entry.row.heirId, entry.row.relationship])), [entries]);
  const stepTexts = useMemo(() => {
    const totals = new Map(data && !("layers" in data) ? data.columns.map((column) => [column.code, column.total.text] as const) : []);
    // A shortage with a spouse is stated as the union of its two calculations.
    return (step: string) => (step === "unallocated" ? presented?.unallocated?.text : totals.get(step === "radd" && totals.has("radd_union") ? "radd_union" : step)) ?? null;
  }, [data, presented]);

  return (
    <div className="mx-auto flex w-full flex-col gap-6">
      <p>{schoolLine?.code === "school" ? text.school.split("{school}").join(schoolLine.text) : schoolLine?.text}</p>
      {gate && <AuthGate key={`${kase.id}:${kase.madhab ?? ""}`} caseId={kase.id} locale={locale} text={text} share={messages.share} onSchoolRequired={onSchoolRequired} />}
      <DraftDownload key={`${kase.id}:${locale}`} caseId={kase.id} locale={locale} text={text} download={download} />

      <section aria-labelledby="results-shares" className="flex flex-col gap-3">
        <h2 id="results-shares" className="text-xl font-semibold">
          {text.sharesHeading}
        </h2>
        {layered && <p>{text.layeredNote}</p>}
        {table ? (
          <InheritanceTable
            text={text}
            relationships={interview.relationships}
            view={table}
            labels={labels}
            relations={relations}
            segments={segments}
            proofs={proofs}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {entries.map((entry) => (
              <HeirCard
                key={entry.row.heirId}
                messages={messages}
                entry={entry}
                label={labels[entry.row.heirId] ?? entry.row.heirId}
              />
            ))}
          </ul>
        )}
        {unallocated && (
          <p>
            {interview.previewUnallocated}: <bdi dir="ltr">{unallocated.fraction}</bdi>
            {unallocated.amount !== null && <>{" "}(<bdi dir="auto">{unallocated.amount}</bdi>)</>}
          </p>
        )}
      </section>

      {single && (
        <section aria-labelledby="results-steps" className="flex flex-col gap-3">
          <h2 id="results-steps" className="text-xl font-semibold">
            {text.stepsHeading}
          </h2>
          <ol className="flex list-decimal flex-col gap-1 ps-6">
            {single.steps.map((step) => (
              <li key={step.step}>
                {step.text}: {stepTexts(step.step) !== null && <bdi dir="ltr">{stepTexts(step.step)}</bdi>}
              </li>
            ))}
          </ol>
          {single.school_rules.length > 0 && (
            <>
              <h3 className="text-lg font-semibold">{text.schoolRulesHeading}</h3>
              <ul className="flex list-disc flex-col gap-1 ps-6">
                {single.school_rules.map((rule) => (
                  <li key={rule.code}>{rule.text}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section aria-labelledby="results-family" className="flex flex-col gap-4">
        <h2 id="results-family" className="text-xl font-semibold">
          {text.familyHeading}
        </h2>
        {layers.map((layer, index) => {
          const crumb = crumbs[index];
          return (
            <FamilyTree
              key={layer.id ?? "first"}
              messages={interview}
              gender={layer.gender ?? kase.deceased?.gender ?? "male"}
              rootText={crumb && crumb.id !== null ? crumbTextOf(interview, crumb) : undefined}
              heirs={layer.heirs}
              editingId={null}
            />
          );
        })}
      </section>

      {back}
    </div>
  );
}

function HeirCard({
  messages,
  entry,
  label,
}: {
  messages: Messages;
  entry: ResultEntry;
  label: string;
}) {
  const text = messages.results;
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { row, proof } = entry;
  const hasShare = !row.blocked && row.fraction !== null && row.percent !== null && row.kirat !== null;

  return (
    <li className="flex flex-col gap-2 rounded-md border border-current/60 p-3">
      <strong>
        <bdi>{label}</bdi>
        {" "}
        <small className="font-normal"><RelationshipText relationship={row.relationship} /></small>
      </strong>
      {hasShare ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt>{text.share}</dt>
          <dd>
            <bdi dir="ltr">{row.fraction}</bdi>
          </dd>
          <dt>{text.percent}</dt>
          <dd>
            <bdi dir="ltr">{row.percent}</bdi>
          </dd>
          <dt>{text.kirat}</dt>
          <dd>
            <bdi dir="ltr">{row.kirat}</bdi>
          </dd>
          {row.amount !== null && (
            <>
              <dt>{text.amount}</dt>
              <dd>
                <bdi dir="auto">{row.amount}</bdi>
              </dd>
            </>
          )}
        </dl>
      ) : (
        <>
          <p>{text.noShare}</p>
          {proof?.labels.blocked_by && <p>{proof.labels.blocked_by}</p>}
        </>
      )}
      {proof && (
        <>
          <div>
            <button
              type="button"
              className={buttonClass}
              aria-expanded={open}
              aria-controls={panelId}
              aria-label={text.proofToggleFor.split("{heir}").join(label)}
              onClick={() => setOpen((value) => !value)}
            >
              {text.proofToggle}
            </button>
          </div>
          <div id={panelId} hidden={!open}>
            <ProofList text={text} proof={proof} />
          </div>
        </>
      )}
    </li>
  );
}

function DraftDownload({ caseId, locale, text, download: inject }: { caseId: string; locale: string; text: Messages["results"]; download?: (signal: AbortSignal) => Promise<DraftReportResult> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(false);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, [caseId, locale]);
  async function download() {
    if (active.current || !mounted.current) return;
    active.current = true;
    setBusy(true);
    setError(null);
    try {
      const controller = new AbortController();
      request.current = controller;
      const result = inject ? await inject(controller.signal) : await downloadDraftReport(caseId, locale, { signal: controller.signal });
      if (!mounted.current || controller.signal.aborted) return;
      if (result.kind !== "download") {
        setError(result.kind === "throttled" ? text.pdfThrottled
          : result.kind === "gone" || result.kind === "replaced" || result.kind === "unavailable" ? text.pdfUnavailable
          : result.kind === "timeout" ? text.pdfTimeout : text.pdfFailed);
        return;
      }
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `mawareeth-draft-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      if (mounted.current) setError(text.pdfFailed);
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return <div className="flex flex-col gap-2" aria-busy={busy}>
    <div><button type="button" disabled={busy} className={buttonClass} onClick={() => void download()}>
      {busy ? text.pdfBusy : error ? text.pdfRetry : text.pdfDownload}
    </button></div>
    {busy && <p role="status">{text.pdfBusy}</p>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

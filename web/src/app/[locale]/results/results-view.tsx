"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { downloadDraftReport, fetchCase, fetchPreview, type Case, type DraftReportResult, type PreviewProofStep, type PreviewResult } from "@/api/case";
import type { Messages } from "@/i18n/messages";
import { formatEstate } from "@/interview/answers";
import { localFraction, localKirat, localPercent } from "@/interview/format";
import { breadcrumb, layersOf, rowLabels } from "@/interview/layers";
import { previewKey, previewReady, reconcile } from "@/interview/preview";
import { hasTable, tableView } from "@/interview/table";
import {
  isLayeredPreview,
  presentationOf,
  resultEntries,
  resultsState,
  type AvailablePreview,
  type ResultEntry,
} from "@/interview/results";

import { FamilyTree } from "../interview/family-tree";
import { crumbTextOf } from "../interview/death-breadcrumb";
import { buttonClass } from "../interview/form-bits";
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
    return <Available messages={messages} locale={locale} kase={kase} preview={state.preview} back={back} />;
  }
  if (state.kind === "available") return null;
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

/** The results body. The shared page reuses it read-only: no save/share gate, and its own PDF download. */
export function Available({
  messages,
  locale,
  kase,
  preview,
  back,
  gate = true,
  download,
}: {
  messages: Messages;
  locale: string;
  kase: Case;
  preview: AvailablePreview;
  back: React.ReactNode;
  gate?: boolean;
  download?: (signal: AbortSignal) => Promise<DraftReportResult>;
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
  const school = interview.madhabs[preview.madhab].name;
  const proof = preview.proof?.version === 1 ? preview.proof : null;
  const table = hasTable(preview) ? tableView(preview.table, preview) : null;
  const proofs = useMemo(() => Object.fromEntries((preview.proof?.version === 1 ? preview.proof.heirs : []).map((entry) => [entry.heir, entry])), [preview]);
  const relations = useMemo(
    () => Object.fromEntries((preview.proof?.version === 1 ? preview.proof.heirs : []).map((entry) => [entry.heir, entry.relationship])),
    [preview],
  );

  return (
    <div className="mx-auto flex w-full flex-col gap-6">
      <p>{text.school.split("{school}").join(school)}</p>
      {gate && <AuthGate key={kase.id} caseId={kase.id} locale={locale} text={text} share={messages.share} />}
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
            locale={locale}
            view={table}
            labels={labels}
            relations={relations}
            proofs={proofs}
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {entries.map((entry) => (
              <HeirCard
                key={entry.row.heirId}
                messages={messages}
                locale={locale}
                entry={entry}
                label={labels[entry.row.heirId] ?? entry.row.heirId}
              />
            ))}
          </ul>
        )}
        {unallocated && (
          <p>
            {interview.previewUnallocated}: <bdi dir="ltr">{localFraction(unallocated.fraction, locale)}</bdi>{" "}
            (<bdi dir="ltr">{localPercent(unallocated.percent, locale)}</bdi>)
          </p>
        )}
      </section>

      {proof && (
        <section aria-labelledby="results-steps" className="flex flex-col gap-3">
          <h2 id="results-steps" className="text-xl font-semibold">
            {text.stepsHeading}
          </h2>
          <ol className="flex list-decimal flex-col gap-1 ps-6">
            {proof.steps.map((step) => (
              <li key={step.step}>
                {step.label}: <StepValue value={step.value} locale={locale} />
              </li>
            ))}
          </ol>
          {proof.school_rule_labels.length > 0 && (
            <>
              <h3 className="text-lg font-semibold">{text.schoolRulesHeading}</h3>
              <ul className="flex list-disc flex-col gap-1 ps-6">
                {proof.school_rule_labels.map((label, index) => (
                  <li key={proof.school_rules[index]}>{label}</li>
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

function StepValue({ value, locale }: { value: PreviewProofStep["value"]; locale: string }) {
  const shown =
    typeof value === "number"
      ? new Intl.NumberFormat(locale, { useGrouping: false }).format(value)
      : localFraction(`${value.numerator}/${value.denominator}`, locale);
  return <bdi dir="ltr">{shown}</bdi>;
}

function HeirCard({
  messages,
  locale,
  entry,
  label,
}: {
  messages: Messages;
  locale: string;
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
      </strong>
      {hasShare ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt>{text.share}</dt>
          <dd>
            <bdi dir="ltr">{localFraction(row.fraction ?? "", locale)}</bdi>
          </dd>
          <dt>{text.percent}</dt>
          <dd>
            <bdi dir="ltr">{localPercent(row.percent ?? "0", locale)}</bdi>
          </dd>
          <dt>{text.kirat}</dt>
          <dd>
            <bdi dir="ltr">{localKirat(row.kirat ?? "0", locale)}</bdi>
          </dd>
          {row.amount !== null && (
            <>
              <dt>{text.amount}</dt>
              <dd>
                <bdi dir="ltr">{formatEstate(row.amount, locale)}</bdi>
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
            <ProofList text={text} proof={proof} locale={locale} />
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

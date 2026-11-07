"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  addHeir,
  fetchCase,
  removeHeir,
  saveDeceased,
  setMadhab,
  startCase,
  updateHeir,
  type MadhabId,
} from "@/api/case";
import type { Messages } from "@/i18n/messages";
import {
  deceasedValues,
  formStore,
  heirLabel,
  heirValues,
  valuesFor,
  type DeceasedValues,
  type HeirValues,
} from "@/interview/answers";
import {
  askStartOver,
  blurField,
  caseOf,
  cancelChange,
  cancelEditDeceased,
  cancelEditHeir,
  cancelStartOver,
  heirFormKey,
  openChange,
  pick,
  pendingView,
  precheck,
  remember,
  runAction,
  screenOf,
  shouldFocus,
  startEditDeceased,
  startEditHeir,
  type Action,
  type Answer,
  type Deps,
  type StartedView,
  type View,
} from "@/interview/flow";
import { initialPick, selectionStore } from "@/interview/madhabs";

import { DeceasedForm } from "./deceased-form";
import { buttonClass } from "./form-bits";
import { DeceasedSummary, HeirList } from "./heir-list";
import { HeirForm } from "./heir-form";
import { MadhabSelector } from "./madhab-selector";

const SEEN_KEY = "mawareeth.case-seen";

// A remembered flag is the only way to tell "expired" from "never started". It is a
// convenience: when storage is blocked the page simply offers a new case.
const deps: Deps = {
  fetchCase: (signal) => fetchCase(signal),
  startCase: (signal, options) => startCase(signal, options),
  setMadhab: (signal, madhab, caseId) => setMadhab(signal, madhab, caseId),
  saveDeceased: (signal, caseId, fields) => saveDeceased(signal, caseId, fields),
  addHeir: (signal, caseId, fields) => addHeir(signal, caseId, fields),
  updateHeir: (signal, caseId, heirId, fields) => updateHeir(signal, caseId, heirId, fields),
  removeHeir: (signal, caseId, heirId) => removeHeir(signal, caseId, heirId),
  selection: selectionStore(),
  forms: formStore(),
  seen: {
    get() {
      try {
        return localStorage.getItem(SEEN_KEY) === "1";
      } catch {
        return false;
      }
    },
    set(value) {
      try {
        if (value) localStorage.setItem(SEEN_KEY, "1");
        else localStorage.removeItem(SEEN_KEY);
      } catch {}
    },
  },
};

export function StartCase({
  messages,
  locale,
}: {
  messages: Messages["interview"];
  locale: string;
}) {
  const [view, setView] = useState<View>({ name: "loading" });
  const controller = useRef<AbortController | null>(null);
  const live = useRef(true);
  const latest = useRef<View>(view);
  const target = useRef<HTMLDivElement>(null);
  const previous = useRef<View | null>(null);
  const settledOnce = useRef(false);

  // Every click makes exactly one attempt; a failure offers a retry and never retries by itself.
  const perform = useCallback(
    async (
      action: Action,
      choice?: { madhab: MadhabId; from: StartedView },
      answer?: Answer,
    ) => {
      controller.current?.abort();
      const own = new AbortController();
      controller.current = own;
      const existing = caseOf(latest.current);
      setView(pendingView(action, latest.current));
      const next = await runAction(action, own.signal, deps, existing, choice, answer);
      if (live.current && controller.current === own) setView(next);
    },
    [],
  );

  // A save is refused while another is in flight, and checked here before anything is sent.
  const submit = useCallback(
    (make: (from: StartedView) => Answer) => {
      const current = latest.current;
      if (current.name !== "started" || current.saving) return;
      const answer = make(current);
      const blocked = precheck(answer);
      if (blocked) {
        setView(blocked);
        return;
      }
      void perform(answer.kind, undefined, answer);
    },
    [perform],
  );

  // Changes that touch only the view, never the server. Navigating is refused mid-save. Typing
  // is not routed here while saving, because the inputs are read-only then, so a save that
  // finishes cannot wipe text typed after it started.
  const track = useCallback((change: (current: StartedView) => StartedView) => {
    const current = latest.current;
    if (current.name === "started") setView(change(current));
  }, []);
  const edit = useCallback(
    (change: (current: StartedView) => StartedView) => {
      if (latest.current.name === "started" && !latest.current.saving) track(change);
    },
    [track],
  );

  useEffect(() => {
    live.current = true;
    void perform("load");
    return () => {
      live.current = false;
      controller.current?.abort();
    };
  }, [perform]);

  useEffect(() => {
    latest.current = view;
    const before = previous.current;
    previous.current = view;
    if (!shouldFocus(before, view)) return;
    // Land on the new view for keyboard and screen-reader users; the first view of a page
    // load keeps the focus where the browser put it. A save in flight or failed keeps focus
    // on the form.
    if (settledOnce.current) target.current?.focus();
    settledOnce.current = true;
  }, [view]);

  const screen = screenOf(view);
  const started = view.name === "started" ? view : null;
  const focusRequest = started?.focus ?? null;

  // A control inside a screen asked for focus: the first invalid field, the cleared form,
  // or the row a change came from.
  useEffect(() => {
    if (!focusRequest) return;
    // The control may be gone (an open question whose row went away): the screen takes focus.
    const control = target.current?.querySelector<HTMLElement>(`[data-focus="${focusRequest.target}"]`);
    (control ?? target.current)?.focus();
  }, [focusRequest]);

  const resumable = view.name === "throttled" || view.name === "failed" ? view.resumable : null;

  const editingHeir = started?.case.heirs.find((heir) => heir.id === started.editingHeir);
  const announced = started?.announcement ?? null;
  const announcement = announced
    ? {
        seq: announced.seq,
        template:
          messages[
            announced.kind === "added" ? "heirAdded" : announced.kind === "updated" ? "heirUpdated" : "heirRemoved"
          ],
        heir: heirLabel(announced.heir, messages.relationships, messages.heirNumbered, announced.ordinal),
      }
    : null;

  const madhabBar = started?.case.madhab ? (
    <div className="flex flex-wrap items-center gap-3">
      <p>
        {messages.madhabLabel}: <strong>{messages.madhabs[started.case.madhab].name}</strong>
      </p>
      <button
        type="button"
        className={buttonClass}
        aria-disabled={started.saving}
        onClick={() => edit((current) => openChange(current, deps))}
      >
        {messages.madhabChange}
      </button>
    </div>
  ) : null;

  return (
    <div data-js-only ref={target} tabIndex={-1} className="flex flex-col gap-4 outline-none [&>*:not(form)]:mx-auto [&>*:not(form)]:w-full [&>*:not(form)]:max-w-xl">
      {view.name === "loading" && <p role="status">{messages.loading}</p>}
      {view.name === "starting" && <p role="status">{messages.starting}</p>}

      {view.name === "none" && (
        <>
          {view.expired && <p role="status">{messages.expired}</p>}
          <p>{messages.intro}</p>
          <div>
            <button type="button" className={buttonClass} onClick={() => void perform("start")}>
              {messages.start}
            </button>
          </div>
        </>
      )}

      {view.name === "existing" && (
        <>
          <p role="status">{messages.existing}</p>
          <p>
            {messages.caseRef}: <bdi dir="ltr">{view.case.id.slice(0, 8)}</bdi>
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={buttonClass} onClick={() => void perform("resume")}>
              {messages.resume}
            </button>
            <button type="button" className={buttonClass} onClick={() => setView(askStartOver(view))}>
              {messages.startOver}
            </button>
          </div>
        </>
      )}

      {view.name === "confirmStartOver" && (
        <>
          <p role="alert">{messages.startOverConfirm}</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={buttonClass} onClick={() => void perform("startOver")}>
              {messages.startOverYes}
            </button>
            <button type="button" className={buttonClass} onClick={() => setView(cancelStartOver(view))}>
              {messages.startOverNo}
            </button>
          </div>
        </>
      )}

      {started && (
        <>
          <h2 className="text-xl font-semibold">
            {started.resumed ? messages.resumed : messages.started}
          </h2>
          {/* The only notice of where the case is kept and for how long. */}
          {!started.resumed && <p>{messages.intro}</p>}
          <p>
            {messages.caseRef}: <bdi dir="ltr">{started.case.id.slice(0, 8)}</bdi>
          </p>
          {/* A form in progress skips the existing-case view, so start over must be reachable here. */}
          <div>
            <button
              type="button"
              className={buttonClass}
              aria-disabled={started.saving}
              onClick={() => {
                if (!started.saving) setView(askStartOver(latest.current));
              }}
            >
              {messages.startOver}
            </button>
          </div>
        </>
      )}

      {started && screen === "selector" && (
        <MadhabSelector
          key={started.case.id}
          messages={messages}
          stored={started.case.madhab}
          initialPick={initialPick(deps.selection.get(), started.case)}
          saving={started.saving}
          notice={started.notice}
          onPick={(madhab) => {
            const current = latest.current;
            if (current.name === "started") setView(pick(current, madhab, deps.selection));
          }}
          onSubmit={(madhab) => void perform("choose", { madhab, from: started })}
          onCancel={() => setView(cancelChange(started, deps))}
        />
      )}

      {started && screen === "deceased" && (
        <>
          {madhabBar}
          <DeceasedForm
            key={`deceased-${started.case.id}`}
            messages={messages}
            initial={valuesFor(
              deps.forms.get(),
              started.case.id,
              "deceased",
              null,
              deceasedValues(started.case.deceased),
            )}
            errors={started.errors}
            notice={started.notice}
            saving={started.saving}
            editing={started.case.deceased !== null}
            onChange={(values, field) =>
              track((current) => remember(current, "deceased", values, field, deps.forms))
            }
            onBlur={(field, values) => track((current) => blurField(current, "deceased", field, values))}
            onSubmit={(values: DeceasedValues) =>
              submit((from) => ({ kind: "saveDeceased", from, values }))
            }
            onCancel={() => edit((current) => cancelEditDeceased(current, deps))}
          />
        </>
      )}

      {started && screen === "heirs" && started.case.deceased && (
        <>
          {madhabBar}
          <DeceasedSummary
            messages={messages}
            locale={locale}
            deceased={started.case.deceased}
            disabled={started.saving}
            onEdit={() => edit((current) => startEditDeceased(current, deps))}
          />
          <HeirList
            messages={messages}
            heirs={started.case.heirs}
            editingId={started.editingHeir}
            saving={started.saving}
            announcement={announcement}
            onEdit={(heirId) => edit((current) => startEditHeir(current, heirId, deps))}
            onRemove={(heirId) => submit((from) => ({ kind: "removeHeir", from, heirId }))}
          />
          {started.notice === "heirGone" && <p role="alert">{messages.heirGone}</p>}
          <HeirForm
            key={heirFormKey(started)}
            messages={messages}
            initial={valuesFor(
              deps.forms.get(),
              started.case.id,
              "heir",
              started.editingHeir,
              heirValues(editingHeir),
            )}
            errors={started.errors}
            notice={started.notice}
            saving={started.saving}
            editing={started.editingHeir !== null}
            onChange={(values, field) =>
              track((current) => remember(current, "heir", values, field, deps.forms))
            }
            onBlur={(field, values) => track((current) => blurField(current, "heir", field, values))}
            onSubmit={(values: HeirValues) =>
              submit((from) =>
                from.editingHeir
                  ? { kind: "saveHeir", from, heirId: from.editingHeir, values }
                  : { kind: "addHeir", from, values },
              )
            }
            onCancel={() => edit((current) => cancelEditHeir(current, deps))}
          />
        </>
      )}

      {view.name === "throttled" && (
        <>
          <p role="alert">{messages.throttled}</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={buttonClass} onClick={() => void perform("load")}>
              {messages.recheck}
            </button>
            {resumable && (
              <button type="button" className={buttonClass} onClick={() => void perform("resume")}>
                {messages.resume}
              </button>
            )}
          </div>
        </>
      )}

      {view.name === "failed" && (
        <>
          <p role="alert">{messages.failed}</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={buttonClass} onClick={() => void perform(view.retry)}>
              {messages.retry}
            </button>
            {resumable && (
              <button type="button" className={buttonClass} onClick={() => void perform("resume")}>
                {messages.resume}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  addHeir,
  fetchCase,
  markDeceased,
  removeHeir,
  saveDeceased,
  setMadhab,
  startCase,
  unmarkDeceased,
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
  cancelOrder,
  cancelStartOver,
  heirFormKey,
  openChange,
  openLayer,
  revealOf,
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
import {
  breadcrumb,
  hasDeaths,
  layerAt,
  linkCandidates,
  personOf,
  rowLabels,
  rowsOf,
} from "@/interview/layers";
import { initialPick, selectionStore } from "@/interview/madhabs";
import { scrollTopFor } from "@/interview/tree";

import { DeathBreadcrumb, crumbTextOf } from "./death-breadcrumb";
import { DeceasedForm } from "./deceased-form";
import { FamilyTree } from "./family-tree";
import { buttonClass, errorText } from "./form-bits";
import { DeceasedSummary, HeirList } from "./heir-list";
import { HeirForm } from "./heir-form";
import { MadhabSelector } from "./madhab-selector";
import { RelativesQuestion } from "./relatives-question";
import { OrderQuestion } from "./order-question";
import { SharePreview } from "./share-preview";

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
  markDeceased: (signal, caseId, heirId, first, answers) => markDeceased(signal, caseId, heirId, first, {}, answers),
  unmarkDeceased: (signal, caseId, heirId) => unmarkDeceased(signal, caseId, heirId),
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
  results,
  locale,
}: {
  messages: Messages["interview"];
  results: Messages["results"];
  locale: string;
}) {
  const [view, setView] = useState<View>({ name: "loading" });
  const controller = useRef<AbortController | null>(null);
  const live = useRef(true);
  const latest = useRef<View>(view);
  const target = useRef<HTMLDivElement>(null);
  const previous = useRef<View | null>(null);
  const settledOnce = useRef(false);
  // The announcement last brought into view, compared by identity because `seq` restarts
  // with a new case.
  const revealed = useRef<unknown>(null);

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

  // After a successful add or edit the tree and the heir's node come into view, once. It runs
  // after the focus effect above, so focus stays in the form. Returning from another screen
  // finds the same announcement and does nothing.
  useEffect(() => {
    if (view.name !== "started" || screenOf(view) !== "heirs") return;
    const heirId = revealOf(view);
    if (heirId === null || view.announcement === revealed.current) return;
    revealed.current = view.announcement;
    const root = target.current;
    const section = root?.querySelector<HTMLElement>("[data-tree]");
    const area = section?.querySelector<HTMLElement>("[data-tree-area]");
    const node = area?.querySelector<HTMLElement>(`[data-node="${CSS.escape(heirId)}"]`);
    if (!section || !area || !node) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const behavior: ScrollBehavior = calm ? "instant" : "smooth";
    // The node may still be gliding, so its final place is read from its style.
    const top = scrollTopFor(
      parseFloat(node.style.top) || 0,
      parseFloat(node.style.height) || 0,
      area.scrollTop,
      area.clientHeight,
    );
    if (top !== area.scrollTop) area.scrollTo({ top, behavior });
    section.scrollIntoView({ block: "nearest", behavior });
  }, [view]);

  const resumable = view.name === "throttled" || view.name === "failed" ? view.resumable : null;

  // Every part of the heirs screen works on the active layer.
  const layer = started ? layerAt(started.case, started.layer) : null;
  const editingHeir = layer?.heirs.find((heir) => heir.id === started?.editingHeir);
  const layered = started ? hasDeaths(started.case) : false;
  const crumbs = started && layered ? breadcrumb(started.case, messages.relationships, messages.heirNumbered) : [];
  const activeCrumb = crumbs.find((crumb) => crumb.id === (layer?.id ?? null));
  const layerText = activeCrumb && activeCrumb.id !== null ? crumbTextOf(messages, activeCrumb) : undefined;
  const deceasedIds = new Set(started?.case.deaths.map((death) => death.heir_id) ?? []);
  const candidates =
    started && layer && layer.id !== null
      ? (() => {
          const names = rowLabels(started.case, messages.relationships, messages.heirNumbered, messages.previewOf);
          return linkCandidates(started.case, layer.id).map((row) => ({ id: row.id, label: names[row.id] ?? row.id }));
        })()
      : [];
  const linkedRow = editingHeir?.same_as !== undefined;
  const orderQuestion = (() => {
    if (!started || !layer || started.ordering === null) return null;
    const row = rowsOf(started.case).get(started.ordering)?.row;
    if (!row) return null;
    const names = rowLabels(started.case, messages.relationships, messages.heirNumbered, messages.previewOf);
    const ids = [...started.case.deaths.map((death) => death.heir_id), personOf(row)];
    return {
      rowId: row.id,
      node: (
        <>
        {(started.deathOrderNeeded ?? !started.relativeQuestions?.length) && <OrderQuestion
          messages={messages}
          selected={started.deathFirst}
          choices={ids.map((id) => ({ id, label: names[id] ?? id }))}
          saving={started.saving}
          error={started.errors?.death ? errorText(messages, "death", started.errors) : null}
          onChoose={(first) => {
            if (started.relativeQuestions?.length) edit((current) => ({ ...current, deathFirst: first }));
            else submit((from) => ({ kind: "markDeath", from, rowId: row.id, first }));
          }}
          onCancel={() => edit((current) => cancelOrder(current))}
        />}
        {!!started.relativeQuestions?.length && <>
          {started.errors?.relatives && <p role="alert">{errorText(messages, "relatives", started.errors)}</p>}
          <RelativesQuestion key={JSON.stringify(started.relativeQuestions)} questions={started.relativeQuestions}
            messages={messages} labels={names} saving={started.saving} initial={started.deathAnswers}
            onSubmit={(answers) => submit((from) => ({ kind: "markDeath", from, rowId: row.id, answers }))} />
          <button type="button" className={buttonClass} data-focus="relativesCancel" disabled={started.saving}
            onClick={() => edit((current) => cancelOrder(current))}>{messages.deathOrderCancel}</button>
        </>}
        </>
      ),
    };
  })();
  const deathError = started?.ordering === null
    ? [errorText(messages, "death", started.errors), errorText(messages, "relatives", started.errors)].filter(Boolean).join(" ") || null
    : null;

  const announced = started?.announcement ?? null;
  const announcementTemplates = {
    added: "heirAdded",
    updated: "heirUpdated",
    removed: "heirRemoved",
    deathMarked: "deathMarked",
    deathUnmarked: "deathUnmarked",
  } as const;
  const announcement = announced
    ? {
        seq: announced.seq,
        template: messages[announcementTemplates[announced.kind]],
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
    <div data-js-only ref={target} tabIndex={-1} className="flex flex-col gap-4 outline-none [&>*:not(form,[data-wide])]:mx-auto [&>*:not(form,[data-wide])]:w-full [&>*:not(form,[data-wide])]:max-w-xl">
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
          {layered && (
            <DeathBreadcrumb
              messages={messages}
              crumbs={crumbs}
              active={layer?.id ?? null}
              disabled={started.saving}
              onOpen={(id) => edit((current) => openLayer(current, id, deps))}
            />
          )}
          <FamilyTree
            messages={messages}
            gender={layer?.gender ?? started.case.deceased.gender}
            rootText={layerText}
            heirs={layer?.heirs ?? started.case.heirs}
            editingId={started.editingHeir}
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
            options={layer?.options ?? started.case.heir_options}
            candidates={candidates}
            linked={linkedRow}
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
          <SharePreview messages={messages} results={results} locale={locale} kase={started.case} />
          <HeirList
            key={layer?.id ?? "first"}
            messages={messages}
            kase={started.case}
            heirs={layer?.heirs ?? started.case.heirs}
            editingId={started.editingHeir}
            saving={started.saving}
            announcement={announcement}
            heading={
              activeCrumb && activeCrumb.label !== null
                ? messages.heirsOfHeading.split("{heir}").join(activeCrumb.label)
                : undefined
            }
            deceasedIds={deceasedIds}
            deathError={deathError}
            asking={orderQuestion}
            onEdit={(heirId) => edit((current) => startEditHeir(current, heirId, deps))}
            onRemove={(heirId) => submit((from) => ({ kind: "removeHeir", from, heirId }))}
            onAlsoDied={(rowId) => submit((from) => ({ kind: "markDeath", from, rowId }))}
            onOpenLayer={(personId) => edit((current) => openLayer(current, personId, deps))}
            onDidNotDie={(personId, rowId) =>
              submit((from) => ({ kind: "unmarkDeath", from, heirId: personId, rowId }))
            }
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

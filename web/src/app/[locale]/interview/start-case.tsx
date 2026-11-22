"use client";
import type { PresentedResult } from "@/contracts/presented";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  addHeir,
  addHeirs,
  MAX_HEIRS,
  fetchCase,
  markDeceased,
  removeHeir,
  restoreCase,
  saveDeceased,
  setMadhab,
  startCase,
  unmarkDeceased,
  updateHeir,
  type MadhabId,
  type PlacementOption,
  type RelationshipId,
} from "@/api/case";
import type { Messages } from "@/i18n/messages";
import {
  deceasedValues,
  formStore,
  heirLabel,
  valuesFor,
  type DeceasedValues,
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
  historyOf,
  openChange,
  openLayer,
  revealOf,
  requestCardRemoval,
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
  estatePath,
  hasDeaths,
  layerAt,
  personOf,
  placementRootOf,
  rowLabels,
  rowsOf,
} from "@/interview/layers";
import { initialPick, selectionStore } from "@/interview/madhabs";
import { dropEntry, estateModel, scrollDelta, treeDescription } from "@/interview/tree";
import { createCoalescer, type AnnounceKind } from "@/interview/announce";
import { previewKey } from "@/interview/preview";
import { addGroups } from "@/interview/relatives";

import { AddRelatives, outcomeText } from "./add-relatives";
import { DeathBreadcrumb, crumbTextOf } from "./death-breadcrumb";
import { DeceasedForm } from "./deceased-form";
import { EditSheet } from "./edit-sheet";
import { FamilyTree } from "./family-tree";
import { buttonClass, errorText, SaveNotice, WithHeir } from "./form-bits";
import { DeceasedSummary, HeirList } from "./heir-list";
import { MadhabSelector } from "./madhab-selector";
import { useOnline } from "./online";
import { RelativesQuestion } from "./relatives-question";
import { OrderQuestion } from "./order-question";
import { SharePreview } from "./share-preview";
import { isUndoShortcut, UndoButton, UndoToast } from "./undo-toast";

const SEEN_KEY = "mawareeth.case-seen";

// A remembered flag is the only way to tell "expired" from "never started". It is a
// convenience: when storage is blocked the page simply offers a new case.
const deps: Deps = {
  fetchCase: (signal) => fetchCase(signal),
  startCase: (signal, options) => startCase(signal, options),
  setMadhab: (signal, madhab, caseId, revision) => setMadhab(signal, madhab, caseId, revision),
  saveDeceased: (signal, caseId, revision, fields) => saveDeceased(signal, caseId, revision, fields),
  addHeir: (signal, caseId, revision, fields) => addHeir(signal, caseId, revision, fields),
  addHeirs,
  updateHeir: (signal, caseId, revision, heirId, fields) => updateHeir(signal, caseId, revision, heirId, fields),
  removeHeir,
  markDeceased: (signal, caseId, revision, heirId, first, answers) =>
    markDeceased(signal, caseId, revision, heirId, first, {}, answers),
  unmarkDeceased: (signal, caseId, revision, heirId) => unmarkDeceased(signal, caseId, revision, heirId),
  restoreCase,
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
  const [presented, setPresented] = useState<{ key: string; value: PresentedResult | null } | null>(null);
  // The one polite status: what it says now, and a counter so an identical sentence is spoken again.
  const [spoken, setSpoken] = useState<{ text: string; seq: number }>({ text: "", seq: 0 });
  const [choiceFailed, setChoiceFailed] = useState(false);
  // Story 9.7: the relationship chip being dragged, and the alert of a drop the placement refuses.
  const [dragChip, setDragChip] = useState<RelationshipId | null>(null);
  const [dropAlert, setDropAlert] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const live = useRef(true);
  const latest = useRef<View>(view);
  const target = useRef<HTMLDivElement>(null);
  const previous = useRef<View | null>(null);
  const settledOnce = useRef(false);
  // The announcement last brought into view, compared by identity because `seq` restarts
  // with a new case.
  const revealed = useRef<unknown>(null);
  const coalescer = useRef<ReturnType<typeof createCoalescer> | null>(null);
  const post = useCallback((kind: AnnounceKind, text: string) => {
    coalescer.current ??= createCoalescer((sentence) => setSpoken((was) => ({ text: sentence, seq: was.seq + 1 })));
    coalescer.current.post(kind, text);
  }, []);
  const drop = useCallback((...kinds: AnnounceKind[]) => coalescer.current?.drop(...kinds), []);
  useEffect(() => () => coalescer.current?.cancel(), []);

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
      latest.current = pendingView(action, latest.current);
      setView(latest.current);
      const next = await runAction(action, own.signal, deps, existing, choice, answer);
      if (live.current && controller.current === own) {
        // A failure notice belongs to the school choice only when the choice made it.
        setChoiceFailed(action === "choose");
        setView(next);
      }
    },
    [],
  );

  // A save is refused while another is in flight, and checked here before anything is sent.
  const submit = useCallback(
    (make: (from: StartedView) => Answer) => {
      const current = latest.current;
      if (current.name !== "started" || current.saving || !navigator.onLine) return;
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

  // Undo takes back the latest family change; it does nothing while saving, offline or with no history.
  const undo = useCallback(() => {
    const current = latest.current;
    if (current.name !== "started" || current.saving || !navigator.onLine || historyOf(current).length === 0) return;
    void perform("undo", undefined, { kind: "undo", from: current });
  }, [perform]);

  // Ctrl/Cmd+Z outside text fields; inside them the browser's own undo keeps working.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isUndoShortcut(event)) return;
      const current = latest.current;
      if (current.name !== "started" || current.saving || !navigator.onLine || historyOf(current).length === 0) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false])")) return;
      event.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

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
  const online = useOnline();
  // A save in flight or no connection: every edit control is disabled.
  const frozen = started !== null && (started.saving || !online);
  const focusRequest = started?.focus ?? null;

  // A control inside a screen asked for focus: the first invalid field, the cleared form,
  // or the row a change came from.
  useEffect(() => {
    if (!focusRequest) return;
    // The control may be gone (an open question whose row went away): the screen takes focus.
    const control = target.current?.querySelector<HTMLElement>(`[data-focus="${CSS.escape(focusRequest.target)}"]`);
    // An add button that is gone (a father was just added) hands focus to the panel's heading.
    const fallback = focusRequest.target.startsWith("add:")
      ? target.current?.querySelector<HTMLElement>("#add-relatives-heading")
      : null;
    (control ?? fallback ?? target.current)?.focus();
  }, [focusRequest]);

  // After a successful add or edit the tree and the heir's node come into view, once. It runs
  // after the focus effect above, so focus stays in the form. Returning from another screen
  // finds the same announcement and does nothing.
  const pendingReveal = useRef<(() => void) | null>(null);
  useEffect(() => () => pendingReveal.current?.(), []);
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
    // Only the canvas scrolls, by the least amount on each axis; browser geometry includes the
    // canvas scale. `scrollIntoView` on the node would also scroll the page.
    const reveal = () => {
      const a = area.getBoundingClientRect();
      const n = node.getBoundingClientRect();
      const top = scrollDelta(n.top, n.bottom, a.top, a.top + area.clientHeight);
      const left = scrollDelta(n.left, n.right, a.left, a.left + area.clientWidth);
      if (top !== 0 || left !== 0) area.scrollBy({ top, left, behavior });
      section.scrollIntoView({ block: "nearest", behavior });
    };
    if (calm) { reveal(); return; }
    // The card may still be gliding to its new place: measure once its reflow ends, or after 350ms.
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      node.removeEventListener("transitionend", finish);
      pendingReveal.current = null;
      reveal();
    };
    const timer = setTimeout(finish, 350);
    node.addEventListener("transitionend", finish);
    pendingReveal.current = () => { done = true; clearTimeout(timer); node.removeEventListener("transitionend", finish); };
  }, [view]);

  const resumable = view.name === "throttled" || view.name === "failed" ? view.resumable : null;

  // Every part of the heirs screen works on the active layer.
  const currentPreviewKey = started ? previewKey(started.case) : "";
  const reportPresented = useCallback((value: PresentedResult | null) => setPresented({ key: currentPreviewKey, value }), [currentPreviewKey]);
  const layer = started ? layerAt(started.case, started.layer) : null;
  const layered = started ? hasDeaths(started.case) : false;
  const allCrumbs = started && layered ? breadcrumb(started.case, messages.relationships, messages.heirNumbered) : [];
  const path = started && layered ? estatePath(started.case, layer?.id ?? null) : [];
  const crumbs = path.flatMap((id) => allCrumbs.find((crumb) => crumb.id === id) ?? []);
  const activeCrumb = crumbs.find((crumb) => crumb.id === (layer?.id ?? null));
  const layerText = activeCrumb && activeCrumb.id !== null ? crumbTextOf(messages, activeCrumb) : undefined;
  const model = started ? estateModel(started.case, layer?.id ?? null, presented?.key === previewKey(started.case) ? presented.value : null) : { people: [], placement: {} };
  const description = treeDescription(messages, model, layerText);
  const deceasedIds = new Set(started?.case.deaths.map((death) => death.heir_id) ?? []);
  const editingPerson = model.people.find(p => p.id === started?.editingHeir);
  const relativeGroups = started && layer ? addGroups(placementRootOf(started.case, layer.id), layer.options) : [];
  const remaining = MAX_HEIRS - (layer?.heirs.length ?? 0);
  // From 1280px the first estate has a third column for the Share preview; a later estate keeps two.
  const previewColumn = layer?.id == null;
  const treeText = started?.tree ? outcomeText(messages, started.tree) : null;
  const treeInSheet = !!editingPerson && started?.tree?.anchor === editingPerson.personId;
  // One positioned add, by touch, keyboard or drop: the same request for each.
  const addAt = (anchor: string, entry: PlacementOption) => {
    setDropAlert(null);
    submit((from) => ({
      kind: "addHeir",
      from,
      values: { relationship: entry.relationship, name: "", same_as: "" },
      origin: "tree",
      anchor,
    }));
  };
  const dropOn = (chip: RelationshipId, target: { anchor: string; link?: string }) => {
    const entry = dropEntry(model, target.anchor, chip, target.link as PlacementOption["link"] | undefined);
    if (entry) addAt(target.anchor, entry);
    else {
      setDropAlert(messages.notAllowedHere.replace(
        "{reason}", messages.positionNotAllowed.replace("{relationship}", messages.relationships[chip])));
    }
  };
  // One way to open an estate: from a card, a row, the sheet or the breadcrumb.
  const openEstate = (id: string | null) => edit((current) => openLayer(current, id, deps, "treeHeading"));
  const orderQuestion = (() => {
    if (!started || !layer || started.ordering === null || started.sheetDeath) return null;
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
          saving={frozen}
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
            messages={messages} labels={names} saving={frozen} initial={started.deathAnswers}
            onSubmit={(answers) => submit((from) => ({ kind: "markDeath", from, rowId: row.id, answers }))} />
          <button type="button" className={buttonClass} data-focus="relativesCancel" disabled={frozen}
            onClick={() => edit((current) => cancelOrder(current))}>{messages.deathOrderCancel}</button>
        </>}
        </>
      ),
    };
  })();
  // The order question of a later death chosen in the edit sheet is asked in the sheet.
  const sheetOrder = (() => {
    if (!started || started.ordering === null || !started.sheetDeath) return null;
    const row = rowsOf(started.case).get(started.ordering)?.row;
    if (!row) return null;
    return function renderOrder(name?: string | null) {
    const names = rowLabels(started.case, messages.relationships, messages.heirNumbered, messages.previewOf);
    const ids = [...started.case.deaths.map((death) => death.heir_id), personOf(row)];
    const nameField = name === undefined ? {} : { name };
    const asked = !!started.relativeQuestions?.length;
    return (
      <>
        {(started.deathOrderNeeded ?? !asked) && <OrderQuestion
          messages={messages}
          selected={started.deathFirst}
          choices={ids.map((id) => ({ id, label: names[id] ?? id }))}
          saving={frozen}
          error={started.errors?.death ? errorText(messages, "death", started.errors) : null}
          onChoose={(first) => {
            if (asked) edit((current) => ({ ...current, deathFirst: first }));
            else submit((from) => ({ kind: "markDeath", from, rowId: row.id, first, origin: "sheet", ...nameField }));
          }}
          onCancel={() => edit((current) => cancelOrder(current))}
        />}
        {asked && <>
          {started.errors?.relatives && <p role="alert">{errorText(messages, "relatives", started.errors)}</p>}
          <RelativesQuestion key={JSON.stringify(started.relativeQuestions)} questions={started.relativeQuestions!}
            messages={messages} labels={names} saving={frozen} initial={started.deathAnswers}
            onSubmit={(answers) => submit((from) => ({ kind: "markDeath", from, rowId: row.id, answers, origin: "sheet", ...nameField }))} />
          <button type="button" className={buttonClass} data-focus="relativesCancel" disabled={frozen}
            onClick={() => edit((current) => cancelOrder(current))}>{messages.deathOrderCancel}</button>
        </>}
      </>
    );
    };
  })();
  const deathError = started?.ordering === null && !started.sheetDeath
    ? [errorText(messages, "death", started.errors), errorText(messages, "relatives", started.errors)].filter(Boolean).join(" ") || null
    : null;

  const announced = started?.announcement ?? null;
  const groupCount = announced?.panelCount ?? 1;
  const announcementTemplates = {
    added: "heirAdded",
    updated: "heirUpdated",
    linked: "heirLinked",
    unlinked: "heirUnlinked",
    removed: "heirRemoved",
    deathMarked: "deathMarked",
    laterDeath: "laterDeathAddedMale",
    deathUnmarked: "deathUnmarked",
    undone: "undoDone",
  } as const;
  const noteTemplate = (note: NonNullable<typeof announced>) =>
    note.kind === "laterDeath"
      ? (note.gender === "female" ? messages.laterDeathAddedFemale : messages.laterDeathAddedMale)
      : messages[announcementTemplates[note.kind]];
  const announcement = announced
    ? {
        template: groupCount > 1 && announced.kind === "added"
          ? messages.heirsAdded.replace("{count}", String(groupCount)).replace("{relationship}", "{heir}")
          : noteTemplate(announced),
        heir: announced.kind === "undone" ? "" : groupCount > 1 && announced.kind === "added"
          ? messages.relationships[announced.heir.relationship]
          : heirLabel(announced.heir, messages.relationships, messages.heirNumbered, announced.ordinal),
      }
    : null;

  // Each new change is posted once, by identity; returning to a screen finds the same one and says nothing.
  const posted = useRef<unknown>(null);
  useEffect(() => {
    if (!announced || announced === posted.current) return;
    posted.current = announced;
    if (announcement) post("action", announcement.template.split("{heir}").join(announcement.heir));
  });

  const undoOffer = started !== null && historyOf(started).length > 0;
  const undoDisabled = started !== null && (started.saving || !online);
  const toast = started?.undoToast ?? null;
  const toastCount = toast && toast.announcement.kind === "added" ? (toast.announcement.panelCount ?? 1) : 1;

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
    <div data-js-only ref={target} tabIndex={-1} className="relative flex flex-col gap-4 outline-none [&>*:not(form,[data-wide])]:mx-auto [&>*:not(form,[data-wide])]:w-full [&>*:not(form,[data-wide])]:max-w-xl">
      {/* The one routine status of the Interview; always mounted so its changes are spoken. */}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {spoken.text !== "" && <span key={spoken.seq}>{spoken.text}</span>}
      </p>
      {view.name === "loading" && (
        <div data-wide data-skeleton aria-busy="true" className="grid grid-cols-1 gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
          <p className="sr-only">{messages.loading}</p>
          <div aria-hidden="true" className="flex flex-col gap-3">
            <div className="h-3 w-1/2 rounded-full bg-surface" />
            <div className="h-3 w-full rounded-full bg-surface" />
            <div className="h-3 w-5/6 rounded-full bg-surface" />
            <div className="h-3 w-2/3 rounded-full bg-surface" />
          </div>
          <div aria-hidden="true" className="flex flex-col gap-3">
            <div className="h-3 w-1/3 rounded-full bg-surface" />
            <div className="h-3 w-full rounded-full bg-surface" />
            <div className="h-3 w-full rounded-full bg-surface" />
            <div className="h-3 w-3/4 rounded-full bg-surface" />
            <div className="h-3 w-full rounded-full bg-surface" />
          </div>
          <div aria-hidden="true" className="flex flex-col gap-3">
            <div className="h-3 w-1/3 rounded-full bg-surface" />
            <div className="h-3 w-full rounded-full bg-surface" />
            <div className="h-3 w-5/6 rounded-full bg-surface" />
          </div>
        </div>
      )}
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
            {undoOffer && <span className="ms-3"><UndoButton messages={messages} disabled={undoDisabled} onUndo={undo} /></span>}
          </div>
          {started.undoFailed && <p role="alert">{messages.undoFailed}</p>}
        </>
      )}

      {started && screen === "selector" && started.conflict && <p role="alert">{messages.conflictNotice}</p>}
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

      {started && !online && (screen === "deceased" || screen === "heirs") && (
        <p role="status" className="text-sm">{messages.offlineEditing}</p>
      )}

      {started && screen === "deceased" && (
        <>
          {madhabBar}
          {started.conflict && <p role="alert">{messages.conflictNotice}</p>}
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
            saving={frozen}
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
            disabled={frozen}
            onEdit={() => edit((current) => startEditDeceased(current, deps))}
          />
          <div
            data-wide
            className={`grid grid-cols-1 gap-4 lg:grid-cols-[380px_minmax(0,1fr)] lg:gap-0 ${previewColumn ? "xl:grid-cols-[380px_minmax(0,1fr)_340px]" : ""}`}
          >
            <section
              aria-labelledby="add-relatives-heading"
              className="flex min-w-0 flex-col gap-4 lg:col-start-1 lg:row-start-1 lg:pe-4 lg:pb-4"
            >
              {started.notice === "heirGone" && <p role="alert">{messages.heirGone}</p>}
              <AddRelatives
                key={layer?.id ?? "first"}
                messages={messages}
                groups={relativeGroups}
                remaining={remaining}
                atLimit={remaining <= 0}
                completed={announced?.panelCount ? announced : null}
                disabled={frozen}
                outcome={started.panel}
                onDragStart={(chip) => { setDropAlert(null); setDragChip(chip); }}
                onDragEnd={() => setDragChip(null)}
                onDrop={dropOn}
                onAdd={(relationship, count) =>
                  submit((from) => ({
                    kind: "addHeir",
                    count,
                    from,
                    values: { relationship, name: "", same_as: "" },
                    origin: "panel",
                  }))
                }
              />
              {started.conflict && !editingPerson && <p role="alert">{messages.conflictNotice}</p>}
              {!editingPerson && <SaveNotice messages={messages} notice={started.notice} saving={frozen} />}
            </section>
            {/* One column down to 1280px; from there, with the preview column, its children are grid items so the panel can sit in the inline-end column. */}
            <div className={`min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:border-s lg:border-line lg:ps-4 ${previewColumn ? "xl:contents" : ""}`}>
              <div className={`min-w-0 ${previewColumn ? "xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:border-s xl:border-line xl:px-4" : ""}`}>
              <FamilyTree
                messages={messages}
                model={model}
                locale={locale}
                onAnnounce={text => post("zoom", text)}
                rootText={layerText}
                editingId={started.editingHeir}
                frozen={frozen}
                dragging={dragChip}
                atLimit={remaining <= 0}
                addOutcome={treeText && started.tree && !treeInSheet ? { anchor: started.tree.anchor, text: treeText } : null}
                dropAlert={dropAlert}
                onAddHere={addAt}
                onOpenEstate={openEstate}
                breadcrumb={<DeathBreadcrumb
                  messages={messages}
                  crumbs={crumbs}
                  active={layer?.id ?? null}
                  disabled={frozen}
                  onOpen={openEstate}
                />}
                onEdit={id => edit(current => startEditHeir(current, id, deps, `card:${id}`))}
                onRemoveRequest={id => model.people.find(p => p.id === id)?.state === "died_later"
                  // A died-later card has no edit surface: it uses the Heirs-row removal confirmation.
                  ? submit(from => ({ kind: "removeHeir", from, heirId: id, fromRow: true, confirm: false }))
                  : edit(current => requestCardRemoval(current, id, deps))}
              />
              </div>
              {editingPerson && <div className={`min-w-0 sm:mt-3 ${previewColumn ? "xl:col-start-3 xl:row-start-1 xl:mt-0 xl:border-s xl:border-line xl:p-6" : ""}`}><EditSheet key={editingPerson.id} messages={messages} view={started}
                person={editingPerson} label={description.people.find(p => p.id === editingPerson.id)!.label}
                frozen={frozen} onClose={() => edit(current => cancelEditHeir(current, deps))}
                entries={model.placement[editingPerson.personId] ?? []} atLimit={remaining <= 0}
                addAlert={treeInSheet ? treeText : null} onAddHere={entry => addAt(editingPerson.personId, entry)}
                orderQuestion={sheetOrder}
                onMarkLater={name => submit(from => ({ kind: "markDeath", from, rowId: editingPerson.id, origin: "sheet", ...(name === undefined ? {} : { name }) }))}
                onOpenEstate={name => name === undefined ? openEstate(editingPerson.personId)
                  : submit(from => ({ kind: "saveHeir", from, heirId: editingPerson.id, values: { relationship: editingPerson.relationship, name: name ?? "" }, field: "name", openEstate: editingPerson.personId }))}
                onSave={(fields, field, close) => submit(from => ({ kind: "saveHeir", from, heirId: editingPerson.id,
                  values: { relationship: fields.relationship, name: fields.name ?? "" }, status: fields.status,
                  ...(fields.same_as !== undefined ? { link: fields.same_as } : {}), field, close }))}
                onRemove={confirm => submit(from => ({ kind: "removeHeir", from, heirId: editingPerson.id, confirm }))}
              /></div>}
            </div>
            <div className="min-w-0 lg:col-start-1 lg:row-start-2 lg:pe-4">
              <HeirList
                key={layer?.id ?? "first"}
                messages={messages}
                heirs={layer?.heirs ?? started.case.heirs}
                editingId={started.editingHeir}
                saving={frozen}
                description={description}
                heading={
                  activeCrumb && activeCrumb.label !== null
                    ? messages.heirsOfHeading.split("{heir}").join(activeCrumb.label)
                    : undefined
                }
                deceasedIds={deceasedIds}
                deathError={deathError}
                asking={orderQuestion}
                onEdit={(heirId) => edit((current) => startEditHeir(current, heirId, deps))}
                onRemove={(heirId) => submit((from) => ({ kind: "removeHeir", from, heirId, fromRow: true, confirm: false }))}
                onAlsoDied={(rowId) => submit((from) => ({ kind: "markDeath", from, rowId }))}
                onOpenLayer={openEstate}
                onDidNotDie={(personId, rowId) =>
                  submit((from) => ({ kind: "unmarkDeath", from, heirId: personId, rowId }))
                }
                undo={undoOffer ? { disabled: undoDisabled, onUndo: undo } : undefined}
              />
              {toast && (
                <UndoToast key={toast.key} messages={messages} disabled={undoDisabled} onUndo={undo}>
                  <WithHeir
                    template={toastCount > 1
                      ? messages.heirsAdded.replace("{count}", String(toastCount)).replace("{relationship}", "{heir}")
                      : noteTemplate(toast.announcement)}
                    heir={toastCount > 1
                      ? messages.relationships[toast.announcement.heir.relationship]
                      : heirLabel(toast.announcement.heir, messages.relationships, messages.heirNumbered, toast.announcement.ordinal)}
                  />
                </UndoToast>
              )}
            </div>
            {/* Kept mounted while a later estate is open, so evidence keeps reaching the tree; just not shown. */}
            {(
              <div hidden={layer?.id != null} className={`min-w-0 lg:col-span-2 lg:col-start-1 lg:row-start-3 lg:mt-4 xl:col-span-1 xl:col-start-3 xl:mt-0 xl:border-s xl:border-line xl:p-6 ${editingPerson ? "xl:row-start-2" : "xl:row-span-2 xl:row-start-1"}`}>
                <SharePreview
                  messages={messages}
                  results={results}
                  locale={locale}
                  onPresented={reportPresented}
                  post={post}
                  drop={drop}
                  heirCount={layer?.heirs.length ?? started.case.heirs.length}
                  kase={started.case}
                  saving={frozen}
                  failed={choiceFailed && (started.notice === "failed" || started.notice === "throttled") ? started.notice : null}
                  onChooseSchool={(madhab) => void perform("choose", { madhab, from: started })}
                />
              </div>
            )}
          </div>
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

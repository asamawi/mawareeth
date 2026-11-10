import type {
  AnswerResult,
  RelativeQuestion,
  RelativeAnswers,
  Case,
  DeceasedFields,
  Heir,
  HeirFields,
  MadhabId,
  MadhabResult,
  RelationshipId,
  StartResult,
} from "../api/case.ts";
import {
  BLANK_HEIR,
  unnamedOrdinal,
  deceasedValues,
  firstInvalid,
  formFor,
  heirLimitReached,
  heirValues,
  relationshipIssue,
  validateDeceased,
  validateField,
  validateHeir,
  type DeceasedValues,
  type Errors,
  type FormName,
  type FormStore,
  type HeirValues,
} from "./answers.ts";
import { keepLayer, layerAt, rowsOf } from "./layers.ts";
import { selectionFor, type SelectionStore } from "./madhabs.ts";

export type Action =
  | "load"
  | "start"
  | "startOver"
  | "resume"
  | "choose"
  | "saveDeceased"
  | "addHeir"
  | "saveHeir"
  | "removeHeir"
  | "markDeath"
  | "unmarkDeath";

/** A write that did not go through, or a list that changed under the visitor. */
export type Notice = "throttled" | "failed" | "heirGone";

/** What the screen-reader live region says; `seq` makes a repeat count as new. */
export type Announcement = {
  kind: "added" | "updated" | "removed" | "deathMarked" | "deathUnmarked";
  /** The id of the heir the change was about. */
  id: string;
  heir: { name: string | null; relationship: RelationshipId };
  /** The heir number among unnamed heirs of the same relationship, when there are several. */
  ordinal: number | null;
  seq: number;
};

/**
 * Every focus target flow.ts can ask for. Each is a `data-focus` value in the components, and
 * a test reads their source to prove it.
 */
export const FOCUS_TARGETS = [
  "gender",
  "estate",
  "relationship",
  "name",
  "form-error",
  "list",
  "same_as",
  "death-order",
  "relatives",
  "relativeMother",
  "relativesSubmit",
] as const;
export const FOCUS_PREFIXES = ["editHeir", "remove", "alsoDied", "relative"] as const;
export type FocusTarget =
  | (typeof FOCUS_TARGETS)[number]
  | `${(typeof FOCUS_PREFIXES)[number]}:${string}`;

/** Where to move focus: a `data-focus` id on the page. `seq` makes a repeat count as new. */
export type FocusRequest = { target: FocusTarget; seq: number };

export type StartedView = {
  name: "started";
  case: Case;
  resumed: boolean;
  /** The visitor opened the selector although a school is stored. */
  changing: boolean;
  /** The visitor opened the deceased form although one is stored. */
  editingDeceased: boolean;
  /** The heir whose details are in the heir form; null when the form adds a new heir. */
  editingHeir: string | null;
  /**
   * The layer every part of the heirs screen works on: null for the first deceased, else the
   * `heir_id` of a later death. It falls back to null whenever that death no longer exists.
   */
  layer: string | null;
  /** The row whose death has open order or relatives questions; null when none is open. */
  ordering: string | null;
  relativeQuestions?: RelativeQuestion[];
  deathAnswers?: RelativeAnswers;
  deathFirst?: string;
  deathOrderNeeded?: boolean;
  /** Counts the times the heir form had to be cleared, so only those rebuild it. */
  formEpoch: number;
  notice: Notice | null;
  /** Field name to error code, from the client's rules or from the server. */
  errors: Errors | null;
  focus: FocusRequest | null;
  announcement: Announcement | null;
  saving: boolean;
};

export type View =
  | { name: "loading" }
  | { name: "starting" }
  | { name: "none"; expired: boolean }
  | { name: "existing"; case: Case }
  /** Starting over throws the answers away, so it is asked first. */
  | { name: "confirmStartOver"; case: Case }
  | StartedView
  /** Over the limit: the visitor can re-check, and resume a case that is still valid. */
  | { name: "throttled"; resumable: Case | null }
  /** The same action can be tried again, one attempt per click. */
  | { name: "failed"; retry: Action; resumable: Case | null };

export type Deps = {
  fetchCase: (signal: AbortSignal) => Promise<Case | null>;
  startCase: (
    signal: AbortSignal,
    options: { replace: boolean; caseId?: string },
  ) => Promise<StartResult>;
  setMadhab: (signal: AbortSignal, madhab: MadhabId, caseId: string) => Promise<MadhabResult>;
  saveDeceased: (signal: AbortSignal, caseId: string, fields: DeceasedFields) => Promise<AnswerResult>;
  addHeir: (signal: AbortSignal, caseId: string, fields: HeirFields) => Promise<AnswerResult>;
  updateHeir: (
    signal: AbortSignal,
    caseId: string,
    heirId: string,
    fields: HeirFields,
  ) => Promise<AnswerResult>;
  removeHeir: (signal: AbortSignal, caseId: string, heirId: string) => Promise<AnswerResult>;
  markDeceased: (signal: AbortSignal, caseId: string, heirId: string, first?: string, answers?: RelativeAnswers) => Promise<AnswerResult>;
  unmarkDeceased: (signal: AbortSignal, caseId: string, heirId: string) => Promise<AnswerResult>;
  /** Whether this browser has seen a case before; the only way to tell expired from new. */
  seen: { get: () => boolean; set: (value: boolean) => void };
  /** The selection in progress in this tab. */
  selection: SelectionStore;
  /** The form open in this tab. */
  forms: FormStore;
};

export type Screen =
  | "loading"
  | "starting"
  | "none"
  | "existing"
  | "confirmStartOver"
  | "selector"
  | "deceased"
  | "heirs"
  | "throttled"
  | "failed";

/**
 * Which screen a view shows: a case with no school, or one being changed, shows the selector;
 * then a case with no deceased, or one being edited, shows the deceased form; then the heirs.
 */
export function screenOf(view: View): Screen {
  if (view.name !== "started") return view.name;
  if (view.case.madhab === null || view.changing) return "selector";
  if (view.case.deceased === null || view.editingDeceased) return "deceased";
  return "heirs";
}

/**
 * Whether to move focus when `next` replaces `previous`. Focus moves only when the screen
 * changes: never while a save is in flight or has failed, and never for an in-place edit
 * such as a pick or a notice being cleared, which would pull focus off the control.
 */
export function shouldFocus(previous: View | null, next: View): boolean {
  if (next.name === "loading" || next.name === "starting") return false;
  if (next.name === "started") {
    if (next.saving || next.notice !== null) return false;
    if (previous?.name === "started" && previous.case.id === next.case.id) {
      return screenOf(previous) !== screenOf(next);
    }
  }
  return true;
}

/** Remembers the visitor's pick for this case and clears an earlier failure notice. */
export function pick(view: StartedView, madhab: MadhabId, store: SelectionStore): StartedView {
  if (view.saving) return view;
  store.set({ caseId: view.case.id, madhab });
  return view.notice === null ? view : { ...view, notice: null };
}

function started(kase: Case, resumed: boolean, changing = false): StartedView {
  return {
    name: "started",
    case: kase,
    resumed,
    changing,
    editingDeceased: false,
    editingHeir: null,
    layer: null,
    ordering: null,
    formEpoch: 0,
    notice: null,
    errors: null,
    focus: null,
    announcement: null,
    saving: false,
  };
}

/** The case a view is about, if any. */
export function caseOf(view: View): Case | null {
  if (view.name === "existing" || view.name === "confirmStartOver" || view.name === "started") {
    return view.case;
  }
  if (view.name === "throttled" || view.name === "failed") return view.resumable;
  return null;
}

/** The heir form is rebuilt when its heir changes or it was cleared, and not otherwise. */
export function heirFormKey(view: StartedView): string {
  return `heir-${view.editingHeir ?? "new"}-${view.formEpoch}`;
}

function nextFocus(view: StartedView, target: FocusTarget): FocusRequest {
  return { target, seq: (view.focus?.seq ?? 0) + 1 };
}

/** What to show while the action is in flight. */
export function pendingView(action: Action, current?: View): View {
  if (action === "load" || action === "resume") return { name: "loading" };
  if (action === "start" || action === "startOver") return { name: "starting" };
  if (current?.name !== "started") return { name: "loading" };
  // The announcement stays, so the form below it is not rebuilt (and loses focus) mid-save.
  return { ...current, notice: null, errors: null, saving: true };
}

/** Opens the selector on the first question, with the current choice selected. */
export function openChange(view: StartedView, deps: Deps): StartedView {
  deps.selection.set({ caseId: view.case.id, madhab: null });
  return { ...view, changing: true, notice: null, errors: null };
}

/** Closes the selector without writing anything. */
export function cancelChange(view: StartedView, deps: Deps): StartedView {
  deps.selection.set(null);
  return { ...view, changing: false, notice: null };
}

/** Asks the visitor to confirm before the answers are thrown away. */
export function askStartOver(view: View): View {
  return view.name === "existing" || view.name === "started"
    ? { name: "confirmStartOver", case: view.case }
    : view;
}

/** Cancelling changes nothing. */
export function cancelStartOver(view: View): View {
  return view.name === "confirmStartOver" ? { name: "existing", case: view.case } : view;
}

function writeForm(
  deps: Deps,
  caseId: string,
  form: FormName,
  heirId: string | null,
  values: Record<string, string>,
) {
  deps.forms.set({ caseId, form, heirId, values, layer: formFor(deps.forms.get(), caseId)?.layer ?? null });
}

/** The new-heir draft that is open now, or the one already set aside. */
function draftOf(deps: Deps, caseId: string): Record<string, string> | undefined {
  const record = formFor(deps.forms.get(), caseId);
  if (!record || record.form !== "heir") return record?.parked;
  return record.heirId === null ? record.values : record.parked;
}

/** A blank new-heir form; any draft that was set aside is dropped. */
function resetHeirForm(deps: Deps, caseId: string) {
  writeForm(deps, caseId, "heir", null, { ...BLANK_HEIR });
}

/** The new-heir form again, with the draft that was set aside while an edit was open. */
function restoreHeirForm(deps: Deps, caseId: string) {
  const parked = formFor(deps.forms.get(), caseId)?.parked;
  writeForm(deps, caseId, "heir", null, { ...BLANK_HEIR, ...(parked ?? {}) });
}

function writeParked(
  deps: Deps,
  caseId: string,
  form: FormName,
  heirId: string | null,
  values: Record<string, string>,
  parked: Record<string, string> | undefined,
) {
  deps.forms.set({ caseId, form, heirId, values, layer: formFor(deps.forms.get(), caseId)?.layer ?? null, ...(parked ? { parked } : {}) });
}

/** Opens the deceased form filled in with what is stored. */
export function startEditDeceased(view: StartedView, deps: Deps): StartedView {
  const draft = draftOf(deps, view.case.id);
  writeParked(deps, view.case.id, "deceased", null, { ...deceasedValues(view.case.deceased) }, draft);
  return { ...view, editingDeceased: true, editingHeir: null, notice: null, errors: null };
}

/** Closes the deceased form without writing anything; the heir form is as it was. */
export function cancelEditDeceased(view: StartedView, deps: Deps): StartedView {
  restoreHeirForm(deps, view.case.id);
  return {
    ...view,
    editingDeceased: false,
    editingHeir: null,
    formEpoch: view.formEpoch + 1,
    notice: null,
    errors: null,
  };
}

/**
 * Moves the heirs screen to another layer (null is the first deceased's), ending any edit. A new
 * heir's draft stays, so nothing typed is lost. Refused mid-save, and for a death that is gone.
 */
export function openLayer(view: StartedView, id: string | null, deps: Deps): StartedView {
  if (view.saving) return view;
  const target = keepLayer(id, view.case);
  if (view.editingHeir !== null) restoreHeirForm(deps, view.case.id);
  const record = formFor(deps.forms.get(), view.case.id);
  if (record) {
    deps.forms.set({
      ...record,
      layer: target,
      values: target !== view.layer ? { ...record.values, same_as: "" } : record.values,
    });
  }
  return {
    ...view,
    layer: target,
    ordering: null,
    relativeQuestions: undefined,
    deathAnswers: undefined,
    deathFirst: undefined,
    deathOrderNeeded: undefined,
    editingHeir: null,
    formEpoch: view.formEpoch + 1,
    notice: null,
    errors: null,
    focus: nextFocus(view, "relationship"),
  };
}

/** Closes the order question without writing anything; focus returns to the row's button. */
export function cancelOrder(view: StartedView): StartedView {
  if (view.saving || view.ordering === null) return view;
  const row = view.ordering;
  return { ...view, ordering: null, relativeQuestions: undefined, deathAnswers: undefined, deathFirst: undefined, deathOrderNeeded: undefined, errors: null, notice: null, focus: nextFocus(view, `alsoDied:${row}`) };
}

/** Fills the heir form with the heir's details. */
export function startEditHeir(view: StartedView, heirId: string, deps: Deps): StartedView {
  const heir = layerAt(view.case, view.layer).heirs.find((item) => item.id === heirId);
  if (!heir) return view;
  writeParked(deps, view.case.id, "heir", heirId, { ...heirValues(heir) }, draftOf(deps, view.case.id));
  const record = deps.forms.get();
  if (record) deps.forms.set({ ...record, layer: view.layer });
  return {
    ...view,
    editingHeir: heirId,
    notice: null,
    errors: null,
    focus: nextFocus(view, "relationship"),
  };
}

/** Clears the heir form without writing anything; focus returns to the heir's row. */
export function cancelEditHeir(view: StartedView, deps: Deps): StartedView {
  restoreHeirForm(deps, view.case.id);
  return {
    ...view,
    editingHeir: null,
    formEpoch: view.formEpoch + 1,
    notice: null,
    errors: null,
    focus: view.editingHeir ? nextFocus(view, `editHeir:${view.editingHeir}`) : view.focus,
  };
}

/**
 * Records what the visitor has typed so a language switch or reload continues it. The
 * changed field's error goes away; the others stay until their field changes. A relationship
 * is a select, so a pick is final: a kinship rule it breaks (a husband for a male deceased)
 * shows at once instead of waiting for blur, which a select may never get before submit.
 */
export function remember(
  view: StartedView,
  form: FormName,
  values: Record<string, string>,
  field: string,
  store: FormStore,
): StartedView {
  const parked = formFor(store.get(), view.case.id)?.parked;
  store.set({
    caseId: view.case.id,
    form,
    heirId: form === "heir" ? view.editingHeir : null,
    values,
    layer: view.layer,
    ...(parked ? { parked } : {}),
  });
  const issue =
    form === "heir" && field === "relationship"
      ? relationshipIssue(
          { heir_options: layerAt(view.case, view.layer).options },
          view.editingHeir,
          values.relationship ?? "",
        )
      : null;
  const clearsError = view.errors !== null && view.errors[field] !== undefined;
  if (!clearsError && issue === null && view.notice === null) return view;
  let errors = view.errors;
  if (clearsError && errors) {
    const rest = { ...errors };
    delete rest[field];
    errors = Object.keys(rest).length > 0 ? rest : null;
  }
  if (issue !== null) errors = { ...(errors ?? {}), [field]: issue };
  return { ...view, errors, notice: null };
}

/** Validation on blur: shows or clears the field's message. */
export function blurField(
  view: StartedView,
  form: FormName,
  field: string,
  values: Record<string, string>,
): StartedView {
  let code = validateField(form, field, values);
  if (code === null && form === "heir" && field === "relationship") {
    code = relationshipIssue(
      { heir_options: layerAt(view.case, view.layer).options },
      view.editingHeir,
      values.relationship ?? "",
    );
  }
  if ((view.errors?.[field] ?? null) === code) return view;
  const errors = { ...(view.errors ?? {}) };
  if (code) errors[field] = code;
  else delete errors[field];
  return { ...view, errors: Object.keys(errors).length > 0 ? errors : null };
}

/**
 * Records that a form or selector is open, so a language switch or reload continues it.
 * Every started view goes through here; a record that already fits is left alone.
 */
function settle(view: StartedView, deps: Deps): StartedView {
  const screen = screenOf(view);
  const record = formFor(deps.forms.get(), view.case.id);
  if (screen === "selector") {
    if (!selectionFor(deps.selection.get(), view.case.id)) {
      deps.selection.set({ caseId: view.case.id, madhab: null });
    }
  } else if (screen === "deceased") {
    if (record?.form !== "deceased") {
      writeForm(deps, view.case.id, "deceased", null, { ...deceasedValues(view.case.deceased) });
    }
  } else if (screen === "heirs") {
    if (record?.form !== "heir" || record.heirId !== view.editingHeir || (record.layer ?? null) !== view.layer) {
      const heir = rowsOf(view.case).get(view.editingHeir ?? "")?.row;
      const parked = formFor(deps.forms.get(), view.case.id)?.parked;
      writeParked(
        deps,
        view.case.id,
        "heir",
        view.editingHeir,
        view.editingHeir === null ? { ...BLANK_HEIR, ...(parked ?? {}) } : { ...heirValues(heir) },
        view.editingHeir === null ? undefined : parked,
      );
    }
  }
  const settled = deps.forms.get();
  if (settled && (settled.layer ?? null) !== view.layer) deps.forms.set({ ...settled, layer: view.layer });
  return view;
}

function inProgress(deps: Deps, caseId: string): boolean {
  return selectionFor(deps.selection.get(), caseId) !== null || formFor(deps.forms.get(), caseId) !== null;
}

/** A page load or resume goes straight on to what is in progress for the case. */
function startedFor(found: Case, resumed: boolean, deps: Deps): StartedView {
  const changing = selectionFor(deps.selection.get(), found.id) !== null;
  const record = formFor(deps.forms.get(), found.id);
  const view = started(found, resumed, changing);
  if (record?.form === "deceased" && found.deceased) view.editingDeceased = true;
  view.layer = keepLayer(record?.layer ?? null, found);
  if (record?.form === "heir" && view.layer !== (record.layer ?? null)) deps.forms.set(null);
  if (record?.form === "heir" && view.layer === (record.layer ?? null) && record.heirId && layerAt(found, view.layer).heirs.some((row) => row.id === record.heirId)) {
    view.editingHeir = record.heirId;
  }
  return settle(view, deps);
}

export type Answer =
  | { kind: "saveDeceased"; from: StartedView; values: DeceasedValues }
  | { kind: "addHeir"; from: StartedView; values: HeirValues }
  | { kind: "saveHeir"; from: StartedView; heirId: string; values: HeirValues }
  | { kind: "removeHeir"; from: StartedView; heirId: string }
  /** `rowId` is the row whose person died; `first` answers the order question. */
  | { kind: "markDeath"; from: StartedView; rowId: string; first?: string; answers?: RelativeAnswers }
  | { kind: "unmarkDeath"; from: StartedView; heirId: string; rowId: string };

function formOf(answer: Answer): FormName {
  return answer.kind === "saveDeceased" ? "deceased" : "heir";
}

function invalidView(from: StartedView, form: FormName, errors: Errors): StartedView {
  return {
    ...from,
    notice: null,
    saving: false,
    errors,
    focus: nextFocus(from, (firstInvalid(form, errors) ?? "form-error") as FocusTarget),
  };
}

/**
 * The client's own check before anything is sent: the view to show when an answer breaks a
 * rule (focus on the first invalid field), or null when it can go to the server.
 */
export function precheck(answer: Answer): StartedView | null {
  if (answer.kind === "removeHeir" || answer.kind === "markDeath" || answer.kind === "unmarkDeath") return null;
  if (answer.kind === "saveDeceased") {
    const { errors } = validateDeceased(answer.values);
    return Object.keys(errors).length > 0 ? invalidView(answer.from, "deceased", errors) : null;
  }
  // The options are advice for blur only: the server decides every save.
  const { errors } = validateHeir(answer.values);
  if (answer.kind === "addHeir" && heirLimitReached(layerAt(answer.from.case, answer.from.layer).heirs)) {
    errors.heirs = "limit";
  }
  return Object.keys(errors).length > 0 ? invalidView(answer.from, "heir", errors) : null;
}

/**
 * Runs one action and settles on a view; it never throws. It makes one attempt per call,
 * except that a load which finds no case and nothing seen before reads once, then starts once.
 * `existing` is the case the visitor currently has on screen, if any. A choose needs the
 * `choice`: the school and the started view it was made from. An answer action needs the
 * `answer`.
 */
export async function runAction(
  action: Action,
  signal: AbortSignal,
  deps: Deps,
  existing: Case | null = null,
  choice?: { madhab: MadhabId; from: StartedView },
  answer?: Answer,
): Promise<View> {
  if (action === "choose") {
    if (!choice) return { name: "failed", retry: "load", resumable: existing };
    return choose(choice.madhab, choice.from, signal, deps);
  }
  if (
    action === "saveDeceased" ||
    action === "addHeir" ||
    action === "saveHeir" ||
    action === "removeHeir" ||
    action === "markDeath" ||
    action === "unmarkDeath"
  ) {
    if (!answer || answer.kind !== action) return { name: "failed", retry: "load", resumable: existing };
    return save(answer, signal, deps);
  }

  if (action === "load" || action === "resume") {
    let found: Case | null;
    try {
      found = await deps.fetchCase(signal);
    } catch {
      return { name: "failed", retry: action, resumable: null };
    }
    if (found) {
      deps.seen.set(true);
      if (action === "resume") return startedFor(found, true, deps);
      // A selection or form in progress in this tab continues without the resume prompt.
      return inProgress(deps, found.id)
        ? startedFor(found, found.madhab !== null, deps)
        : { name: "existing", case: found };
    }
    // The notice shows once: the flag is cleared as soon as it has been used.
    const expired = deps.seen.get();
    if (expired) deps.seen.set(false);
    deps.selection.set(null);
    deps.forms.set(null);
    // Arriving from "start a case" with nothing yet: go straight on to start one. An
    // expired case waits for the visitor's choice, and a resume never starts anything.
    if (expired || action === "resume") return { name: "none", expired };
    action = "start";
  }

  const replacing = action === "startOver";
  const result = await deps.startCase(signal, {
    replace: replacing,
    ...(replacing && existing ? { caseId: existing.id } : {}),
  });
  switch (result.kind) {
    case "started":
      deps.seen.set(true);
      deps.selection.set(null);
      deps.forms.set(null);
      return settle(started(result.case, false), deps);
    case "exists":
      deps.seen.set(true);
      return { name: "existing", case: result.case };
    case "throttled":
      return { name: "throttled", resumable: existing };
    default:
      return { name: "failed", retry: action, resumable: existing };
  }
}

async function choose(
  madhab: MadhabId,
  from: StartedView,
  signal: AbortSignal,
  deps: Deps,
): Promise<View> {
  // Continuing with the stored school selected writes nothing.
  if (from.case.madhab === madhab) {
    deps.selection.set(null);
    return { ...from, changing: false, notice: null, saving: false };
  }
  const result = await deps.setMadhab(signal, madhab, from.case.id);
  switch (result.kind) {
    case "updated":
      deps.selection.set(null);
      // The answers are kept, and so is the screen the visitor came from.
      return settle(
        {
          ...started(result.case, from.resumed),
          editingDeceased: from.editingDeceased,
          editingHeir: from.editingHeir,
          layer: keepLayer(from.layer, result.case),
          announcement: from.announcement,
          focus: from.focus,
        },
        deps,
      );
    case "gone": {
      deps.selection.set(null);
      deps.forms.set(null);
      deps.seen.set(false);
      return { name: "none", expired: true };
    }
    case "replaced":
      deps.selection.set(null);
      deps.forms.set(null);
      deps.seen.set(true);
      return { name: "existing", case: result.case };
    default:
      return { ...from, notice: result.kind, saving: false };
  }
}

function send(answer: Answer, signal: AbortSignal, deps: Deps): Promise<AnswerResult> {
  const caseId = answer.from.case.id;
  switch (answer.kind) {
    case "saveDeceased":
      return deps.saveDeceased(signal, caseId, validateDeceased(answer.values).fields as DeceasedFields);
    case "addHeir": {
      const fields = validateHeir(answer.values).fields as HeirFields;
      return deps.addHeir(signal, caseId, answer.from.layer === null ? fields : { ...fields, layer: answer.from.layer });
    }
    case "saveHeir":
      return deps.updateHeir(signal, caseId, answer.heirId, validateHeir(answer.values).fields as HeirFields);
    case "removeHeir":
      return deps.removeHeir(signal, caseId, answer.heirId);
    case "markDeath": {
      const pending = answer.from.ordering === answer.rowId;
      return deps.markDeceased(signal, caseId, answer.rowId,
        answer.first ?? (pending ? answer.from.deathFirst : undefined),
        { ...(pending ? openAnswers(answer.from) : {}), ...answer.answers });
    }
    case "unmarkDeath":
      return deps.unmarkDeceased(signal, caseId, answer.heirId);
  }
}

/** The stored relatives answers that still belong to a question the server has open. */
function openAnswers(from: StartedView): RelativeAnswers {
  const stored = from.deathAnswers ?? {};
  const open = from.relativeQuestions ?? [];
  const ids = new Set(open.filter((q) => q.kind === "relative").map((q) => q.id));
  const result: RelativeAnswers = {};
  if (stored.relatives) {
    result.relatives = Object.fromEntries(Object.entries(stored.relatives).filter(([key]) => ids.has(key)));
  }
  if (stored.shared_father !== undefined && open.some((q) => q.kind === "shared_father")) {
    result.shared_father = stored.shared_father;
  }
  return result;
}

/** The heir to bring into view after a successful add or edit; nothing for anything else. */
export function revealOf(view: View): string | null {
  if (view.name !== "started") return null;
  const note = view.announcement;
  if (!note || (note.kind !== "added" && note.kind !== "updated")) return null;
  return layerAt(view.case, view.layer).heirs.some((heir) => heir.id === note.id) ? note.id : null;
}

function announce(
  from: StartedView,
  kind: Announcement["kind"],
  heirs: readonly Heir[],
  heirId: string,
): Announcement | null {
  const heir = heirs.find((item) => item.id === heirId);
  if (!heir) return from.announcement;
  return {
    kind,
    id: heirId,
    heir: { name: heir.name, relationship: heir.relationship },
    ordinal: unnamedOrdinal(heirs, heirId),
    seq: (from.announcement?.seq ?? 0) + 1,
  };
}

/** The heirs of the layer the visitor is on, in the case as stored now. */
function layerHeirs(kase: Case, layer: string | null): readonly Heir[] {
  return layerAt(kase, keepLayer(layer, kase)).heirs;
}

/** The view after the server stored an answer. */
function saved(answer: Answer, kase: Case, deps: Deps): StartedView {
  const from = answer.from;
  const layer = keepLayer(from.layer, kase);
  const base = { ...started(kase, from.resumed), formEpoch: from.formEpoch, layer };
  switch (answer.kind) {
    case "markDeath": {
      // The new layer opens: the person's death is stored under their earliest row.
      const row = rowsOf(from.case).get(answer.rowId)?.row;
      const person = row ? (row.same_as ?? row.id) : null;
      if (from.editingHeir !== null) restoreHeirForm(deps, kase.id);
      return settle(
        {
          ...base,
          layer: person === null ? layer : keepLayer(person, kase),
          formEpoch: from.formEpoch + 1,
          announcement: announce(from, "deathMarked", layerHeirs(from.case, from.layer), answer.rowId),
          focus: nextFocus(from, "relationship"),
        },
        deps,
      );
    }
    case "unmarkDeath":
      if (from.editingHeir !== null) restoreHeirForm(deps, kase.id);
      return settle(
        {
          ...base,
          formEpoch: from.editingHeir !== null ? from.formEpoch + 1 : from.formEpoch,
          announcement: announce(from, "deathUnmarked", layerHeirs(from.case, from.layer), answer.rowId),
          focus: nextFocus(from, `alsoDied:${answer.rowId}`),
        },
        deps,
      );
    case "saveDeceased":
      return settle({ ...base, announcement: from.announcement, focus: from.focus }, deps);
    case "addHeir": {
      resetHeirForm(deps, kase.id);
      return {
        ...base,
        formEpoch: from.formEpoch + 1,
        announcement: announce(
          from,
          "added",
          layerHeirs(kase, from.layer),
          layerHeirs(kase, from.layer).at(-1)?.id ?? "",
        ),
        focus: nextFocus(from, "relationship"),
      };
    }
    case "saveHeir": {
      restoreHeirForm(deps, kase.id);
      return {
        ...base,
        formEpoch: from.formEpoch + 1,
        announcement: announce(from, "updated", layerHeirs(kase, from.layer), answer.heirId),
        focus: nextFocus(from, "relationship"),
      };
    }
    case "removeHeir": {
      // Removing the heir being edited ends the edit; removing another leaves the form alone.
      const wasEditing = from.editingHeir === answer.heirId;
      if (wasEditing) restoreHeirForm(deps, kase.id);
      return settle(
        {
          ...base,
          formEpoch: wasEditing ? from.formEpoch + 1 : from.formEpoch,
          editingHeir: wasEditing ? null : from.editingHeir,
          announcement: announce(from, "removed", layerHeirs(from.case, from.layer), answer.heirId),
          focus: nextFocus(from, "list"),
        },
        deps,
      );
    }
  }
}

/**
 * After an add that may have been stored although the answer never came, one best-effort
 * read shows the visitor whether it was. It is a read: the write still happened once. Any
 * failure of the read changes nothing.
 */
async function refreshed(from: StartedView, signal: AbortSignal, deps: Deps): Promise<Case> {
  try {
    const live = await deps.fetchCase(signal);
    return live && live.id === from.case.id ? live : from.case;
  } catch {
    return from.case;
  }
}

/** The codes that mean the order of death is the question: the visitor answers it, or cancels. */
const ORDER_CODES = ["order_required", "simultaneous", "unknown", "order_conflict"];

/**
 * The server refused a death. Nothing was stored and the case is as it was. An order refusal keeps
 * the question open with focus on it; any other refusal shows its code and focuses the row's button.
 */
function deathRefused(answer: Extract<Answer, { kind: "markDeath" }>, errors: Errors, questions?: RelativeQuestion[]): StartedView {
  const asks = ORDER_CODES.includes(errors.death ?? "");
  return {
    ...answer.from,
    ordering: asks || questions?.length ? answer.rowId : null,
    relativeQuestions: questions,
    deathOrderNeeded: asks,
    deathAnswers: { ...(answer.from.ordering === answer.rowId ? answer.from.deathAnswers : {}), ...answer.answers },
    deathFirst: answer.first ?? (answer.from.ordering === answer.rowId ? answer.from.deathFirst : undefined),
    notice: null,
    saving: false,
    errors,
    focus: nextFocus(answer.from, asks ? "death-order" : questions?.length ? "relatives" : `alsoDied:${answer.rowId}`),
  };
}

function reconcileFresh(view: StartedView, from: StartedView, fresh: Case, deps: Deps): StartedView {
  const layer = keepLayer(from.layer, fresh);
  const changed = layer !== from.layer;
  if (changed) deps.forms.set({ caseId: fresh.id, form: "heir", heirId: null, layer, values: { ...BLANK_HEIR } });
  return {
    ...view,
    case: fresh,
    layer,
    ordering: view.ordering !== null && rowsOf(fresh).has(view.ordering) ? view.ordering : null,
    ...(changed ? { editingHeir: null, formEpoch: from.formEpoch + 1, focus: nextFocus(from, "relationship") } : {}),
  };
}

async function save(answer: Answer, signal: AbortSignal, deps: Deps): Promise<View> {
  const blocked = precheck(answer);
  if (blocked) return blocked;
  const from = answer.from;
  const result = await send(answer, signal, deps);
  switch (result.kind) {
    case "saved":
      return saved(answer, result.case, deps);
    case "invalid": {
      if (answer.kind === "markDeath") {
        if (result.errors.death !== "already_deceased") return deathRefused(answer, result.errors, result.questions);
        const fresh = await refreshed(from, signal, deps);
        return reconcileFresh(deathRefused(answer, result.errors, result.questions), from, fresh, deps);
      }
      // A refused relationship or gender may mean this tab's list is stale (a spouse it never
      // saw, or an heir removed elsewhere), so read the case again. A failed read changes nothing.
      if (!result.errors.relationship && !result.errors.gender) {
        return invalidView(from, formOf(answer), result.errors);
      }
      const fresh = await refreshed(from, signal, deps);
      const gone = from.editingHeir !== null && !rowsOf(fresh).has(from.editingHeir);
      const layer = keepLayer(from.layer, fresh);
      if (gone) restoreHeirForm(deps, fresh.id);
      return reconcileFresh(
        invalidView(
          gone
            ? { ...from, case: fresh, layer, editingHeir: null, formEpoch: from.formEpoch + 1 }
            : { ...from, case: fresh, layer },
          formOf(answer),
          result.errors,
        ),
        from,
        fresh,
        deps,
      );
    }
    case "gone":
      deps.selection.set(null);
      deps.forms.set(null);
      deps.seen.set(false);
      return { name: "none", expired: true };
    case "replaced":
      deps.selection.set(null);
      deps.forms.set(null);
      deps.seen.set(true);
      return { name: "existing", case: result.case };
    case "missing": {
      // The heir is gone: show the list as it is now, and tell the visitor.
      const stillThere = from.editingHeir !== null && rowsOf(result.case).has(from.editingHeir);
      const endsEdit = from.editingHeir !== null && !stillThere;
      if (endsEdit) restoreHeirForm(deps, result.case.id);
      return reconcileFresh(settle(
        {
          ...started(result.case, from.resumed),
          editingDeceased: from.editingDeceased,
          editingHeir: stillThere ? from.editingHeir : null,
          layer: keepLayer(from.layer, result.case),
          formEpoch: endsEdit ? from.formEpoch + 1 : from.formEpoch,
          announcement: from.announcement,
          focus: nextFocus(from, "list"),
          notice: "heirGone",
          ordering: from.ordering,
        },
        deps,
      ), from, result.case, deps);
    }
    default: {
      // A lost answer to an add may hide a stored heir, so look once; the input stays.
      const fresh = answer.kind === "addHeir" && result.kind === "failed" ? await refreshed(from, signal, deps) : from.case;
      return reconcileFresh({
        ...from,
        case: fresh,
        layer: keepLayer(from.layer, fresh),
        notice: result.kind,
        // The errors pendingView cleared are not brought back by a failed save.
        errors: null,
        saving: false,
        // A failed removal puts focus back on the row button, which the question replaced.
        focus: answer.kind === "removeHeir" ? nextFocus(from, `remove:${answer.heirId}`) : from.focus,
      }, from, fresh, deps);
    }
  }
}

import type {
  AnswerResult,
  RemoveImpact,
  RelativeQuestion,
  RelativeAnswers,
  Case,
  DeceasedFields,
  Heir,
  HeirFields,
  HeirOptions,
  MadhabId,
  MadhabResult,
  RelationshipId,
  StartResult,
} from "../api/case.ts";
import { MAX_HEIRS, noHeirOptions } from "../api/case.ts";
import {
  BLANK_HEIR,
  unnamedOrdinal,
  deceasedValues,
  firstInvalid,
  formFor,
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
import { estateModel, focusAfterRemoval } from "./tree.ts";
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
  | "unmarkDeath"
  | "undo";

/** A write that did not go through, or a list that changed under the visitor. */
export type Notice = "throttled" | "failed" | "heirGone";

/** What the screen-reader live region says; `seq` makes a repeat count as new. */
export type Announcement = {
  kind: "added" | "updated" | "linked" | "unlinked" | "removed" | "deathMarked" | "laterDeath" | "deathUnmarked" | "undone";
  /** The id of the heir the change was about. */
  id: string;
  heir: { name: string | null; relationship: RelationshipId };
  /** The heir number among unnamed heirs of the same relationship, when there are several. */
  ordinal: number | null;
  /** The person's gender, for a later death marked from the edit sheet. */
  gender?: "male" | "female";
  /** Present on a successful panel add, including a one-press add. */
  panelCount?: number;
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
  "addHere",
  "openEstate",
  "treeHeading",
] as const;
export const FOCUS_PREFIXES = ["card", "editRelationship", "editStatus", "editHeir", "remove", "alsoDied", "relative", "add", "addHere"] as const;
export type FocusTarget =
  | (typeof FOCUS_TARGETS)[number]
  | `${(typeof FOCUS_PREFIXES)[number]}:${string}`;

/** Where to move focus: a `data-focus` id on the page. `seq` makes a repeat count as new. */
export type FocusRequest = { target: FocusTarget; seq: number };

/**
 * What an add from the Add relatives panel left behind, shown in the panel and nowhere else, and
 * cleared by the next action.
 */
export type PanelOutcome = {
  relationship: string;
  errors?: Errors;
  notice?: Notice | "conflict";
};

/**
 * What a positioned add (Add relative here, a placeholder or a drop) left behind, shown beside the
 * chooser that made it and cleared by the next action.
 */
export type TreeOutcome = {
  relationship: string;
  anchor: string;
  errors?: Errors;
  notice?: Notice | "conflict";
};

/** One accepted family change that Undo can take back: the Case as it was, and who it touched. */
export type UndoEntry = { snapshot: Record<string, unknown>; person?: string };

/** The toast after a change that pushed an entry; `key` restarts its timer for each change. */
export type UndoToast = { key: number; announcement: Announcement };

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
  opener?: FocusTarget;
  confirming?: { heirId: string; impact: RemoveImpact | null; fromRow: boolean };
  conflict?: boolean;
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
  /** The open death question or refusal belongs to the edit sheet's later-death choice, not to a row. */
  sheetDeath?: boolean;
  /** Counts the times the heir form had to be cleared, so only those rebuild it. */
  formEpoch: number;
  notice: Notice | null;
  /** Field name to error code, from the client's rules or from the server. */
  errors: Errors | null;
  /** The outcome of the last Add relatives press; kept apart from `errors` so the heir form never shows it. */
  panel?: PanelOutcome;
  /** The outcome of the last positioned add. */
  tree?: TreeOutcome;
  focus: FocusRequest | null;
  announcement: Announcement | null;
  saving: boolean;
  /** Prior accepted snapshots, oldest first, for this page visit only. Absent reads as empty. */
  history?: UndoEntry[];
  /** Shown after a change that pushed an entry; cleared when the history is. */
  undoToast?: UndoToast;
  /** The last Undo could not be sent or was refused; the history is untouched. */
  undoFailed?: boolean;
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
    options: { replace: boolean; caseId?: string; revision?: number | null },
  ) => Promise<StartResult>;
  setMadhab: (signal: AbortSignal, madhab: MadhabId, caseId: string, revision: number | null) => Promise<MadhabResult>;
  saveDeceased: (signal: AbortSignal, caseId: string, revision: number | null, fields: DeceasedFields) => Promise<AnswerResult>;
  addHeir: (signal: AbortSignal, caseId: string, revision: number | null, fields: HeirFields) => Promise<AnswerResult>;
  addHeirs: (signal: AbortSignal, caseId: string, revision: number | null, relationship: RelationshipId, count: number, layer?: string) => Promise<AnswerResult>;
  updateHeir: (
    signal: AbortSignal,
    caseId: string,
    revision: number | null,
    heirId: string,
    fields: HeirFields,
  ) => Promise<AnswerResult>;
  removeHeir: (signal: AbortSignal, caseId: string, revision: number | null, heirId: string, confirm: boolean) => Promise<AnswerResult>;
  markDeceased: (signal: AbortSignal, caseId: string, revision: number | null, heirId: string, first?: string, answers?: RelativeAnswers) => Promise<AnswerResult>;
  unmarkDeceased: (signal: AbortSignal, caseId: string, revision: number | null, heirId: string) => Promise<AnswerResult>;
  restoreCase: (signal: AbortSignal, caseId: string, revision: number | null, snapshot: Record<string, unknown>) => Promise<AnswerResult>;
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
 * Which screen a view shows: a case whose school is being changed shows the selector; a case with
 * no school goes straight on, because the school is asked only if the schools differ for the family;
 * then a case with no deceased, or one being edited, shows the deceased form; then the heirs.
 */
export function screenOf(view: View): Screen {
  if (view.name !== "started") return view.name;
  if (view.changing) return "selector";
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
  const rest = { ...current };
  delete rest.panel;
  delete rest.tree;
  delete rest.conflict;
  delete rest.undoFailed;
  return { ...rest, notice: null, errors: null, saving: true };
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
export function openLayer(view: StartedView, id: string | null, deps: Deps, focus: "relationship" | "treeHeading" = "treeHeading"): StartedView {
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
  const opened: StartedView = {
    ...view,
    layer: target,
    ordering: null,
    relativeQuestions: undefined,
    deathAnswers: undefined,
    deathFirst: undefined,
    deathOrderNeeded: undefined,
    sheetDeath: undefined,
    editingHeir: null,
    confirming: undefined,
    conflict: false,
    formEpoch: view.formEpoch + 1,
    notice: null,
    errors: null,
    focus: nextFocus(view, focus),
  };
  delete opened.panel;
  delete opened.tree;
  return opened;
}

/** Closes the order question without writing anything; focus returns to the row's button. */
export function cancelOrder(view: StartedView): StartedView {
  if (view.saving || view.ordering === null) return view;
  const row = view.ordering;
  return { ...view, ordering: null, relativeQuestions: undefined, deathAnswers: undefined, deathFirst: undefined, deathOrderNeeded: undefined, sheetDeath: undefined, errors: null, notice: null, focus: nextFocus(view, view.sheetDeath ? "editStatus:died_later" : `alsoDied:${row}`) };
}

/** Drops the death question or refusal that belongs to the edit sheet, when the sheet is leaving. */
function clearSheetDeath(view: StartedView): Partial<StartedView> {
  return view.sheetDeath
    ? { ordering: null, relativeQuestions: undefined, deathAnswers: undefined, deathFirst: undefined, deathOrderNeeded: undefined, sheetDeath: undefined }
    : {};
}

/** Fills the heir form with the heir's details. */
export function startEditHeir(view: StartedView, heirId: string, deps: Deps, opener: FocusTarget = `editHeir:${heirId}`): StartedView {
  if (view.saving) return view;
  const heir = estateModel(view.case, view.layer, null).people.find((item) => item.id === heirId);
  if (!heir) return view;
  writeParked(deps, view.case.id, "heir", heirId, { ...heirValues(heir) }, draftOf(deps, view.case.id));
  const record = deps.forms.get();
  if (record) deps.forms.set({ ...record, layer: view.layer });
  return {
    ...view,
    ...clearSheetDeath(view),
    editingHeir: heirId,
    confirming: undefined,
    conflict: false,
    opener,
    notice: null,
    errors: null,
    focus: nextFocus(view, "name"),
  };
}

/** Clears the heir form without writing anything; focus returns to the heir's row. */
export function cancelEditHeir(view: StartedView, deps: Deps): StartedView {
  if (view.saving) return view;
  if (view.confirming && !view.confirming.fromRow) {
    return { ...view, confirming: undefined, conflict: false, notice: null, errors: null, focus: nextFocus(view, "name") };
  }
  restoreHeirForm(deps, view.case.id);
  return {
    ...view,
    ...clearSheetDeath(view),
    confirming: undefined,
    conflict: false,
    editingHeir: null,
    formEpoch: view.formEpoch + 1,
    notice: null,
    errors: null,
    focus: view.editingHeir ? nextFocus(view, view.opener ?? `editHeir:${view.editingHeir}`) : view.focus,
  };
}

export function requestCardRemoval(view: StartedView, heirId: string, deps: Deps): StartedView {
  const opened = startEditHeir(view, heirId, deps, `card:${heirId}`);
  return opened === view ? view : { ...opened, confirming: { heirId, impact: null, fromRow: false }, focus: null };
}

/**
 * The options to use for the relationship blur check in the current form context.
 * For the add form (`editingHeir` null) this is the layer's own `options` — unchanged.
 * For the edit form it is the edited heir's `edit_options` (counts without that heir),
 * falling back to `noHeirOptions()` when the heir is not found (stale view: flag nothing).
 */
function editOptions(view: StartedView): HeirOptions {
  if (view.editingHeir === null) return layerAt(view.case, view.layer).options;
  return layerAt(view.case, view.layer).heirs.find((h) => h.id === view.editingHeir)?.edit_options ?? noHeirOptions();
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
      ? relationshipIssue(editOptions(view), values.relationship ?? "")
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
    code = relationshipIssue(editOptions(view), values.relationship ?? "");
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
  if (record?.form === "heir" && view.layer === (record.layer ?? null) && record.heirId && estateModel(found, view.layer, null).people.some((row) => row.id === record.heirId)) {
    view.editingHeir = record.heirId;
  }
  return settle(view, deps);
}

export type Answer =
  | { kind: "saveDeceased"; from: StartedView; values: DeceasedValues }
  /**
   * `origin: "panel"` is one press in the Add relatives panel: it keeps the heir form as it was.
   * `origin: "tree"` is a positioned add of one person at `anchor` (a person id or "root").
   */
  | { kind: "addHeir"; from: StartedView; values: HeirValues; origin?: "panel" | "tree"; count?: number; anchor?: string }
  | { kind: "saveHeir"; from: StartedView; heirId: string; values: HeirValues; status?: HeirFields["status"]; link?: string | null; field?: FocusTarget; close?: boolean; openEstate?: string }
  | { kind: "removeHeir"; from: StartedView; heirId: string; confirm?: boolean; fromRow?: boolean }
  /** `rowId` is the row whose person died; `first` answers the order question. */
  | { kind: "markDeath"; from: StartedView; rowId: string; first?: string; answers?: RelativeAnswers; origin?: "sheet"; name?: string | null }
  | { kind: "unmarkDeath"; from: StartedView; heirId: string; rowId: string }
  /** Takes back the latest family change with one restore at the current revision. */
  | { kind: "undo"; from: StartedView };

/** The history of a view; a view that never had one reads as empty. */
export function historyOf(view: StartedView): readonly UndoEntry[] {
  return view.history ?? [];
}

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

function isPanel(answer: Answer): answer is Extract<Answer, { kind: "addHeir" }> & { origin: "panel" } {
  return answer.kind === "addHeir" && answer.origin === "panel";
}

function isTree(answer: Answer): answer is Extract<Answer, { kind: "addHeir" }> & { origin: "tree"; anchor: string } {
  return answer.kind === "addHeir" && answer.origin === "tree" && typeof answer.anchor === "string";
}

/** A positioned add shows its outcome beside its chooser and focus stays on the pressed control. */
function treeView(from: StartedView, answer: Extract<Answer, { kind: "addHeir" }> & { anchor: string }, outcome: Omit<TreeOutcome, "relationship" | "anchor">): StartedView {
  return {
    ...from,
    notice: null,
    saving: false,
    errors: null,
    tree: { relationship: answer.values.relationship, anchor: answer.anchor, ...outcome },
    focus: nextFocus(from, `addHere:${answer.values.relationship}`),
  };
}

/** The panel shows an outcome and focus stays on the pressed button (or the panel heading). */
function panelView(from: StartedView, relationship: string, outcome: Omit<PanelOutcome, "relationship">): StartedView {
  return {
    ...from,
    notice: null,
    saving: false,
    errors: null,
    panel: { relationship, ...outcome },
    focus: nextFocus(from, `add:${relationship}`),
  };
}

/** A refusal: in the panel for a panel add, else on the heir form. */
function refusedView(answer: Answer, from: StartedView, errors: Errors): StartedView {
  if (isTree(answer)) return treeView(from, answer, { errors });
  return isPanel(answer)
    ? panelView(from, answer.values.relationship, { errors })
    : invalidView(from, formOf(answer), errors);
}

/**
 * The client's own check before anything is sent: the view to show when an answer breaks a
 * rule (focus on the first invalid field), or null when it can go to the server.
 */
export function precheck(answer: Answer): StartedView | null {
  if (answer.kind === "saveHeir" || answer.kind === "removeHeir" || answer.kind === "markDeath" || answer.kind === "unmarkDeath" || answer.kind === "undo") return null;
  if (answer.kind === "saveDeceased") {
    const { errors } = validateDeceased(answer.values);
    return Object.keys(errors).length > 0 ? invalidView(answer.from, "deceased", errors) : null;
  }
  // The options are advice for blur only: the server decides every save.
  const { errors } = validateHeir(answer.values);
  if ((answer.count ?? 1) > MAX_HEIRS - layerAt(answer.from.case, answer.from.layer).heirs.length) {
    errors.heirs = "limit";
  }
  if (Object.keys(errors).length === 0) return null;
  return refusedView(answer, answer.from, errors);
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
    action === "unmarkDeath" ||
    action === "undo"
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
    ...(replacing && existing ? { caseId: existing.id, revision: existing.revision } : {}),
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
    return { ...from, changing: false, notice: null, saving: false, conflict: false };
  }
  const result = await deps.setMadhab(signal, madhab, from.case.id, from.case.revision);
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
      if (result.case.id === from.case.id) {
        // Same case, newer revision: adopt it, keep the screen and the visitor's pick, never resend.
        return reconcileFresh({
          ...from, case: result.case, layer: keepLayer(from.layer, result.case), confirming: undefined,
          notice: null, errors: null, saving: false, conflict: true, history: [], undoToast: undefined, undoFailed: undefined,
        }, from, result.case, deps);
      }
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
  const revision = answer.from.case.revision;
  switch (answer.kind) {
    case "saveDeceased":
      return deps.saveDeceased(signal, caseId, revision, validateDeceased(answer.values).fields as DeceasedFields);
    case "addHeir": {
      const fields = validateHeir(answer.values).fields as HeirFields;
      if (isTree(answer)) {
        return deps.addHeir(signal, caseId, revision, {
          ...fields, anchor: answer.anchor, ...(answer.from.layer === null ? {} : { layer: answer.from.layer }),
        });
      }
      if (isPanel(answer) && answer.count !== undefined && answer.count >= 2) {
        return deps.addHeirs(signal, caseId, revision, fields.relationship, answer.count, answer.from.layer ?? undefined);
      }
      return deps.addHeir(signal, caseId, revision, answer.from.layer === null ? fields : { ...fields, layer: answer.from.layer });
    }
    case "saveHeir":
      return deps.updateHeir(signal, caseId, revision, answer.heirId, {
        relationship: answer.values.relationship as RelationshipId, name: answer.values.name.trim() || null,
        ...(answer.status ? { status: answer.status } : {}),
        ...(answer.link !== undefined ? { same_as: answer.link } : {}),
      });
    case "removeHeir":
      return deps.removeHeir(signal, caseId, revision, answer.heirId, answer.confirm === true);
    case "markDeath": {
      const pending = answer.from.ordering === answer.rowId;
      return deps.markDeceased(signal, caseId, revision, answer.rowId,
        answer.first ?? (pending ? answer.from.deathFirst : undefined),
        { ...(pending ? openAnswers(answer.from) : {}), ...answer.answers });
    }
    case "unmarkDeath":
      return deps.unmarkDeceased(signal, caseId, revision, answer.heirId);
    case "undo": {
      const top = historyOf(answer.from).at(-1);
      return top ? deps.restoreCase(signal, caseId, revision, top.snapshot) : Promise.resolve({ kind: "failed" });
    }
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
  if (!note || (note.kind !== "added" && note.kind !== "updated" && note.kind !== "linked" && note.kind !== "unlinked")) return null;
  return layerAt(view.case, view.layer).heirs.some((heir) => heir.id === note.id) ? note.id : null;
}

function announce(
  from: StartedView,
  kind: Announcement["kind"],
  heirs: readonly Pick<Heir, "id" | "relationship" | "name">[],
  heirId: string,
  panelCount?: number,
): Announcement | null {
  const heir = heirs.find((item) => item.id === heirId);
  if (!heir) return from.announcement;
  return {
    kind,
    id: heirId,
    heir: { name: heir.name, relationship: heir.relationship },
    ordinal: unnamedOrdinal(heirs, heirId),
    ...(panelCount === undefined ? {} : { panelCount }),
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
      if (answer.origin === "sheet") {
        // The sheet stays open on the person; the active estate does not change.
        const known = layerHeirs(kase, layer).find((heir) => heir.id === answer.rowId);
        const note = announce(from, "laterDeath", layerHeirs(kase, layer), answer.rowId);
        return settle(
          {
            ...base,
            editingHeir: from.editingHeir,
            opener: from.opener,
            announcement: note && known ? { ...note, gender: known.gender } : note,
            focus: nextFocus(from, "openEstate"),
          },
          deps,
        );
      }
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
    case "undo": {
      // The restored family replaces the screen's; an edit in progress is closed rather than left showing old text.
      const entry = historyOf(from).at(-1);
      restoreHeirForm(deps, kase.id);
      const people = estateModel(kase, layer, null).people;
      return settle(
        {
          ...base,
          formEpoch: from.formEpoch + 1,
          history: historyOf(from).slice(0, -1),
          announcement: {
            kind: "undone", id: "", heir: { name: null, relationship: "son" }, ordinal: null,
            seq: (from.announcement?.seq ?? 0) + 1,
          },
          focus: nextFocus(from, entry?.person && people.some((p) => p.id === entry.person) ? `card:${entry.person}` : "card:root"),
        },
        deps,
      );
    }
    case "saveDeceased":
      return settle({ ...base, announcement: from.announcement, focus: from.focus }, deps);
    case "addHeir": {
      if (isTree(answer)) {
        // One person at a chosen node: the new row is the layer's row the prior Case did not have.
        const known = new Set(layerHeirs(from.case, from.layer).map((row) => row.id));
        const added = layerHeirs(kase, from.layer).find((row) => !known.has(row.id))?.id ?? "";
        // An open edit sheet closes, as cancelEditHeir does, so focus can reach the new card behind it.
        const sheet = from.editingHeir !== null;
        if (sheet) restoreHeirForm(deps, kase.id);
        return settle(
          {
            ...base,
            editingHeir: null,
            formEpoch: sheet ? from.formEpoch + 1 : from.formEpoch,
            announcement: announce(from, "added", layerHeirs(kase, from.layer), added),
            focus: nextFocus(from, added ? `card:${added}` : `addHere:${answer.values.relationship}`),
          },
          deps,
        );
      }
      if (isPanel(answer)) {
        // One press leaves the heir form alone: an edit in progress keeps its heir and its text.
        const added = layerHeirs(kase, from.layer).at(-1)?.id ?? "";
        return settle(
          {
            ...base,
            editingHeir: from.editingHeir,
            opener: from.opener,
            announcement: announce(from, "added", layerHeirs(kase, from.layer), added, answer.count ?? 1),
            focus: nextFocus(from, `add:${answer.values.relationship}`),
          },
          deps,
        );
      }
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
      const people = estateModel(kase, layer, null).people;
      if (answer.close) {
        restoreHeirForm(deps, kase.id);
        return {
          ...from, ...clearSheetDeath(from), case: kase, saving: false, errors: null, notice: null, conflict: false,
          editingHeir: null, confirming: undefined, formEpoch: from.formEpoch + 1,
          announcement: announce(from, "updated", people, answer.heirId),
          focus: nextFocus(from, from.opener ?? `editHeir:${answer.heirId}`),
        };
      }
      const stayed: StartedView = {
        ...from, case: kase, saving: false, errors: null, notice: null, conflict: false,
        editingHeir: answer.heirId,
        announcement: announce(from, answer.link === undefined ? "updated" : answer.link === null ? "unlinked" : "linked", people, answer.heirId),
        focus: nextFocus(from, answer.field ?? "relationship"),
      };
      // "Open own estate" with an uncommitted name: the name is saved, then the estate opens.
      return answer.openEstate === undefined ? stayed : openLayer(stayed, answer.openEstate, deps, "treeHeading");
    }
    case "removeHeir": {
      const before = estateModel(from.case, from.layer, null);
      const surviving = new Set(estateModel(kase, layer, null).people.map(p => p.id));
      const target = focusAfterRemoval(before, answer.heirId, surviving);
      const wasEditing = from.editingHeir !== null && !surviving.has(from.editingHeir);
      if (wasEditing) restoreHeirForm(deps, kase.id);
      return settle(
        {
          ...base,
          formEpoch: wasEditing ? from.formEpoch + 1 : from.formEpoch,
          editingHeir: wasEditing ? null : from.editingHeir,
          announcement: announce(from, "removed", before.people, answer.heirId),
          focus: nextFocus(from, `card:${target}`),
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
    sheetDeath: answer.origin === "sheet",
    deathAnswers: { ...(answer.from.ordering === answer.rowId ? answer.from.deathAnswers : {}), ...answer.answers },
    deathFirst: answer.first ?? (answer.from.ordering === answer.rowId ? answer.from.deathFirst : undefined),
    notice: null,
    saving: false,
    errors,
    focus: nextFocus(answer.from, asks ? "death-order" : questions?.length ? "relatives"
      : answer.origin === "sheet" ? "editStatus:died_later" : `alsoDied:${answer.rowId}`),
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
    ...(changed ? { editingHeir: null, formEpoch: from.formEpoch + 1, focus: nextFocus(from, "treeHeading") } : {}),
  };
}

/** The view after an Undo that did not restore: nothing changed, or the Case moved under it. */
function undone(
  answer: Extract<Answer, { kind: "undo" }>,
  result: Exclude<AnswerResult, { kind: "saved" }>,
  deps: Deps,
): View {
  const from = answer.from;
  switch (result.kind) {
    case "gone":
      deps.selection.set(null);
      deps.forms.set(null);
      deps.seen.set(false);
      return { name: "none", expired: true };
    case "replaced": {
      if (result.case.id !== from.case.id) {
        deps.selection.set(null);
        deps.forms.set(null);
        deps.seen.set(true);
        return { name: "existing", case: result.case };
      }
      // The same case at a newer revision: show it, say so, and never resend.
      const fresh = result.case;
      const gone = from.editingHeir !== null && !estateModel(fresh, from.layer, null).people.some((p) => p.id === from.editingHeir);
      if (gone) restoreHeirForm(deps, fresh.id);
      return reconcileFresh({
        ...from, case: fresh, layer: keepLayer(from.layer, fresh), confirming: undefined, notice: null, errors: null,
        saving: false, conflict: true, history: [], undoToast: undefined,
        ...(gone ? { editingHeir: null, formEpoch: from.formEpoch + 1 } : {}),
      }, from, fresh, deps);
    }
    default:
      // The entry and the family stay; the visitor can try again.
      return { ...from, notice: null, errors: null, saving: false, undoFailed: true };
  }
}

/**
 * What a settled answer does to the history. A saved family change pushes one entry (the prior
 * Case's own snapshot) and shows the toast; a saved non-family change clears it, because a later
 * restore would silently revert it. Any other result keeps it only while the Case on screen is
 * still the one this tab produced: another revision or case was adopted, not made.
 */
function recorded(answer: Answer, result: AnswerResult, shown: View): View {
  if (shown.name !== "started") return shown;
  const from = answer.from;
  const kept = historyOf(from);
  // An empty history and no toast are left off the view, so views without Undo keep their shape.
  const finish = (history: readonly UndoEntry[], toast?: UndoToast, failed = false): StartedView => {
    const out: StartedView = { ...shown };
    delete out.history;
    delete out.undoToast;
    delete out.undoFailed;
    if (history.length > 0) out.history = [...history];
    if (toast) out.undoToast = toast;
    if (failed) out.undoFailed = true;
    return out;
  };
  if (result.kind === "saved" && answer.kind === "undo") return finish(shown.history ?? []);
  if (result.kind === "saved") {
    const person =
      answer.kind === "saveHeir" || answer.kind === "removeHeir" || answer.kind === "unmarkDeath" ? answer.heirId
      : answer.kind === "markDeath" ? answer.rowId : undefined;
    const family = answer.kind !== "saveDeceased";
    const snapshot = from.case.snapshot;
    if (!family || !snapshot || result.case.id !== from.case.id) return finish([]);
    const announcement = shown.announcement;
    return finish(
      [...kept, { snapshot, ...(person === undefined ? {} : { person }) }],
      announcement ? { key: (from.undoToast?.key ?? 0) + 1, announcement } : undefined,
    );
  }
  const same = shown.case.id === from.case.id && shown.case.revision === from.case.revision;
  if (!same) return finish([]);
  return finish(kept, from.undoToast, answer.kind === "undo" && shown.undoFailed === true);
}

async function save(input: Answer, signal: AbortSignal, deps: Deps): Promise<View> {
  const blocked = precheck(input);
  if (blocked) return blocked;
  let answer = input;
  if (input.kind === "markDeath" && input.name !== undefined) {
    // An uncommitted name in the sheet is saved first; the death is sent only if that save succeeds.
    const row = layerHeirs(input.from.case, input.from.layer).find((heir) => heir.id === input.rowId);
    const named: AnswerResult = row
      ? await deps.updateHeir(signal, input.from.case.id, input.from.case.revision, input.rowId, { relationship: row.relationship, name: input.name })
      : { kind: "failed" };
    if (named.kind !== "saved") {
      const stopped = await settled(input, named, signal, deps);
      return recorded(input, named, stopped);
    }
    // The death, and any refusal of it, builds on the case the rename produced.
    answer = { ...input, name: undefined, from: { ...input.from, case: named.case } };
  }
  const result = await send(answer, signal, deps);
  const view = result.kind === "saved" ? saved(answer, result.case, deps) : await settled(answer, result, signal, deps);
  return recorded(answer, result, view);
}

async function settled(answer: Answer, result: Exclude<AnswerResult, { kind: "saved" }>, signal: AbortSignal, deps: Deps): Promise<View> {
  const from = answer.from;
  if (answer.kind === "undo") return undone(answer, result, deps);
  switch (result.kind) {
    case "cascade": {
      if (answer.kind !== "removeHeir" || result.case.id !== from.case.id) {
        return { ...from, notice: "failed", saving: false };
      }
      const fromRow = answer.fromRow ?? from.confirming?.fromRow ?? from.editingHeir !== answer.heirId;
      const opened = startEditHeir({ ...from, case: result.case }, answer.heirId, deps,
        fromRow ? `remove:${answer.heirId}` : from.opener);
      return reconcileFresh({
        ...opened, confirming: { heirId: answer.heirId, impact: result.impact, fromRow }, focus: null,
      }, from, result.case, deps);
    }
    case "invalid": {
      if (answer.kind === "saveHeir") return {
        ...from, saving: false, conflict: false, notice: null, errors: result.errors,
        focus: nextFocus(from, answer.field ?? "relationship"),
      };
      if (answer.kind === "markDeath") {
        if (result.errors.death !== "already_deceased") return deathRefused(answer, result.errors, result.questions);
        const fresh = await refreshed(from, signal, deps);
        return reconcileFresh(deathRefused(answer, result.errors, result.questions), from, fresh, deps);
      }
      // A refused relationship or gender may mean this tab's list is stale (a spouse it never
      // saw, or an heir removed elsewhere), so read the case again. A failed read changes nothing.
      if (!result.errors.relationship && !result.errors.gender) {
        return refusedView(answer, from, result.errors);
      }
      const fresh = await refreshed(from, signal, deps);
      const gone = from.editingHeir !== null && !estateModel(fresh, from.layer, null).people.some(p => p.id === from.editingHeir);
      const layer = keepLayer(from.layer, fresh);
      if (gone) restoreHeirForm(deps, fresh.id);
      const reconciled = reconcileFresh(
        refusedView(
          answer,
          gone
            ? { ...from, case: fresh, layer, editingHeir: null, formEpoch: from.formEpoch + 1 }
            : { ...from, case: fresh, layer },
          result.errors,
        ),
        from,
        fresh,
        deps,
      );
      if (isTree(answer)) return { ...reconciled, focus: nextFocus(from, `addHere:${answer.values.relationship}`) };
      return isPanel(answer) ? { ...reconciled, focus: nextFocus(from, `add:${answer.values.relationship}`) } : reconciled;
    }
    case "gone":
      deps.selection.set(null);
      deps.forms.set(null);
      deps.seen.set(false);
      return { name: "none", expired: true };
    case "replaced": {
      if ((answer.kind === "saveHeir" || answer.kind === "removeHeir") && result.case.id === from.case.id) {
        const fresh = result.case;
        const live = reconcileFresh({ ...from, confirming: undefined, notice: null, errors: null, saving: false }, from, fresh, deps);
        if (!estateModel(fresh, live.layer, null).people.some(p => p.id === answer.heirId)) {
          restoreHeirForm(deps, fresh.id);
          return { ...live, editingHeir: null, conflict: true, focus: nextFocus(from, "card:root") };
        }
        const opener = answer.kind === "removeHeir" && answer.fromRow ? `remove:${answer.heirId}` as const : from.opener;
        return { ...startEditHeir(live, answer.heirId, deps, opener), conflict: true };
      }
      if ((isPanel(answer) || isTree(answer)) && result.case.id === from.case.id) {
        // The same case at a newer revision: a stale press. Show the live case and say so; never resend.
        const fresh = result.case;
        const gone = from.editingHeir !== null && !estateModel(fresh, from.layer, null).people.some(p => p.id === from.editingHeir);
        if (gone) restoreHeirForm(deps, fresh.id);
        const stale: StartedView = {
          ...from,
          case: fresh,
          layer: keepLayer(from.layer, fresh),
          ...(gone ? { editingHeir: null, formEpoch: from.formEpoch + 1 } : {}),
        };
        const reconciled = reconcileFresh(
          isTree(answer)
            ? treeView(stale, answer, { notice: "conflict" })
            : panelView(stale, answer.values.relationship, { notice: "conflict" }),
          from,
          fresh,
          deps,
        );
        return {
          ...reconciled,
          focus: nextFocus(from, isTree(answer) ? `addHere:${answer.values.relationship}` : `add:${answer.values.relationship}`),
        };
      }
      if (result.case.id === from.case.id) {
        // The same case at a newer revision: keep the screen and the visitor's input, adopt the live case, never resend.
        const fresh = result.case;
        const layer = keepLayer(from.layer, fresh);
        const { people } = estateModel(fresh, layer, null);
        const gone = from.editingHeir !== null && !people.some((p) => p.id === from.editingHeir);
        if (gone) restoreHeirForm(deps, fresh.id);
        const death = answer.kind === "markDeath" || answer.kind === "unmarkDeath";
        const reconciled = reconcileFresh({
          ...from,
          case: fresh,
          layer,
          confirming: undefined,
          notice: null,
          errors: null,
          saving: false,
          conflict: true,
          ...(answer.kind === "saveDeceased" ? { editingDeceased: true } : {}),
          ...(death
            ? { ordering: null, relativeQuestions: undefined, deathAnswers: undefined, deathFirst: undefined, deathOrderNeeded: undefined, sheetDeath: undefined }
            : {}),
          ...(gone ? { editingHeir: null, formEpoch: from.formEpoch + 1 } : {}),
        }, from, fresh, deps);
        if (!death) return reconciled;
        const target: FocusTarget = answer.kind === "markDeath" && answer.origin === "sheet" && reconciled.editingHeir !== null
          ? "editStatus:died_later"
          : people.some((p) => p.id === answer.rowId) ? `alsoDied:${answer.rowId}` : "card:root";
        return { ...reconciled, focus: nextFocus(from, target) };
      }
      deps.selection.set(null);
      deps.forms.set(null);
      deps.seen.set(true);
      return { name: "existing", case: result.case };
    }
    case "missing": {
      // The heir is gone: show the list as it is now, and tell the visitor.
      const stillThere = from.editingHeir !== null && estateModel(result.case, from.layer, null).people.some(p => p.id === from.editingHeir);
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
      const kept = reconcileFresh({
        ...from,
        case: fresh,
        layer: keepLayer(from.layer, fresh),
        notice: isPanel(answer) || isTree(answer) ? null : result.kind,
        // The errors pendingView cleared are not brought back by a failed save.
        errors: null,
        ...(isPanel(answer) ? { panel: { relationship: answer.values.relationship, notice: result.kind } } : {}),
        ...(isTree(answer) ? { tree: { relationship: answer.values.relationship, anchor: answer.anchor, notice: result.kind } } : {}),
        saving: false,
        // A failed removal puts focus back on the row button, which the question replaced.
        focus: answer.kind === "saveHeir" ? nextFocus(from, answer.field ?? "relationship") : answer.kind === "removeHeir" && !from.confirming && !from.editingHeir ? nextFocus(from, `remove:${answer.heirId}`) : from.focus,
      }, from, fresh, deps);
      if (isTree(answer)) return { ...kept, focus: nextFocus(from, `addHere:${answer.values.relationship}`) };
      return isPanel(answer) ? { ...kept, focus: nextFocus(from, `add:${answer.values.relationship}`) } : kept;
    }
  }
}

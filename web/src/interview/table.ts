import type { Preview, PreviewTable, TableColumnCode } from "../api/case.ts";
import { previewRows, type PreviewRow } from "./preview.ts";

type AvailablePreview = Extract<Preview, { status: "available" }>;

/** What the prescribed-share cell says: a fraction, or the text of one of two words. */
export type Prescribed =
  | { kind: "fraction"; fraction: string }
  | { kind: "residuary" }
  | { kind: "blocked" };

/** One cell of an engine column. `rowSpan` 0 means an earlier merged cell covers this row: render nothing. */
export type ViewCell = { value: number | null; rowSpan: number };

export type ViewRow = {
  heirId: string;
  prescribed: Prescribed;
  prescribedSpan: number;
  /** One cell per engine column, in column order. */
  cells: ViewCell[];
  /** The percentage, kirat and amount of the share; all null for a heir with no share. */
  percent: string | null;
  kirat: string | null;
  amount: string | null;
};

export type ViewColumn = { code: TableColumnCode; label: string; total: number };

/** Header captions and totals, then the body rows in the engine's order. */
export type TableView = { columns: ViewColumn[]; rows: ViewRow[] };

/**
 * The view model of the scholars' table. Columns, totals and cells are the engine's own numbers;
 * only the percentage, kirat and amount come from the share, by the existing formatting.
 */
export function tableView(table: PreviewTable, preview: AvailablePreview): TableView {
  const shares = new Map(previewRows(preview).rows.map((row) => [row.heirId, row] as const));
  return {
    columns: table.columns.map(({ code, label, total }) => ({ code, label, total })),
    rows: table.rows.map((row) => {
      const share: PreviewRow | undefined = shares.get(row.heir);
      return {
        heirId: row.heir,
        prescribedSpan: row.group_span,
        prescribed: row.blocked
          ? { kind: "blocked" }
          : row.prescribed === null
            ? { kind: "residuary" }
            : { kind: "fraction", fraction: `${row.prescribed.numerator}/${row.prescribed.denominator}` },
        cells: row.cells.map((cell) => ({ value: cell.value, rowSpan: cell.span })),
        percent: share?.percent ?? null,
        kirat: share?.kirat ?? null,
        amount: share?.amount ?? null,
      };
    }),
  };
}

/** Whether a preview has the table to show; layered (successive-death) previews keep the old display. */
export function hasTable(preview: AvailablePreview): preview is AvailablePreview & { table: PreviewTable } {
  return preview.table !== null;
}

/** The engine cells a row really renders: a cell an earlier merged cell covers is left out. */
export function bodyCells(
  row: ViewRow,
  columns: readonly ViewColumn[],
): { code: TableColumnCode; value: number | null; rowSpan: number }[] {
  return row.cells.flatMap((cell, index) =>
    cell.rowSpan === 0 ? [] : [{ code: columns[index].code, value: cell.value, rowSpan: cell.rowSpan }],
  );
}

/**
 * Which heir's side note is open. Hovering or focusing a heir shows that heir; a click pins it, so
 * it survives leaving; the note stays while the pointer is on the heir's row or on the note itself.
 */
export type NoteState = {
  /** The last heir the pointer was on, and whether it is still there. */
  hovered: string | null;
  over: boolean;
  /** Whether the pointer is on the note panel. */
  panel: boolean;
  focused: string | null;
  pinned: string | null;
};

export type NoteAction =
  | { type: "hover" | "unhover" | "focus" | "blur" | "toggle"; id: string }
  | { type: "escape" | "panelEnter" | "panelLeave" };

export const NO_NOTE: NoteState = { hovered: null, over: false, panel: false, focused: null, pinned: null };

/** The heir whose note shows: focus, then pointer, then the pin. */
export function visibleNote(state: NoteState): string | null {
  return state.focused ?? (state.over || state.panel ? state.hovered : null) ?? state.pinned;
}

export function noteReducer(state: NoteState, action: NoteAction): NoteState {
  switch (action.type) {
    case "hover":
      return { ...state, hovered: action.id, over: true };
    case "unhover":
      return state.hovered === action.id ? { ...state, over: false } : state;
    case "focus":
      return { ...state, focused: action.id };
    case "blur":
      return state.focused === action.id ? { ...state, focused: null } : state;
    case "panelEnter":
      return { ...state, panel: true };
    case "panelLeave":
      return { ...state, panel: false };
    case "escape":
      return NO_NOTE;
    case "toggle":
      // A click on the pinned heir closes the note for good; any other click pins that heir.
      return state.pinned === action.id ? NO_NOTE : { ...state, pinned: action.id };
  }
}

/** Forgets any heir that is no longer in the table, after a preview changes. Same object when nothing changed. */
export function pruneNote(state: NoteState, ids: ReadonlySet<string>): NoteState {
  const keep = (id: string | null) => (id !== null && ids.has(id) ? id : null);
  const next = { ...state, hovered: keep(state.hovered), focused: keep(state.focused), pinned: keep(state.pinned) };
  if (next.hovered === null) {
    next.over = false;
    next.panel = false;
  }
  const same =
    next.hovered === state.hovered &&
    next.focused === state.focused &&
    next.pinned === state.pinned &&
    next.over === state.over &&
    next.panel === state.panel;
  return same ? state : next;
}

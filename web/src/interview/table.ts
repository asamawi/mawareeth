import type { Case, Preview } from "../api/case.ts";
import type { LayeredTable, Num, PresentedTable, SingleTable } from "../contracts/presented.ts";
import { previewRows, type PreviewRow } from "./preview.ts";

type AvailablePreview = Extract<Preview, { status: "available" }>;

/** What the prescribed-share cell says: a fraction's text, or the text of one of two words. */
export type Prescribed =
  | { kind: "fraction"; fraction: string }
  | { kind: "residuary" }
  | { kind: "blocked" }
  | { kind: "empty" };

/** One cell of an engine column: the exact value beside the server's text for it. `rowSpan` 0 means an earlier merged cell covers this row: render nothing. */
export type ViewCell = { value: number | null; text: string | null; rowSpan: number; members?: string[]; covered?: boolean };

export type ViewRow = {
  kind?: "unallocated";
  heirId: string;
  prescribed: Prescribed;
  prescribedSpan: number;
  prescribedByLayer?: Prescribed[];
  /** One cell per engine column, in column order. */
  cells: ViewCell[];
  /** The presented percentage, kirat and amount of the share; all null for a heir with no share. */
  percent: string | null;
  kirat: string | null;
  amount: string | null;
};

/** A column's caption and total; `totalText` is the server's text for the total. */
export type ViewColumn = { code: string; label: string; total: number; totalText: string };

/** The facts of one heir's share, as the server's evidence words them. */
export type ProofText = {
  labels: {
    rule: string;
    condition: string | null;
    blocked_by: string | null;
    school_rule: string | null;
    option: string | null;
    verse: string | null;
  };
  /** The prescribed fraction of a fixed share, in the table's own text; null for any other rule. */
  fraction: string | null;
};

/** Header captions and totals, then the body rows in the engine's order. */
export type TableView = { columns: ViewColumn[]; rows: ViewRow[];
  groups?: { order: number; heir: string | null; count: number; p: string | null; old: string; next: string; relation: string | null }[];
  notes?: Record<string, { order: number; proof: ProofText }[]>;
};

const FRACTION_RULES = ["fixed", "fixed_and_residuary"];

const whole = (num: Num) => num.value as number;
const prescribedOf = (row: { blocked: boolean; prescribed: Num | null }): Prescribed =>
  row.blocked ? { kind: "blocked" } : row.prescribed === null ? { kind: "residuary" } : { kind: "fraction", fraction: row.prescribed.text };

/** Every person's evidence per estate, worded by the server: the one source of the proof panels. */
export function evidenceNotes(preview: AvailablePreview): Record<string, { order: number; proof: ProofText }[]> {
  const presented = preview.presented;
  const notes: Record<string, { order: number; proof: ProofText }[]> = Object.create(null);
  if (!presented) return notes;
  const table = presented.table;
  const tables: SingleTable[] = table === null ? [] : "layers" in table ? table.layers.map((layer) => layer.table) : [table];
  for (const entry of presented.evidence) {
    const rows = tables[entry.order - 1]?.rows ?? [];
    for (const heir of entry.heirs) {
      const prescribed = FRACTION_RULES.includes(heir.rule.code) ? rows.find((row) => row.heir === heir.person)?.prescribed ?? null : null;
      (notes[heir.person] ??= []).push({
        order: entry.order,
        proof: {
          labels: {
            rule: heir.rule.text,
            condition: heir.condition?.text ?? null,
            blocked_by: heir.blocked_by?.text ?? null,
            school_rule: heir.school_rule?.text ?? null,
            option: heir.option?.text ?? null,
            verse: heir.verses.length > 0 ? heir.verses.map((verse) => verse.text).join("; ") : null,
          },
          fraction: prescribed?.text ?? null,
        },
      });
    }
  }
  return notes;
}

/** The relationship id of every heir of the case by session id, each person by the estate they first appear in. */
export function relationsOf(kase: Case): Record<string, string> {
  const relations: Record<string, string> = {};
  for (const heir of kase.heirs) relations[heir.id] = heir.relationship;
  for (const death of kase.deaths ?? []) for (const heir of death.heirs) if (!heir.same_as) relations[heir.id] = heir.relationship;
  return relations;
}

/** The scholars' table the server presented, or null when it gave none to show. */
export function tableOf(preview: AvailablePreview): PresentedTable | null {
  return preview.presented?.table ?? null;
}

/**
 * The view model of the scholars' table. Columns, totals and cells are the engine's own numbers
 * and the server's own texts for them; nothing is calculated or formatted here.
 */
export function tableView(table: PresentedTable, preview: AvailablePreview): TableView {
  if ("layers" in table) return layeredTableView(table, preview);
  const shares = new Map(previewRows(preview).rows.map((row) => [row.heirId, row] as const));
  return {
    columns: table.columns.map((column) => ({ code: column.code, label: column.label, total: whole(column.total), totalText: column.total.text })),
    rows: table.rows.map((row) => {
      const share: PreviewRow | undefined = shares.get(row.heir);
      return {
        heirId: row.heir,
        prescribedSpan: row.group_span,
        prescribed: prescribedOf(row),
        cells: row.cells.map((cell) => ({ value: cell.value === null ? null : whole(cell.value), text: cell.value?.text ?? null, rowSpan: cell.span })),
        percent: share?.percent ?? null,
        kirat: share?.kirat ?? null,
        amount: share?.amount ?? null,
      };
    }),
  };
}

/** Project server numbers and texts into columns; no parts or bases are calculated in the browser. */
function layeredTableView(table: LayeredTable, preview: AvailablePreview): TableView {
  const shares = new Map(previewRows(preview).rows.map((r) => [r.heirId, r]));
  const columns: ViewColumn[] = [];
  const groups: NonNullable<TableView["groups"]> = [];
  for (const layer of table.layers) {
    columns.push({ code: `${layer.order}:prescribed`, label: "prescribed", total: 0, totalText: "" });
    columns.push(...layer.table.columns.map((c) => ({ code: `${layer.order}:${c.code}`, label: c.label, total: whole(c.total), totalText: c.total.text })));
    if (layer.order > 1) columns.push({ code: `${layer.order}:jamia`, label: "jamia", total: whole(layer.jamia), totalText: layer.jamia.text });
    groups.push({
      order: layer.order, heir: layer.heir, count: layer.table.columns.length + 1 + (layer.order > 1 ? 1 : 0),
      p: layer.p === null ? null : layer.p.text, old: layer.old_multiplier.text, next: layer.new_multiplier.text, relation: layer.relation,
    });
  }
  const notes = evidenceNotes(preview);
  const rows = [...table.rows.map((r) => ({ id: r.heir, kind: undefined })), ...(table.unallocated ? [{ id: "", kind: "unallocated" as const }] : [])].map(({ id, kind }): ViewRow => {
    const cells: ViewCell[] = [];
    const prescribedByLayer: Prescribed[] = [];
    for (const layer of table.layers) {
      const row = kind === "unallocated" ? undefined : layer.table.rows.find((r) => r.heir === id);
      prescribedByLayer.push(row ? prescribedOf(row) : { kind: "empty" });
      const prescribedPosition = row ? layer.table.rows.indexOf(row) : -1;
      let prescribedOwner = prescribedPosition;
      while (prescribedOwner > 0 && layer.table.rows[prescribedOwner].group_span === 0) prescribedOwner--;
      const prescribedSpan = prescribedOwner < 0 ? 1 : layer.table.rows[prescribedOwner].group_span;
      const prescribedMembers = layer.table.rows.slice(prescribedOwner, prescribedOwner + prescribedSpan).map((r) => r.heir);
      const prescribedPositions = prescribedMembers.map((member) => table.rows.findIndex((r) => r.heir === member));
      const prescribedContiguous = prescribedPositions.every((p, i) => i === 0 || p === prescribedPositions[i - 1] + 1);
      cells.push({ value: null, text: null, rowSpan: prescribedContiguous ? prescribedOwner === prescribedPosition ? prescribedSpan : 0 : 1,
        members: !prescribedContiguous && prescribedSpan > 1 ? prescribedMembers : undefined, covered: !prescribedContiguous && prescribedOwner !== prescribedPosition });
      // A group may cease to be consecutive across deaths. Keep its total intact and name
      // its members in that case; otherwise use the original merged cell.
      for (let c = 0; c < layer.table.columns.length; c++) {
        if (!row) {
          const left = kind === "unallocated" ? layer.unallocated_cells[c] : null;
          cells.push({ value: left === null ? null : whole(left), text: left === null ? null : left.text, rowSpan: 1 });
          continue;
        }
        const position = layer.table.rows.indexOf(row);
        let owner = position;
        while (owner > 0 && layer.table.rows[owner].cells[c].span === 0) owner--;
        const cell = layer.table.rows[owner].cells[c];
        const value = cell.value === null ? null : whole(cell.value);
        const text = cell.value === null ? null : cell.value.text;
        const members = layer.table.rows.slice(owner, owner + cell.span).map((r) => r.heir);
        const positions = members.map((member) => table.rows.findIndex((r) => r.heir === member));
        const contiguous = positions.every((p, i) => i === 0 || p === positions[i - 1] + 1);
        cells.push(contiguous
          ? { value, text, rowSpan: owner === position ? cell.span : 0 }
          : { value, text, rowSpan: 1, members: cell.span > 1 ? members : undefined, covered: owner !== position });
      }
      if (layer.order > 1) {
        const part = kind === "unallocated" ? layer.unallocated : layer.parts.find((p) => p.heir === id)?.value ?? null;
        cells.push({ value: part === null ? 0 : whole(part), text: part === null ? null : part.text, rowSpan: 1 });
      }
    }
    const share = kind === "unallocated" ? undefined : shares.get(id);
    return { kind, heirId: id, prescribed: { kind: "empty" }, prescribedSpan: 0, prescribedByLayer, cells, percent: share?.percent ?? null, kirat: share?.kirat ?? null, amount: share?.amount ?? null };
  });
  return { columns, rows, groups, notes };
}

/** Whether the server presented a consistent table to show. */
export function hasTable(preview: AvailablePreview): preview is AvailablePreview & { presented: { table: PresentedTable } } {
  return tableOf(preview) !== null;
}

/** The engine cells a row really renders: a cell an earlier merged cell covers is left out. */
export function bodyCells(
  row: ViewRow,
  columns: readonly ViewColumn[],
): (ViewCell & { code: string })[] {
  return row.cells.flatMap((cell, index) =>
    cell.rowSpan === 0 ? [] : [{ ...cell, code: columns[index].code }],
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

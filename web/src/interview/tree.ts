import type { Case, Gender, Placement, RelationshipId } from "../api/case.ts";
import { layerAt, personOf } from "./layers.ts";
import { heirLabels } from "./answers.ts";
import type { PresentedResult } from "../contracts/presented.ts";
import type { Messages } from "../i18n/messages.ts";

/**
 * Generation lines, top to bottom. The deceased sits on the spine between lines 2 and 3.
 * Order within a line follows the order of these lists, then the order added.
 */
const LINES: readonly (readonly RelationshipId[])[] = [
  ["grandfather", "paternal_grandmother", "maternal_grandmother"],
  ["father", "mother", "uncle", "paternal_uncle"],
  [
    "husband",
    "wife",
    "brother",
    "sister",
    "paternal_brother",
    "paternal_sister",
    "maternal_brother",
    "maternal_sister",
    "son_of_uncle",
    "son_of_paternal_uncle",
  ],
  ["son", "daughter", "son_of_brother", "son_of_paternal_brother"],
  ["son_of_son", "daughter_of_son"],
];

/** The line (from 1) above which the deceased sits: lines 1 and 2 are above, 3 to 5 below. */
export const LINES_ABOVE = 2;

export function generationLines(): { line: number; relationships: RelationshipId[] }[] {
  return LINES.map((relationships, index) => ({ line: index + 1, relationships: [...relationships] }));
}

const TABLE_ORDER: RelationshipId[] = LINES.flat();

export function lineOf(relationship: RelationshipId): number {
  return LINES.findIndex((line) => line.includes(relationship)) + 1;
}

export const NODE_HEIGHT = 112;
export const DECEASED_HEIGHT = 112;
export const NODE_WIDTH = 108;
export const COLUMN_GAP = 8;
export const SPINE_GAP = 24;
export const ROW_GAP = 32;

export type TreeNode = {
  id: string;
  line: number;
  /** Which side of the spine, in reading direction: "start" is inline-start. */
  side: "start" | "end";
  /** Distance from the inline-start edge, in the reading direction. */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TreeEdge = {
  id: string;
  /** SVG path in left-to-right coordinates; the view mirrors it for right-to-left. */
  path: string;
};

export type TreeLayout = {
  width: number;
  height: number;
  /** The x of the spine. */
  spineX: number;
  deceased: { x: number; y: number; width: number; height: number };
  nodes: TreeNode[];
  edges: TreeEdge[];
  /** Vertical extent of the spine. */
  spine: { top: number; bottom: number };
  columns: number;
};

/**
 * Places the deceased on a central spine and every heir on a generation line, wrapped into
 * rows. Each row is split evenly across the spine, the odd one on the inline-start side. The
 * layout depends only on the heirs of the same line, so adding an heir never moves the heirs
 * of another line sideways.
 */
export function layoutTree(model: EstateModel, width: number, cardWidth = NODE_WIDTH): TreeLayout {
  const heirs = readingOrder(model.people);
  const total = Math.max(2 * SPINE_GAP, Math.floor(width));
  const spineX = Math.floor(total / 2);
  const usable = spineX * 2;
  const nodeWidth = cardWidth;
  const perSide = Math.max(
    1,
    Math.floor((usable - SPINE_GAP + COLUMN_GAP) / (2 * (nodeWidth + COLUMN_GAP))),
  );
  const capacity = perSide * 2;
  const half = SPINE_GAP / 2;

  const byLine = LINES.map(line => heirs.filter(person => line.includes(person.relationship)));

  const nodes: TreeNode[] = [];
  const edges: TreeEdge[] = [];
  const bars: number[] = [];
  const ancestorBars: number[] = [];
  let y = 0;

  const placeLine = (lineIndex: number) => {
    // Ancestors feed down into the deceased: node, then bar, then the next row. Everyone
    // else hangs below: bar, then node.
    const ancestors = lineIndex < LINES_ABOVE;
    const members = byLine[lineIndex];
    for (let start = 0; start < members.length; start += capacity) {
      const row = members.slice(start, start + capacity);
      const left = Math.ceil(row.length / 2);
      const top = ancestors ? y : y + ROW_GAP;
      const barY = ancestors ? top + NODE_HEIGHT + ROW_GAP / 2 : y + ROW_GAP / 2;
      bars.push(barY);
      if (ancestors) ancestorBars.push(barY);
      row.forEach((heir, index) => {
        const onStart = index < left;
        const x = onStart
          ? spineX - half - (left - index) * nodeWidth - (left - index - 1) * COLUMN_GAP
          : spineX + half + (index - left) * (nodeWidth + COLUMN_GAP);
        nodes.push({
          id: heir.id,
          line: lineIndex + 1,
          side: onStart ? "start" : "end",
          x,
          y: top,
          width: nodeWidth,
          height: NODE_HEIGHT,
        });
        const centre = x + nodeWidth / 2;
        const touch = ancestors ? top + NODE_HEIGHT : top;
        edges.push({ id: heir.id, path: `M${spineX} ${barY}H${centre}V${touch}` });
      });
      y = ancestors ? top + NODE_HEIGHT + ROW_GAP : top + NODE_HEIGHT;
    }
  };

  for (let line = 0; line < LINES_ABOVE; line += 1) placeLine(line);
  const deceasedY = y;
  const deceasedWidth = cardWidth;
  const deceased = {
    x: spineX - Math.floor(deceasedWidth / 2),
    y: deceasedY,
    width: deceasedWidth,
    height: DECEASED_HEIGHT,
  };
  y = deceasedY + DECEASED_HEIGHT;
  for (let line = LINES_ABOVE; line < LINES.length; line += 1) placeLine(line);

  for (const node of nodes) {
    const person = model.people.find(p => p.id === node.id);
    const parent = nodes.find(n => model.people.find(p => p.id === n.id)?.personId === person?.parentId);
    if (parent) {
      const desired = parent.x;
      if (!nodes.some(n => n.id !== node.id && n.y === node.y && desired < n.x + n.width + COLUMN_GAP && desired + node.width + COLUMN_GAP > n.x)) {
        node.x = desired;
        node.side = desired < spineX ? "start" : "end";
      }
      const edge = edges.find(e => e.id === node.id)!;
      edge.path = `M${parent.x + parent.width / 2} ${parent.y + parent.height}V${node.y - 16}H${node.x + node.width / 2}V${node.y}`;
    }
  }
  return {
    width: usable,
    height: y,
    spineX,
    deceased,
    nodes,
    edges,
    spine: {
      top: ancestorBars.length > 0 ? Math.min(...ancestorBars) : deceasedY,
      bottom: Math.max(deceasedY + DECEASED_HEIGHT, ...bars),
    },
    columns: capacity,
  };
}

export type TreePerson = {
  id: string; personId: string; relationship: RelationshipId; gender: Gender;
  name: string | null; state: "normal" | "died_before" | "died_later" | "blocked";
  parentId: string | null;
};
export type EstateModel = { people: TreePerson[]; placement: Placement };

/** Presented evidence is supplied only by the current available preview. */
export function estateModel(kase: Case, layerId: string | null, presented: PresentedResult | null): EstateModel {
  const layer = layerAt(kase, layerId);
  const death = kase.deaths.find(d => d.heir_id === layer.id);
  const blocked = new Set(presented?.evidence.find(e => e.order === layer.order)?.heirs.filter(h => h.rule.code === "blocked").map(h => h.person));
  const people: TreePerson[] = layer.heirs.map(h => {
    const personId = personOf(h);
    const person = kase.persons?.find(p => p.id === personId);
    return { id: h.id, personId, relationship: h.relationship, gender: h.gender, name: h.name,
      state: person?.status === "died_before_or_with" ? "died_before" : kase.deaths.some(d => d.heir_id === personId && d.heir_id !== layer.id) ? "died_later" : blocked.has(personId) ? "blocked" : "normal", parentId: null };
  });
  if (layer.id === null) for (const p of kase.persons ?? []) {
    if (p.status === "died_before_or_with" && p.relationship && !people.some(h => h.personId === p.id))
      people.push({ id: p.id, personId: p.id, relationship: p.relationship, gender: p.gender, name: p.name, state: "died_before", parentId: null });
  }
  for (const edge of kase.edges ?? []) {
    const from = edge.from === layer.id ? "root" : edge.from;
    const to = edge.to === layer.id ? "root" : edge.to;
    if (edge.kind !== "parent_of" || from === "root" || to === "root") continue;
    const child = people.find(p => p.personId === to);
    if (child && people.some(p => p.personId === from)) child.parentId = from;
  }
  return { people: readingOrder(people), placement: death?.placement ?? (layer.id === null ? kase.placement : undefined) ?? {} };
}

/** One stable reading order for the canvas, keyboard and canonical outline. */
function readingOrder(input: readonly TreePerson[]): TreePerson[] {
  const people = [...input].sort((a,b) => TABLE_ORDER.indexOf(a.relationship) - TABLE_ORDER.indexOf(b.relationship));
  // Stable generation order, with linked children following their parent's inline order.
  for (const line of LINES) {
    const indices = people.map((p,i) => line.includes(p.relationship) ? i : -1).filter(i => i >= 0);
    const sorted = indices.map(i => people[i]).sort((a,b) => {
      const rank = (p: TreePerson) => p.parentId ? people.findIndex(q => q.personId === p.parentId) : Infinity;
      return rank(a) - rank(b);
    });
    indices.forEach((i,j) => { people[i] = sorted[j]; });
  }
  return people;
}
/** Choose a surviving sibling using the order and parentage before the removal. */
export function focusAfterRemoval(model: EstateModel, id: string, surviving?: ReadonlySet<string>): string {
  const ordered = readingOrder(model.people);
  const person = ordered.find(p => p.id === id);
  if (!person) return "root";
  const siblings = ordered.filter(p => p.parentId === person.parentId && lineOf(p.relationship) === lineOf(person.relationship));
  const index = siblings.findIndex(p => p.id === id);
  const candidates = [...siblings.slice(index + 1), ...siblings.slice(0, index).reverse()];
  return candidates.find(p => !surviving || surviving.has(p.id))?.id ?? "root";
}
export function treeDescription(messages: Messages["interview"], model: EstateModel, rootText?: string) {
  const people = readingOrder(model.people);
  const labels = heirLabels(people.map(p => ({ ...p, edit_options: { blocked: [], invalid: {} } })), messages.relationships, messages.heirNumbered);
  return { deceased: rootText ?? messages.treeDeceased, people: people.map(p => {
    const relationship = messages.relationships[p.relationship];
    return { id: p.id, state: p.state, label: labels[p.id], relationship, secondary: p.name ?? (labels[p.id] !== relationship ? labels[p.id] : null),
      badge: p.state === "died_before" ? messages.treeDiedBefore[p.gender] : p.state === "died_later" ? messages.treeDiedLater[p.gender] : p.state === "blocked" ? messages.treeNoShare : null,
      noShare: p.state === "blocked" };
  }) };
}
export function placeholders(model: EstateModel): ("parent" | "spouse")[] {
  return model.people.length ? [] : (["parent", "spouse"] as const).filter(link => model.placement.root?.some(o => o.link === link));
}
export const ZOOM_LEVELS = [0.6, 0.8, 1, 1.25, 1.5] as const;
export type Box = { x: number; y: number; width: number; height: number };
export type Viewport = { width: number; height: number; scrollLeft: number; scrollTop: number };
export function pinBox(box: Box, view: Viewport, zoom: number, pad = 6, rtl = false): Box {
  const inline = rtl ? -view.scrollLeft : view.scrollLeft;
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, max));
  return { ...box, x: clamp(box.x, (inline + pad) / zoom, (inline + view.width - pad) / zoom - box.width), y: clamp(box.y, (view.scrollTop + pad) / zoom, (view.scrollTop + view.height - pad) / zoom - box.height) };
}
export function fitZoom(layout: Pick<TreeLayout, "width" | "height">, view: Pick<Viewport, "width" | "height">): number {
  return [...ZOOM_LEVELS].reverse().find(z => z <= 1 && layout.width * z <= view.width - 12 && layout.height * z <= view.height - 12) ?? 0.6;
}

/**
 * How far to scroll along one axis so a node shows in full, with the least movement: 0 when it
 * already shows, and to its start when it is larger than the view. All four values are on-screen
 * coordinates, so they already include the canvas zoom.
 */
export function scrollDelta(start: number, end: number, viewStart: number, viewEnd: number): number {
  if (start < viewStart || end - start >= viewEnd - viewStart) return start - viewStart;
  if (end > viewEnd) return end - viewEnd;
  return 0;
}

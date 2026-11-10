import type { Deceased, Heir, RelationshipId } from "../api/case.ts";
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

/** The count of heirs per relationship, in table order, leaving out relationships with none. */
export function treeSummary(
  heirs: readonly Pick<Heir, "relationship">[],
): { relationship: RelationshipId; count: number }[] {
  const counts = new Map<RelationshipId, number>();
  for (const heir of heirs) counts.set(heir.relationship, (counts.get(heir.relationship) ?? 0) + 1);
  return TABLE_ORDER.filter((id) => counts.has(id)).map((id) => ({
    relationship: id,
    count: counts.get(id) ?? 0,
  }));
}

export const NODE_HEIGHT = 80;
export const DECEASED_HEIGHT = 64;
export const NODE_WIDTH = 128;
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
export function layoutTree(heirs: readonly Pick<Heir, "id" | "relationship">[], width: number): TreeLayout {
  const total = Math.max(2 * SPINE_GAP, Math.floor(width));
  const spineX = Math.floor(total / 2);
  const usable = spineX * 2;
  const nodeWidth = Math.max(1, Math.min(NODE_WIDTH, Math.floor((usable - SPINE_GAP) / 2)));
  const perSide = Math.max(
    1,
    Math.floor((usable - SPINE_GAP + COLUMN_GAP) / (2 * (nodeWidth + COLUMN_GAP))),
  );
  const capacity = perSide * 2;
  const half = SPINE_GAP / 2;

  const order = new Map<RelationshipId, number>(TABLE_ORDER.map((id, index) => [id, index]));
  const byLine: Pick<Heir, "id" | "relationship">[][] = LINES.map(() => []);
  for (const heir of heirs) {
    const line = lineOf(heir.relationship);
    if (line > 0) byLine[line - 1].push(heir);
  }
  for (const members of byLine) {
    // Array sort is stable, so equal relationships keep the order added.
    members.sort((a, b) => (order.get(a.relationship) ?? 0) - (order.get(b.relationship) ?? 0));
  }

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
  const deceasedWidth = Math.min(usable, 200);
  const deceased = {
    x: spineX - Math.floor(deceasedWidth / 2),
    y: deceasedY,
    width: deceasedWidth,
    height: DECEASED_HEIGHT,
  };
  y = deceasedY + DECEASED_HEIGHT;
  for (let line = LINES_ABOVE; line < LINES.length; line += 1) placeLine(line);

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

/** The one text description of the tree: structure by relationship and count, never names. */
export function treeDescription(
  messages: Messages["interview"],
  deceased: Pick<Deceased, "gender"> & Partial<Deceased>,
  heirs: readonly Pick<Heir, "relationship">[],
  /** A later layer's root, such as "Son (2nd death)", instead of the first deceased's text. */
  rootText?: string,
): string {
  const who =
    rootText ?? (deceased.gender === "male" ? messages.treeDeceasedMale : messages.treeDeceasedFemale);
  const counts = treeSummary(heirs)
    .map((item) =>
      messages.treeCount.replace(/\{relationship\}|\{n\}/g, (token) =>
        token === "{relationship}" ? messages.relationships[item.relationship] : String(item.count),
      ),
    )
    .join(" ");
  return messages.treeSummary.replace(/\{deceased\}|\{heirs\}/g, (token) =>
    token === "{deceased}" ? who : counts ? ` ${counts}` : "",
  );
}

/**
 * The smallest scroll position that shows a node in full: unchanged when it already shows,
 * and the node's top when it is taller than the view.
 */
export function scrollTopFor(nodeTop: number, nodeHeight: number, scrollTop: number, viewHeight: number): number {
  if (nodeTop < scrollTop || nodeHeight >= viewHeight) return Math.max(0, nodeTop);
  if (nodeTop + nodeHeight > scrollTop + viewHeight) return Math.max(0, nodeTop + nodeHeight - viewHeight);
  return Math.max(0, scrollTop);
}

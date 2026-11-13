import type { Case, Death, Gender, Heir, HeirOptions } from "../api/case.ts";
import { heirLabels } from "./answers.ts";

/**
 * Pure helpers for the layers of a case: the first deceased's heirs, then one layer of heirs for
 * each later death. They only read what the server sent. Order of death, links and pruning are
 * the server's, never inferred here.
 */
export type Layer = {
  /** Null for the first deceased, else the id of the person (their earliest row) who died. */
  id: string | null;
  /** The place in the order of death; the first deceased is 1. */
  order: 1 | 2 | 3;
  /** Null only while the first deceased is not stored. */
  gender: Gender | null;
  heirs: Heir[];
  options: HeirOptions;
};

/** The first deceased's layer, then each later death's, in death order. */
export function layersOf(kase: Pick<Case, "deceased" | "heirs" | "heir_options" | "deaths">): Layer[] {
  return [
    {
      id: null,
      order: 1,
      gender: kase.deceased?.gender ?? null,
      heirs: kase.heirs,
      options: kase.heir_options,
    },
    ...kase.deaths.map((death) => ({
      id: death.heir_id,
      order: death.order,
      gender: death.gender,
      heirs: death.heirs,
      options: death.heir_options,
    })),
  ];
}

/** A case with no later deaths looks and behaves exactly as before 1.7. */
export function hasDeaths(kase: Pick<Case, "deaths">): boolean {
  return kase.deaths.length > 0;
}

/** The person a row stands for: their earliest row's id. */
export function personOf(row: Pick<Heir, "id" | "same_as">): string {
  return row.same_as ?? row.id;
}

/** The layer to show: the one asked for, or the first deceased's when it no longer exists. */
export function layerAt(kase: Pick<Case, "deceased" | "heirs" | "heir_options" | "deaths">, id: string | null): Layer {
  const layers = layersOf(kase);
  return layers.find((layer) => layer.id === id) ?? layers[0];
}

/** After a write: the active layer stays only while its death still exists. */
export function keepLayer(id: string | null, kase: Pick<Case, "deaths">): string | null {
  return id !== null && kase.deaths.some((death) => death.heir_id === id) ? id : null;
}

/** Every row of every layer by id, with the index of the layer it is in. */
export function rowsOf(kase: Pick<Case, "deceased" | "heirs" | "heir_options" | "deaths">): Map<string, { row: Heir; layer: number }> {
  const rows = new Map<string, { row: Heir; layer: number }>();
  layersOf(kase).forEach((layer, index) => {
    for (const row of layer.heirs) rows.set(row.id, { row, layer: index });
  });
  return rows;
}

/** The death of a person (by their earliest row's id), if any. */
export function deathOf(kase: Pick<Case, "deaths">, personId: string): Death | undefined {
  return kase.deaths.find((death) => death.heir_id === personId);
}

/**
 * The people an added row in this layer could be: those whose earliest row is in an earlier layer,
 * minus this layer's deceased, people already in the layer, and people who died before this layer's
 * death. Gender and aliveness are left to the server's codes.
 */
export function linkCandidates(
  kase: Pick<Case, "deceased" | "heirs" | "heir_options" | "deaths">,
  layerId: string | null,
): Heir[] {
  const layers = layersOf(kase);
  const at = layers.findIndex((layer) => layer.id === layerId);
  if (at <= 0) return [];
  const layer = layers[at];
  const inLayer = new Set(layer.heirs.map(personOf));
  const candidates: Heir[] = [];
  for (const earlier of layers.slice(0, at)) {
    for (const row of earlier.heirs) {
      if (row.same_as !== undefined || row.id === layer.id || inLayer.has(row.id)) continue;
      const death = deathOf(kase, row.id);
      if (death && death.order < layer.order) continue;
      candidates.push(row);
    }
  }
  return candidates;
}

/** Puts the two names into the "{heir} of {deceased}" sentence, with no replacer patterns. */
export function ofDeceased(template: string, heir: string, deceased: string): string {
  return template.replace(/\{heir\}|\{deceased\}/g, (token) => token === "{heir}" ? heir : deceased);
}

/**
 * The label of every row of every layer, by id, so a preview row never reads as a raw id. A
 * person is labelled by their earliest row in that row's own layer; one first entered in a later
 * layer reads "<relationship or name> of <that layer's deceased label>". A linked row has its
 * person's label.
 */
export function rowLabels(
  kase: Pick<Case, "deceased" | "heirs" | "heir_options" | "deaths">,
  relationships: Record<string, string>,
  numbered: string,
  ofTemplate: string,
): Record<string, string> {
  const layers = layersOf(kase);
  const own: Record<string, string> = {};
  for (const layer of layers) Object.assign(own, heirLabels(layer.heirs, relationships, numbered));
  const rows = rowsOf(kase);
  const labels: Record<string, string> = {};
  for (const layer of layers) {
    for (const row of layer.heirs) {
      const person = rows.get(personOf(row));
      const base = own[personOf(row)] ?? own[row.id];
      const home = person ? layers[person.layer] : layers[0];
      labels[row.id] =
        home.id === null || home.id === undefined ? base : ofDeceased(ofTemplate, base, own[home.id] ?? home.id);
    }
  }
  return labels;
}

export type Crumb = {
  /** Null for the first deceased. */
  id: string | null;
  order: 1 | 2 | 3;
  /** The deceased's label inside their own layer; null for the first deceased. */
  label: string | null;
};

/** The first deceased, then each later death, in death order. */
export function breadcrumb(
  kase: Pick<Case, "deceased" | "heirs" | "heir_options" | "deaths">,
  relationships: Record<string, string>,
  numbered: string,
): Crumb[] {
  const layers = layersOf(kase);
  const own: Record<string, string> = {};
  for (const layer of layers) Object.assign(own, heirLabels(layer.heirs, relationships, numbered));
  return layers.map((layer) => ({
    id: layer.id,
    order: layer.order,
    label: layer.id === null ? null : (own[layer.id] ?? layer.id),
  }));
}

/** The label of a layer's deceased inside their own layer; null for the first deceased. */
export function deceasedLabel(
  kase: Pick<Case, "deceased" | "heirs" | "heir_options" | "deaths">,
  layerId: string | null,
  relationships: Record<string, string>,
  numbered: string,
): string | null {
  return breadcrumb(kase, relationships, numbered).find((crumb) => crumb.id === layerId)?.label ?? null;
}

/** Whether removing this row also removes its person's death and heirs. */
export function removesDeath(kase: Case, rowId: string): boolean {
  const rows = [...rowsOf(kase).values()].map(({ row }) => row);
  const row = rows.find((row) => row.id === rowId);
  return row !== undefined && deathOf(kase, personOf(row)) !== undefined &&
    rows.filter((other) => personOf(other) === personOf(row)).length === 1;
}

/** Substitute a layer label without interpreting names as placeholders or replacement patterns. */
export function deathLayerText(template: string, label: string, order: string): string {
  return template.replace(/\{label\}|\{order\}/g, (token) => token === "{label}" ? label : order);
}

import { RELATIONSHIP_IDS, type HeirOptions, type PlacementOption, type RelationshipId } from "../api/case.ts";

/**
 * Which relationships the Add relatives panel offers, grouped for display only. The server decides
 * what is allowed: this reads its placement and options and holds no kinship rules of its own.
 */
export type AddGroupKey = "spouse" | "parents" | "children" | "siblings" | "more";

export type AddEntry = { id: RelationshipId; blocked: boolean };
export type AddGroup = { key: AddGroupKey; entries: AddEntry[] };

/** The fixed display map; `more` is every other relationship, in catalog order. */
const SPOUSE: readonly RelationshipId[] = ["husband", "wife"];
const PARENTS: readonly RelationshipId[] = ["father", "mother"];
const CHILDREN: readonly RelationshipId[] = ["son", "daughter"];
const SIBLINGS: readonly RelationshipId[] = [
  "brother",
  "sister",
  "paternal_brother",
  "paternal_sister",
  "maternal_brother",
  "maternal_sister",
];

export const ADD_GROUPS: readonly { key: AddGroupKey; ids: readonly RelationshipId[] }[] = [
  { key: "spouse", ids: SPOUSE },
  { key: "parents", ids: PARENTS },
  { key: "children", ids: CHILDREN },
  { key: "siblings", ids: SIBLINGS },
  {
    key: "more",
    ids: RELATIONSHIP_IDS.filter((id) => ![...SPOUSE, ...PARENTS, ...CHILDREN, ...SIBLINGS].includes(id)),
  },
];

/**
 * The groups to offer for the active estate. Spouse, parents and children come from the estate's
 * `placement.root` (kept in its order); siblings and more come from `heir_options`. With no
 * placement at all (an older server) the first three fall back to `heir_options` too. Groups with
 * nothing to offer are left out.
 */
export function addGroups(placementRoot: readonly PlacementOption[] | undefined, options: HeirOptions): AddGroup[] {
  const fromOptions = (ids: readonly RelationshipId[]): AddEntry[] =>
    ids
      .filter((id) => options.invalid[id] === undefined)
      .map((id) => ({ id, blocked: options.blocked.includes(id) }));
  const fromPlacement = (ids: readonly RelationshipId[]): AddEntry[] => {
    const seen = new Set<RelationshipId>();
    const entries: AddEntry[] = [];
    for (const option of placementRoot ?? []) {
      if (!ids.includes(option.relationship) || seen.has(option.relationship)) continue;
      seen.add(option.relationship);
      entries.push({ id: option.relationship, blocked: option.blocked });
    }
    return entries;
  };
  return ADD_GROUPS.map(({ key, ids }) => ({
    key,
    entries: placementRoot !== undefined && (key === "spouse" || key === "parents" || key === "children")
      ? fromPlacement(ids)
      : fromOptions(ids),
  })).filter((group) => group.entries.length > 0);
}

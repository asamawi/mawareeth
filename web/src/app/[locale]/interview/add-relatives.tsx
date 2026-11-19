"use client";

import type { RelationshipId } from "@/api/case";
import type { Messages } from "@/i18n/messages";
import { heirOptionLabels } from "@/interview/answers";
import type { PanelOutcome } from "@/interview/flow";
import type { AddGroup, AddGroupKey } from "@/interview/relatives";

import { focusRingOnAccent } from "../ui";
import { errorText } from "./form-bits";

type Props = {
  messages: Messages["interview"];
  groups: AddGroup[];
  /** The active layer has the most heirs a case may hold: every add is unavailable. */
  atLimit: boolean;
  /** A save is in flight or the browser is offline: a press does nothing. */
  disabled: boolean;
  /** What the last press left behind: a refusal, a conflict or a failure. */
  outcome?: PanelOutcome;
  onAdd: (relationship: RelationshipId) => void;
};

/** Splits "Add {relationship}" around the placeholder, so the label can sit between its two halves. */
function around(template: string): [string, string] {
  const at = template.indexOf("{relationship}");
  return at < 0 ? [template, ""] : [template.slice(0, at), template.slice(at + "{relationship}".length)];
}

/** The text of an outcome: refusal codes, a conflict, or a failed or throttled write. */
function outcomeText(messages: Messages["interview"], outcome: PanelOutcome | undefined): string | null {
  if (!outcome) return null;
  const parts: string[] = [];
  for (const field of Object.keys(outcome.errors ?? {})) {
    const text = errorText(messages, field, outcome.errors ?? null);
    if (text) parts.push(text);
  }
  if (outcome.notice === "conflict") parts.push(messages.conflictNotice);
  else if (outcome.notice === "throttled") parts.push(messages.throttled);
  else if (outcome.notice === "failed") parts.push(messages.failed);
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * The Add relatives panel: one button per relationship the server allows. A press sends one add
 * with no name. Buttons are never natively disabled, so the focused one keeps focus.
 */
export function AddRelatives({ messages, groups, atLimit, disabled, outcome, onAdd }: Props) {
  const labels = heirOptionLabels(
    { blocked: groups.flatMap((group) => group.entries.filter((entry) => entry.blocked).map((entry) => entry.id)), invalid: {} },
    true,
    messages.relationships,
    messages.heirRelationshipBlocked,
  );
  const labelOf = new Map(labels.map((option) => [option.id, option.label]));
  const headings: Record<AddGroupKey, string> = {
    spouse: messages.addGroupSpouse,
    parents: messages.addGroupParents,
    children: messages.addGroupChildren,
    siblings: messages.addGroupSiblings,
    more: messages.heirMoreRelatives,
  };
  const [before, after] = around(messages.addRelative);
  const unavailable = disabled || atLimit;
  const alert = outcomeText(messages, outcome);

  return (
    <div className="flex flex-col gap-3">
      <h3 id="add-relatives-heading" tabIndex={-1} className="text-lg font-semibold outline-none">
        {messages.addRelativesHeading}
      </h3>
      {atLimit && <p>{messages.fieldErrors.heirs.limit}</p>}
      {alert !== null && <p role="alert">{alert}</p>}
      {groups.map((group) => (
        <div key={group.key} role="group" aria-labelledby={`add-group-${group.key}`} className="flex flex-col gap-2">
          <h4 id={`add-group-${group.key}`} className="font-medium">
            {headings[group.key]}
          </h4>
          <div className="flex flex-wrap gap-2">
            {group.entries.map((entry) => (
              <div key={entry.id} className="flex min-h-11 items-center rounded-node border border-graphic bg-[var(--background)]">
                <button
                  type="button"
                  className={`min-h-11 rounded-lg bg-accent px-3 py-2 text-base font-medium text-accent-foreground aria-disabled:opacity-60 ${focusRingOnAccent}`}
                  aria-disabled={unavailable}
                  data-focus={`add:${entry.id}`}
                  onClick={() => {
                    if (!unavailable) onAdd(entry.id);
                  }}
                >
                  {before !== "" && <span className="sr-only">{before}</span>}
                  <span>{labelOf.get(entry.id) ?? entry.id}</span>
                  {after !== "" && <span className="sr-only">{after}</span>}
                  <span aria-hidden="true"> +</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

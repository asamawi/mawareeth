"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { RelationshipId } from "@/api/case";
import type { Messages } from "@/i18n/messages";
import { heirOptionLabels, type Errors } from "@/interview/answers";
import type { Announcement, Notice } from "@/interview/flow";
import type { AddGroup, AddGroupKey } from "@/interview/relatives";

import { focusRing, focusRingOnAccent } from "../ui";
import { errorText } from "./form-bits";

type Props = {
  messages: Messages["interview"];
  groups: AddGroup[];
  /** The active layer has the most heirs a case may hold: every add is unavailable. */
  atLimit: boolean;
  remaining: number;
  completed?: Announcement | null;
  /** A save is in flight or the browser is offline: a press does nothing. */
  disabled: boolean;
  /** What the last press left behind: a refusal, a conflict or a failure. */
  outcome?: Outcome;
  onAdd: (relationship: RelationshipId, count: number) => void;
  /** A press that moves more than 6px drags the relationship; drops go to `onDrop`. */
  onDragStart?: (relationship: RelationshipId) => void;
  onDragEnd?: () => void;
  onDrop?: (relationship: RelationshipId, target: { anchor: string; link?: string }) => void;
};

/** What a press left behind: a refusal, a conflict or a failure. */
type Outcome = { errors?: Errors; notice?: Notice | "conflict" };

const DRAG_DISTANCE = 6;

/** Splits "Add {relationship}" around the placeholder, so the label can sit between its two halves. */
function around(template: string): [string, string] {
  const at = template.indexOf("{relationship}");
  return at < 0 ? [template, ""] : [template.slice(0, at), template.slice(at + "{relationship}".length)];
}

/** The text of an outcome: refusal codes, a conflict, or a failed or throttled write. */
export function outcomeText(messages: Messages["interview"], outcome: Outcome | undefined): string | null {
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

const stepperButton = `size-11 shrink-0 rounded-lg border border-graphic bg-surface aria-disabled:opacity-60 ${focusRing}`;

export function AddRelatives({ messages, groups, remaining, atLimit, disabled, completed, outcome, onAdd, onDragStart, onDragEnd, onDrop }: Props) {
  const [counts, setCounts] = useState<Partial<Record<RelationshipId, number>>>({});
  const [lastCompletedSeq, setLastCompletedSeq] = useState(completed?.seq);
  if (completed?.seq !== lastCompletedSeq) {
    setLastCompletedSeq(completed?.seq);
    if (completed) setCounts({ ...counts, [completed.heir.relationship]: 1 });
  }
  const maximum = Math.max(1, remaining);
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
  // The click that follows a drag must not also add through the panel.
  const dragged = useRef(false);
  // Removes the window listeners of a drag still in flight; called on unmount and before a new drag.
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []);
  const press = (event: ReactPointerEvent<HTMLButtonElement>, id: RelationshipId) => {
    dragged.current = false;
    if (event.button !== 0 || unavailable) return;
    stopDrag.current?.();
    const { pointerId, clientX, clientY } = event;
    // Pressing a button moves focus to it; a drag leaves focus where it was.
    const before = document.activeElement;
    let active = false;
    const detach = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      if (stopDrag.current === detach) stopDrag.current = null;
    };
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId || active) return;
      if (Math.hypot(next.clientX - clientX, next.clientY - clientY) <= DRAG_DISTANCE) return;
      active = true;
      dragged.current = true;
      onDragStart?.(id);
    };
    const finish = (next: PointerEvent, cancelled: boolean) => {
      if (next.pointerId !== pointerId) return;
      detach();
      if (!active) return;
      onDragEnd?.();
      if (before instanceof HTMLElement && before !== document.body && before.isConnected) before.focus();
      if (cancelled) return;
      const over = document.elementFromPoint(next.clientX, next.clientY)?.closest<HTMLElement>("[data-drop-anchor]");
      if (over?.dataset.dropAnchor) onDrop?.(id, { anchor: over.dataset.dropAnchor, link: over.dataset.dropLink });
    };
    const up = (next: PointerEvent) => finish(next, false);
    const cancel = (next: PointerEvent) => finish(next, true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    stopDrag.current = detach;
  };

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
            {group.entries.map((entry) => {
              const term = messages.relationships[entry.id];
              const countId = `add-count-${entry.id}`;
              const count = Math.min(counts[entry.id] ?? 1, maximum);
              const fewerDisabled = unavailable || count <= 1;
              const moreDisabled = unavailable || count >= maximum;
              const setCount = (value: number) => setCounts(current => ({ ...current, [entry.id]: value }));
              return (
                <div key={entry.id} className="flex min-h-11 max-w-full flex-wrap items-center gap-1 rounded-node border border-graphic bg-[var(--background)]">
                  <button
                    type="button"
                    className={`min-h-11 touch-none select-none rounded-lg bg-accent px-3 py-2 text-base font-medium text-accent-foreground aria-disabled:opacity-60 ${focusRingOnAccent}`}
                    aria-disabled={unavailable}
                    onPointerDown={(event) => press(event, entry.id)}
                    onDragStart={(event) => event.preventDefault()}
                    aria-describedby={`${countId} ${countId}-value`}
                    data-focus={`add:${entry.id}`}
                    onClick={() => {
                      if (dragged.current) {
                        dragged.current = false;
                        return;
                      }
                      if (!unavailable) onAdd(entry.id, count);
                    }}
                  >
                    {before !== "" && <span className="sr-only">{before}</span>}
                    <span>{labelOf.get(entry.id) ?? entry.id}</span>
                    {after !== "" && <span className="sr-only">{after}</span>}
                    <span aria-hidden="true"> +</span>
                  </button>
                  <div className="flex items-center gap-1">
                    <button type="button" className={stepperButton} aria-disabled={fewerDisabled}
                      aria-label={messages.stepperFewer.replace("{relationship}", term)}
                      onClick={() => { if (!fewerDisabled) setCount(count - 1); }}>
                      <span aria-hidden="true">−</span>
                    </button>
                    <output id={countId} aria-live="off" className="font-bold" aria-label={messages.stepperCount.replace("{relationship}", term)}>
                      <span id={`${countId}-value`}>{count}</span>
                    </output>
                    <button type="button" className={stepperButton} aria-disabled={moreDisabled}
                      aria-label={messages.stepperMore.replace("{relationship}", term)}
                      onClick={() => { if (!moreDisabled) setCount(count + 1); }}>
                      <span aria-hidden="true">+</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

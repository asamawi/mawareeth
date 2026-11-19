"use client";

import { useEffect, useRef, useState } from "react";

import type { Deceased, Heir } from "@/api/case";
import type { Messages } from "@/i18n/messages";
import { formatEstate } from "@/interview/answers";
import type { treeDescription } from "@/interview/tree";
import { personOf } from "@/interview/layers";

import { buttonClass, WithHeir } from "./form-bits";
import { UndoButton } from "./undo-toast";

/** The saved deceased, with the amount for the language and a button to correct it. */
export function DeceasedSummary({
  messages,
  locale,
  deceased,
  disabled,
  onEdit,
}: {
  messages: Messages["interview"];
  locale: string;
  deceased: Deceased;
  disabled: boolean;
  onEdit: () => void;
}) {
  return (
    <section aria-labelledby="deceased-summary" className="flex flex-col gap-2">
      <h3 id="deceased-summary" className="text-lg font-semibold">
        {messages.deceasedSummary}
      </h3>
      <p>{deceased.gender === "male" ? messages.genderMale : messages.genderFemale}</p>
      <p>
        {messages.estateSummary}:{" "}
        {deceased.estate === null ? (
          messages.estateNone
        ) : (
          <bdi>{formatEstate(deceased.estate, locale)}</bdi>
        )}
      </p>
      <div>
        <button
          type="button"
          className={buttonClass}
          data-focus="editDeceased"
          aria-disabled={disabled}
          onClick={() => {
            if (!disabled) onEdit();
          }}
        >
          {messages.deceasedEdit}
        </button>
      </div>
    </section>
  );
}

type ListProps = {
  description: ReturnType<typeof treeDescription>;
  zoomNote?: string | null;
  messages: Messages["interview"];
  heirs: Heir[];
  /** The heir whose details are in the form, if any. */
  editingId: string | null;
  saving: boolean;
  /** The sentence for the live region, replaced each time an heir is added, updated or removed. */
  announcement: { template: string; heir: string; seq: number } | null;
  /** The heading text; a later layer names its deceased. */
  heading?: string;
  /** The people (by earliest row id) who have a death of their own; empty in a case without deaths. */
  deceasedIds?: ReadonlySet<string>;
  /** The server's message for a refused death, shown above the list. */
  deathError?: string | null;
  /** The order question, shown under the row whose "Also died" it belongs to. */
  asking?: { rowId: string; node: React.ReactNode } | null;
  onEdit: (heirId: string) => void;
  onRemove: (heirId: string) => void;
  onAlsoDied?: (rowId: string) => void;
  onOpenLayer?: (personId: string) => void;
  /** `personId` is the death to take back, `rowId` the row the button was on. */
  onDidNotDie?: (personId: string, rowId: string) => void;
  /** The persistent Undo control, present while there is something to undo. */
  undo?: { disabled: boolean; onUndo: () => void };
};

/** What a row's inline question is about: removing the row, or taking back the person's death. */
type Confirm = { id: string };

/** The heirs of the active layer. Removal asks on the row, and every change is announced. */
export function HeirList({
  description,
  zoomNote,
  messages,
  heirs,
  editingId,
  saving,
  announcement,
  heading,
  deceasedIds,
  deathError = null,
  asking = null,
  onEdit,
  onRemove,
  onAlsoDied,
  onOpenLayer,
  onDidNotDie,
  undo,
}: ListProps) {
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const container = useRef<HTMLElement>(null);
  const askedFor = useRef<Confirm | null>(null);

  // Opening the question puts focus on the safe answer; cancelling returns it to the button.
  useEffect(() => {
    if (confirm !== null) {
      askedFor.current = confirm;
      container.current?.querySelector<HTMLElement>("[data-keep]")?.focus();
    } else if (askedFor.current !== null) {
      const { id } = askedFor.current;
      container.current?.querySelector<HTMLElement>(`[data-focus="didNotDie:${id}"]`)?.focus();
      askedFor.current = null;
    }
  }, [confirm]);

  return (
    <section ref={container} aria-labelledby="heirs-heading" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="heirs-heading" className="text-lg font-semibold">
          {heading ?? messages.heirsHeading} ({heirs.length})
        </h3>
        {undo && <UndoButton messages={messages} disabled={undo.disabled} onUndo={undo.onUndo} />}
      </div>
      {/* Present before its text changes, so screen readers announce the change. */}
      <p role="status" aria-live="polite" className="sr-only">
        {zoomNote ?? (announcement && (
          <span key={announcement.seq}>
            <WithHeir template={announcement.template} heir={announcement.heir} />
          </span>
        ))}
      </p>
      {deathError !== null && <p role="alert">{deathError}</p>}
      <div data-focus="list" tabIndex={-1} className="outline-none">
        {heirs.length === 0 && <p>{messages.heirsEmpty}</p>}
        <ul aria-label={messages.heirsListLabel} className="flex flex-col gap-2">
          <li className="flex min-h-[52px] items-center border-t border-line p-3"><strong><bdi>{description.deceased}</bdi></strong></li>
          {description.people.map(words => {
              const heir = heirs.find(h => h.id === words.id);
              const id = words.id;
              const label = words.label;
              const person = heir ? personOf(heir) : id;
              const dead = deceasedIds?.has(person) ?? false;
              const confirming = confirm?.id === id;
              return (
                <li
                  key={id}
                  aria-current={editingId === id ? "true" : undefined}
                  className="flex min-h-[52px] flex-wrap items-center justify-between gap-3 rounded-md border border-current/60 p-3 aria-[current=true]:border-2 aria-[current=true]:border-current"
                >
                  <span className="flex min-w-0 flex-col [overflow-wrap:anywhere]">
                    <strong>{words.relationship}</strong>
                    {words.secondary && <span className="text-sm"><bdi>{words.secondary}</bdi></span>}
                    {words.badge && <span className="text-badge">{words.badge}</span>}
                  </span>
                  {confirming ? (
                    <div
                      role="group"
                      aria-labelledby={`confirm-question-${id}`}
                      className="flex flex-wrap items-center gap-3"
                    >
                      <span id={`confirm-question-${id}`}>
                        <WithHeir
                          template={messages.heirDidNotDieConfirm}
                          heir={label}
                        />
                      </span>
                      <button
                        type="button"
                        className={buttonClass}
                        aria-disabled={saving}
                        onClick={() => {
                          if (saving) return;
                          setConfirm(null);
                          askedFor.current = null;
                          onDidNotDie?.(person, id);
                        }}
                      >
                        {messages.heirDidNotDieYes}
                      </button>
                      <button type="button" data-keep className={buttonClass} aria-disabled={saving} onClick={() => { if (!saving) setConfirm(null); }}>
                        {messages.heirRemoveNo}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        className={buttonClass}
                        data-focus={`editHeir:${id}`}
                        aria-disabled={saving}
                        onClick={() => {
                          if (!saving) onEdit(id);
                        }}
                      >
                        <WithHeir template={messages.heirEdit} heir={label} />
                      </button>
                      {onAlsoDied && heir && !dead && (
                        <button
                          type="button"
                          className={buttonClass}
                          data-focus={`alsoDied:${id}`}
                          aria-disabled={saving}
                          onClick={() => {
                            if (!saving) onAlsoDied(id);
                          }}
                        >
                          <WithHeir template={messages.heirAlsoDied} heir={label} />
                        </button>
                      )}
                      {onOpenLayer && dead && (
                        <button
                          type="button"
                          className={buttonClass}
                          data-focus={`openLayer:${id}`}
                          aria-disabled={saving}
                          onClick={() => {
                            if (!saving) onOpenLayer(person);
                          }}
                        >
                          <WithHeir template={messages.heirOpenLayer} heir={label} />
                        </button>
                      )}
                      {onDidNotDie && dead && (
                        <button
                          type="button"
                          className={buttonClass}
                          data-focus={`didNotDie:${id}`}
                          aria-disabled={saving}
                          onClick={() => {
                            if (!saving) setConfirm({ id });
                          }}
                        >
                          <WithHeir template={messages.heirDidNotDie} heir={label} />
                        </button>
                      )}
                      <button
                        type="button"
                        className={buttonClass}
                        data-focus={`remove:${id}`}
                        aria-disabled={saving}
                        onClick={() => {
                          if (!saving) onRemove(id);
                        }}
                      >
                        <WithHeir template={messages.heirRemove} heir={label} />
                      </button>
                    </div>
                  )}
                  {asking?.rowId === id && asking.node}
                </li>
              );
            })}
          </ul>
      </div>
    </section>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

import type { Deceased, Heir } from "@/api/case";
import type { Messages } from "@/i18n/messages";
import { formatEstate, heirLabels } from "@/interview/answers";

import { buttonClass, WithHeir } from "./form-bits";

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
  messages: Messages["interview"];
  heirs: Heir[];
  /** The heir whose details are in the form, if any. */
  editingId: string | null;
  saving: boolean;
  /** The sentence for the live region, replaced each time an heir is added, updated or removed. */
  announcement: { template: string; heir: string; seq: number } | null;
  onEdit: (heirId: string) => void;
  onRemove: (heirId: string) => void;
};

/** The heirs added so far. Removal asks on the row, and every change is announced. */
export function HeirList({ messages, heirs, editingId, saving, announcement, onEdit, onRemove }: ListProps) {
  const [removing, setRemoving] = useState<string | null>(null);
  const container = useRef<HTMLElement>(null);
  const askedFor = useRef<string | null>(null);
  const labels = heirLabels(heirs, messages.relationships, messages.heirNumbered);

  // Opening the question puts focus on the safe answer; cancelling returns it to the button.
  useEffect(() => {
    if (removing !== null) {
      askedFor.current = removing;
      container.current?.querySelector<HTMLElement>("[data-keep]")?.focus();
    } else if (askedFor.current !== null) {
      container.current?.querySelector<HTMLElement>(`[data-focus="remove:${askedFor.current}"]`)?.focus();
      askedFor.current = null;
    }
  }, [removing]);

  return (
    <section ref={container} aria-labelledby="heirs-heading" className="flex flex-col gap-3">
      <h3 id="heirs-heading" className="text-lg font-semibold">
        {messages.heirsHeading} ({heirs.length})
      </h3>
      {/* Present before its text changes, so screen readers announce the change. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement && (
          <span key={announcement.seq}>
            <WithHeir template={announcement.template} heir={announcement.heir} />
          </span>
        )}
      </p>
      <div data-focus="list" tabIndex={-1} className="outline-none">
        {heirs.length === 0 ? (
          <p>{messages.heirsEmpty}</p>
        ) : (
          <ul aria-label={messages.heirsListLabel} className="flex flex-col gap-2">
            {heirs.map((heir) => {
              const label = labels[heir.id];
              return (
                <li
                  key={heir.id}
                  aria-current={editingId === heir.id ? "true" : undefined}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-current/60 p-3 aria-[current=true]:border-2 aria-[current=true]:border-current"
                >
                  <span className="flex flex-col">
                    <strong>
                      <bdi>{label}</bdi>
                    </strong>
                    {heir.name !== null && (
                      <span className="text-sm">{messages.relationships[heir.relationship]}</span>
                    )}
                  </span>
                  {removing === heir.id ? (
                    <div
                      role="group"
                      aria-labelledby={`remove-question-${heir.id}`}
                      className="flex flex-wrap items-center gap-3"
                    >
                      <span id={`remove-question-${heir.id}`}>
                        <WithHeir template={messages.heirRemoveConfirm} heir={label} />
                      </span>
                      <button
                        type="button"
                        className={buttonClass}
                        aria-disabled={saving}
                        onClick={() => {
                          if (saving) return;
                          setRemoving(null);
                          askedFor.current = null;
                          onRemove(heir.id);
                        }}
                      >
                        {messages.heirRemoveYes}
                      </button>
                      <button type="button" data-keep className={buttonClass} onClick={() => setRemoving(null)}>
                        {messages.heirRemoveNo}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        className={buttonClass}
                        data-focus={`editHeir:${heir.id}`}
                        aria-disabled={saving}
                        onClick={() => {
                          if (!saving) onEdit(heir.id);
                        }}
                      >
                        <WithHeir template={messages.heirEdit} heir={label} />
                      </button>
                      <button
                        type="button"
                        className={buttonClass}
                        data-focus={`remove:${heir.id}`}
                        aria-disabled={saving}
                        onClick={() => {
                          if (!saving) setRemoving(heir.id);
                        }}
                      >
                        <WithHeir template={messages.heirRemove} heir={label} />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

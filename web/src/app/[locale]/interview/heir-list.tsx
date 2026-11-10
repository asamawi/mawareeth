"use client";

import { useEffect, useRef, useState } from "react";

import type { Case, Deceased, Heir } from "@/api/case";
import type { Messages } from "@/i18n/messages";
import { formatEstate, heirLabels } from "@/interview/answers";
import { personOf, removesDeath } from "@/interview/layers";

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
  kase: Case;
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
};

/** What a row's inline question is about: removing the row, or taking back the person's death. */
type Confirm = { kind: "remove" | "unmark"; id: string };

/** The heirs of the active layer. Removal asks on the row, and every change is announced. */
export function HeirList({
  messages,
  heirs,
  kase,
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
}: ListProps) {
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const container = useRef<HTMLElement>(null);
  const askedFor = useRef<Confirm | null>(null);
  const labels = heirLabels(heirs, messages.relationships, messages.heirNumbered);

  // Opening the question puts focus on the safe answer; cancelling returns it to the button.
  useEffect(() => {
    if (confirm !== null) {
      askedFor.current = confirm;
      container.current?.querySelector<HTMLElement>("[data-keep]")?.focus();
    } else if (askedFor.current !== null) {
      const { kind, id } = askedFor.current;
      const prefix = kind === "remove" ? "remove" : "didNotDie";
      container.current?.querySelector<HTMLElement>(`[data-focus="${prefix}:${id}"]`)?.focus();
      askedFor.current = null;
    }
  }, [confirm]);

  return (
    <section ref={container} aria-labelledby="heirs-heading" className="flex flex-col gap-3">
      <h3 id="heirs-heading" className="text-lg font-semibold">
        {heading ?? messages.heirsHeading} ({heirs.length})
      </h3>
      {/* Present before its text changes, so screen readers announce the change. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement && (
          <span key={announcement.seq}>
            <WithHeir template={announcement.template} heir={announcement.heir} />
          </span>
        )}
      </p>
      {deathError !== null && <p role="alert">{deathError}</p>}
      <div data-focus="list" tabIndex={-1} className="outline-none">
        {heirs.length === 0 ? (
          <p>{messages.heirsEmpty}</p>
        ) : (
          <ul aria-label={messages.heirsListLabel} className="flex flex-col gap-2">
            {heirs.map((heir) => {
              const label = labels[heir.id];
              const person = personOf(heir);
              const dead = deceasedIds?.has(person) ?? false;
              const confirming = confirm?.id === heir.id ? confirm.kind : null;
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
                  {confirming !== null ? (
                    <div
                      role="group"
                      aria-labelledby={`confirm-question-${heir.id}`}
                      className="flex flex-wrap items-center gap-3"
                    >
                      <span id={`confirm-question-${heir.id}`}>
                        <WithHeir
                          template={
                            confirming === "unmark"
                              ? messages.heirDidNotDieConfirm
                              : removesDeath(kase, heir.id)
                                ? messages.heirRemoveConfirmDeceased
                                : messages.heirRemoveConfirm
                          }
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
                          if (confirming === "unmark") onDidNotDie?.(person, heir.id);
                          else onRemove(heir.id);
                        }}
                      >
                        {confirming === "unmark" ? messages.heirDidNotDieYes : messages.heirRemoveYes}
                      </button>
                      <button type="button" data-keep className={buttonClass} onClick={() => setConfirm(null)}>
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
                      {onAlsoDied && !dead && (
                        <button
                          type="button"
                          className={buttonClass}
                          data-focus={`alsoDied:${heir.id}`}
                          aria-disabled={saving}
                          onClick={() => {
                            if (!saving) onAlsoDied(heir.id);
                          }}
                        >
                          <WithHeir template={messages.heirAlsoDied} heir={label} />
                        </button>
                      )}
                      {onOpenLayer && dead && (
                        <button
                          type="button"
                          className={buttonClass}
                          data-focus={`openLayer:${heir.id}`}
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
                          data-focus={`didNotDie:${heir.id}`}
                          aria-disabled={saving}
                          onClick={() => {
                            if (!saving) setConfirm({ kind: "unmark", id: heir.id });
                          }}
                        >
                          <WithHeir template={messages.heirDidNotDie} heir={label} />
                        </button>
                      )}
                      <button
                        type="button"
                        className={buttonClass}
                        data-focus={`remove:${heir.id}`}
                        aria-disabled={saving}
                        onClick={() => {
                          if (!saving) setConfirm({ kind: "remove", id: heir.id });
                        }}
                      >
                        <WithHeir template={messages.heirRemove} heir={label} />
                      </button>
                    </div>
                  )}
                  {asking?.rowId === heir.id && asking.node}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

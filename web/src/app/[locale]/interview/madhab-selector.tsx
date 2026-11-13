"use client";

import { useState, type FormEvent } from "react";

import type { Messages } from "@/i18n/messages";
import type { Notice } from "@/interview/flow";
import {
  MADHAB_IDS,
  selectedMadhab,
  showDefaultNotice,
  type MadhabId,
} from "@/interview/madhabs";

const buttonClass =
  "rounded-md border border-current px-4 py-2 text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current aria-disabled:opacity-60";

const NOTICE_ID = "madhab-default-notice";

type Props = {
  messages: Messages["interview"];
  /** The school stored on the case, if any. */
  stored: MadhabId | null;
  /** A pick the visitor made earlier and has not saved. */
  initialPick: MadhabId | null;
  saving: boolean;
  notice: Notice | null;
  onPick: (madhab: MadhabId) => void;
  onSubmit: (madhab: MadhabId) => void;
  onCancel: () => void;
};

/**
 * Native radios in a group, so arrow keys work for free. A selected card has a heavier
 * outline and the radio dot, so color is never the only signal, and nothing shifts layout.
 */
export function MadhabSelector({
  messages,
  stored,
  initialPick,
  saving,
  notice,
  onPick,
  onSubmit,
  onCancel,
}: Props) {
  const [picked, setPicked] = useState<MadhabId | null>(initialPick);
  const selected = selectedMadhab(stored, picked);
  const defaultNotice = showDefaultNotice(stored, picked);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!saving) onSubmit(selected);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <fieldset
        role="radiogroup"
        aria-describedby={defaultNotice ? NOTICE_ID : undefined}
        className="flex flex-col gap-3"
      >
        <legend className="mb-2 max-w-xl text-lg font-semibold">{messages.madhabLegend}</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {MADHAB_IDS.map((id) => (
            <label
              key={id}
              className="flex cursor-pointer items-start gap-3 rounded-lg border-2 border-current/60 p-3 has-checked:border-current has-checked:bg-current/10 has-checked:shadow-[inset_0_0_0_1px_currentColor] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-current"
            >
              <input
                type="radio"
                name="madhab"
                value={id}
                checked={selected === id}
                onChange={() => {
                  // Not disabled while saving: that would drop focus. The pick is ignored.
                  if (saving) return;
                  setPicked(id);
                  onPick(id);
                }}
                className="mt-1 size-5 shrink-0 accent-current"
              />
              <span className="flex flex-col gap-1">
                <span className="font-semibold">{messages.madhabs[id].name}</span>
                <span className="text-sm">{messages.madhabs[id].description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {defaultNotice && (
        <p id={NOTICE_ID} className="max-w-xl">
          {messages.madhabDefaultNotice}
        </p>
      )}
      {saving && (
        <p role="status" className="max-w-xl">
          {messages.madhabSaving}
        </p>
      )}
      {notice && (
        <p role="alert" className="max-w-xl">
          {notice === "throttled" ? messages.throttled : messages.failed}
        </p>
      )}

      <div className="flex max-w-xl flex-wrap gap-3">
        <button type="submit" className={buttonClass} aria-disabled={saving}>
          {messages.madhabContinue}
        </button>
        {stored !== null && (
          <button
            type="button"
            className={buttonClass}
            aria-disabled={saving}
            onClick={() => {
              if (!saving) onCancel();
            }}
          >
            {messages.madhabCancel}
          </button>
        )}
      </div>
    </form>
  );
}

"use client";

import type { Messages } from "@/i18n/messages";

import { buttonClass } from "./form-bits";

/**
 * "Who died first?" for two later deaths that nothing orders. The answer is resent to the server,
 * which refuses "at the same time" and "not known" with its own message; the question then stays
 * open and takes focus. The client decides nothing about the order.
 */
export function OrderQuestion({
  messages,
  choices,
  saving,
  error,
  onChoose,
  onCancel,
}: {
  messages: Messages["interview"];
  /** The two later deceased, by their ids, with their labels. */
  choices: { id: string; label: string }[];
  saving: boolean;
  error: string | null;
  /** A person's id, `simultaneous` or `unknown`. */
  onChoose: (first: string) => void;
  onCancel: () => void;
}) {
  const choose = (first: string) => {
    if (!saving) onChoose(first);
  };
  return (
    <div
      role="group"
      aria-labelledby="death-order-question"
      tabIndex={-1}
      data-focus="death-order"
      className="flex w-full flex-col gap-2 outline-none"
    >
      <p id="death-order-question" className="font-medium">
        {messages.deathOrderQuestion}
      </p>
      {error !== null && <p role="alert">{error}</p>}
      <div className="flex flex-wrap gap-3">
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            className={buttonClass}
            data-focus={`orderFirst:${choice.id}`}
            aria-disabled={saving}
            onClick={() => choose(choice.id)}
          >
            <bdi>{choice.label}</bdi>
          </button>
        ))}
        <button type="button" className={buttonClass} data-focus="orderSimultaneous" aria-disabled={saving} onClick={() => choose("simultaneous")}>
          {messages.deathOrderSimultaneous}
        </button>
        <button type="button" className={buttonClass} data-focus="orderUnknown" aria-disabled={saving} onClick={() => choose("unknown")}>
          {messages.deathOrderUnknown}
        </button>
        <button type="button" className={buttonClass} data-focus="orderCancel" aria-disabled={saving} onClick={() => !saving && onCancel()}>
          {messages.deathOrderCancel}
        </button>
      </div>
    </div>
  );
}

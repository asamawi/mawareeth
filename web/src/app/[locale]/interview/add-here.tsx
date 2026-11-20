"use client";

import { useEffect, useId, useRef, useState } from "react";

import type { PlacementLink, PlacementOption } from "@/api/case";
import type { Messages } from "@/i18n/messages";

import { focusRing, focusRingOnAccent } from "../ui";

type Props = {
  messages: Messages["interview"];
  /** A person id or "root", in the active estate. Only the label of it is shown here. */
  anchor: string;
  /** The card's label, for the group name. */
  personLabel: string;
  /** The engine's placement entries for the anchor, in server order. */
  entries: readonly PlacementOption[];
  /** Offers only entries with this link (a placeholder). */
  link?: PlacementLink;
  /** A save is in flight or the browser is offline. */
  frozen: boolean;
  /** The active estate holds the most heirs a case may hold. */
  atLimit: boolean;
  /** A refusal, conflict or failure of the last positioned add here. */
  alert?: string | null;
  defaultOpen?: boolean;
  onChoose: (entry: PlacementOption) => void;
};

/** The one "Add relative here" chooser used by the card action row, the edit sheet and the placeholders. */
export function AddHere({ messages, anchor, personLabel, entries, link, frozen, atLimit, alert, defaultOpen = false, onChoose }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const toggle = useRef<HTMLButtonElement>(null);
  const group = useId();
  const unavailable = frozen || atLimit;
  // Opened from a placeholder: the visitor pressed something, so focus follows into the chooser.
  useEffect(() => {
    if (defaultOpen) toggle.current?.focus();
  }, [defaultOpen]);
  const offered = link ? entries.filter((entry) => entry.link === link) : entries;
  const label = (entry: PlacementOption) => {
    const term = messages.relationships[entry.relationship];
    return messages.addRelative.replace("{relationship}", entry.blocked ? messages.heirRelationshipBlocked.replace("{relationship}", term) : term);
  };
  return (
    <div
      data-add-here={anchor}
      className="flex min-w-0 flex-col gap-2"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          toggle.current?.focus();
        }
      }}
    >
      <button
        ref={toggle}
        type="button"
        data-focus="addHere"
        aria-expanded={open}
        aria-controls={group}
        aria-disabled={unavailable}
        className={`min-h-11 self-start rounded-lg bg-accent px-4 py-2 text-base font-medium text-accent-foreground aria-disabled:opacity-60 ${focusRingOnAccent}`}
        onClick={() => {
          if (!unavailable) setOpen(!open);
        }}
      >
        {messages.addRelativeHere}
      </button>
      {atLimit && <p>{messages.fieldErrors.heirs.limit}</p>}
      <div id={group} role="group" aria-label={messages.addHereGroup.replace("{person}", personLabel)} hidden={!open} className="flex flex-wrap gap-2">
        {offered.length === 0 && <p>{messages.addHereNone}</p>}
        {offered.map((entry) => (
          <button
            key={`${entry.link}:${entry.relationship}`}
            type="button"
            data-focus={`addHere:${entry.relationship}`}
            aria-disabled={unavailable}
            className={`min-h-11 rounded-lg border-2 border-accent bg-[var(--background)] px-3 py-2 text-base aria-disabled:opacity-60 ${focusRing}`}
            onClick={() => {
              if (!unavailable) onChoose(entry);
            }}
          >
            {label(entry)}
          </button>
        ))}
      </div>
      {alert && <p role="alert">{alert}</p>}
    </div>
  );
}

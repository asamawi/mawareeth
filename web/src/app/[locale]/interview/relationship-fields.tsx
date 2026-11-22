"use client";

import { useEffect, useRef, useState } from "react";

import type { Gender, HeirOptions, RelationshipId } from "@/api/case";
import type { Messages } from "@/i18n/messages";
import { heirOptionLabels } from "@/interview/answers";

import { buttonClass, FieldError, inputClass } from "./form-bits";

export function RelationshipFields({ messages, options, deceasedGender, labelBlocked, value, frozen,
  relationshipError, onChange, onBlur, immediate = false, errorAnnounce }: {
  messages: Messages["interview"]; options: HeirOptions; deceasedGender: Gender;
  labelBlocked: boolean; value: string; frozen: boolean; relationshipError: string | null;
  onChange: (value: string, control: string) => void; onBlur?: () => void; immediate?: boolean; errorAnnounce?: number;
}) {
  // Every relative stays offered: a blocked one can still change the others' shares.
  const offered = heirOptionLabels(options, labelBlocked, messages.relationships, messages.heirRelationshipBlocked);

  const spouse: RelationshipId = deceasedGender === "male" ? "wife" : "husband";
  const commonIds: RelationshipId[] = [spouse, "son", "daughter", "father", "mother"];
  const common = commonIds.map((id) => offered.find((option) => option.id === id)!);
  const rare = offered.filter((option) => !commonIds.includes(option.id));
  const rareValue = rare.some((option) => option.id === value) ? value : "";
  // Starts open for a relationship outside the common group; revealing is one-way.
  const [showMore, setShowMore] = useState(() => value !== "" && !commonIds.includes(value as RelationshipId));
  const moreSelect = useRef<HTMLSelectElement>(null);
  const focusMore = useRef(false);
  useEffect(() => {
    if (showMore && focusMore.current) {
      focusMore.current = false;
      moreSelect.current?.focus();
    }
  }, [showMore]);
  // The control that answers a focus request: the checked radio, else the select, else the first radio.
  const checkedRadio = common.findIndex((option) => option.id === value);
  const focusRadio = checkedRadio >= 0 ? checkedRadio : showMore && rareValue !== "" ? -1 : 0;

  return (
      <fieldset
        className="flex min-w-0 flex-col gap-2"
        aria-describedby="heir-relationship-error"
        onBlur={(event) => {
          // Moving between the radios, the button and the select is still inside the picker.
          if (event.relatedTarget && event.currentTarget.contains(event.relatedTarget as Element)) return;
          onBlur?.();
        }}
      >
        <legend id="heir-relationship-legend" className="font-medium">{messages.heirRelationshipLabel}</legend>
        <div
          role="radiogroup"
          aria-labelledby="heir-relationship-legend"
          aria-required="true"
          aria-invalid={relationshipError !== null}
          aria-describedby="heir-relationship-error"
          className="grid grid-cols-2 gap-2 sm:grid-cols-3"
        >
          {common.map((option, index) => (
            <label
              key={option.id}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border-2 border-current/60 px-3 py-2 has-[:checked]:border-current has-[:checked]:font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-current"
            >
              <input
                type="radio"
                name="relationship"
                value={option.id}
                checked={value === option.id}
                data-focus={immediate ? `editRelationship:${option.id}` : focusRadio === index ? "relationship" : undefined}
                aria-disabled={frozen}
                onChange={() => { if (!frozen) onChange(option.id, option.id); }}
              />
              {option.label}
            </label>
          ))}
        </div>
        {!showMore && (
          <button
            type="button"
            className={`${buttonClass} min-h-11 self-start`}
            aria-disabled={frozen}
            aria-expanded={false}
            aria-controls="heir-relationship-more"
            onClick={() => {
              if (frozen) return;
              focusMore.current = true;
              setShowMore(true);
            }}
          >
            {messages.heirMoreRelatives}
          </button>
        )}
        {showMore && (
          <div id="heir-relationship-more" className="flex flex-col gap-1">
            <label htmlFor="heir-relationship-rare" className="font-medium">
              {messages.heirMoreRelativesLabel}
            </label>
            <select
              id="heir-relationship-rare"
              ref={moreSelect}
              value={rareValue}
              data-focus={immediate ? "editRelationship:more" : focusRadio === -1 ? "relationship" : undefined}
              aria-invalid={relationshipError !== null}
              aria-describedby="heir-relationship-error"
              aria-disabled={frozen}
              onChange={(event) => { if (!frozen) onChange(event.target.value, "more"); }}
              className={`${inputClass} min-h-11`}
            >
              <option value="">{messages.heirRelationshipPlaceholder}</option>
              {rare.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <FieldError id="heir-relationship-error" text={relationshipError} live={immediate} announce={errorAnnounce} />
      </fieldset>
  );
}

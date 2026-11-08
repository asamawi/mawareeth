"use client";

import { useState, type FormEvent } from "react";

import type { HeirOptions } from "@/api/case";
import type { Messages } from "@/i18n/messages";
import { heirOptionLabels, type Errors, type HeirValues } from "@/interview/answers";
import type { Notice } from "@/interview/flow";

import { buttonClass, errorText, FieldError, FormError, inputClass, SaveNotice } from "./form-bits";

type Props = {
  messages: Messages["interview"];
  /** What the form starts with: blank, the heir being edited, or what the visitor had typed. */
  initial: HeirValues;
  errors: Errors | null;
  notice: Notice | null;
  saving: boolean;
  /** An existing heir is being corrected, so cancelling is possible. */
  editing: boolean;
  /**
   * What the server says about adding a relative to the family. Only the add form labels the
   * relatives who would inherit nothing: the options describe adding to the whole family, and an
   * edit leaves that heir out, so the edit form shows plain labels and relies on the server.
   */
  options: HeirOptions;
  onChange: (values: HeirValues, field: string) => void;
  onBlur: (field: string, values: HeirValues) => void;
  onSubmit: (values: HeirValues) => void;
  onCancel: () => void;
};

/** One form for adding and for editing; the relationship is a native select. */
export function HeirForm({
  messages,
  initial,
  errors,
  notice,
  saving,
  editing,
  options,
  onChange,
  onBlur,
  onSubmit,
  onCancel,
}: Props) {
  const [values, setValues] = useState(initial);
  const relationshipError = errorText(messages, "relationship", errors);
  const nameError = errorText(messages, "name", errors);
  // Every relative stays offered: a blocked one can still change the others' shares.
  const offered = heirOptionLabels(options, !editing, messages.relationships, messages.heirRelationshipBlocked);

  function change(field: keyof HeirValues, value: string) {
    // Read-only while saving: what is typed now would be wiped when the save finishes.
    if (saving) return;
    const next = { ...values, [field]: value };
    setValues(next);
    onChange(next, field);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!saving) onSubmit(values);
  }

  return (
    <form onSubmit={submit} noValidate className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <h3 className="text-lg font-semibold">{editing ? messages.heirEditHeading : messages.heirAddHeading}</h3>

      <div className="flex flex-col gap-1">
        <label htmlFor="heir-relationship" className="font-medium">
          {messages.heirRelationshipLabel}
        </label>
        <select
          id="heir-relationship"
          name="relationship"
          value={values.relationship}
          data-focus="relationship"
          aria-required="true"
          aria-invalid={relationshipError !== null}
          aria-describedby="heir-relationship-error"
          onChange={(event) => change("relationship", event.target.value)}
          onBlur={() => onBlur("relationship", values)}
          className={inputClass}
        >
          <option value="">{messages.heirRelationshipPlaceholder}</option>
          {offered.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <FieldError id="heir-relationship-error" text={relationshipError} />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="heir-name" className="font-medium">
          {messages.heirNameLabel}
        </label>
        <input
          id="heir-name"
          name="name"
          type="text"
          autoComplete="off"
          dir="auto"
          value={values.name}
          readOnly={saving}
          data-focus="name"
          aria-invalid={nameError !== null}
          aria-describedby="heir-name-hint heir-name-error"
          onChange={(event) => change("name", event.target.value)}
          onBlur={() => onBlur("name", values)}
          className={inputClass}
        />
        <p id="heir-name-hint" className="text-sm">
          {messages.heirNameHint}
        </p>
        <FieldError id="heir-name-error" text={nameError} />
      </div>

      <FormError messages={messages} errors={errors} fields={["relationship", "name"]} />
      <SaveNotice messages={messages} notice={notice} saving={saving} />

      <div className="flex flex-wrap gap-3">
        <button type="submit" className={buttonClass} aria-disabled={saving}>
          {editing ? messages.heirSave : messages.heirAdd}
        </button>
        {editing && (
          <button
            type="button"
            className={buttonClass}
            aria-disabled={saving}
            onClick={() => {
              if (!saving) onCancel();
            }}
          >
            {messages.heirCancel}
          </button>
        )}
      </div>
    </form>
  );
}

"use client";

import { useState, type FormEvent } from "react";

import type { Messages } from "@/i18n/messages";
import type { DeceasedValues, Errors } from "@/interview/answers";
import type { Notice } from "@/interview/flow";

import { buttonClass, errorText, FieldError, FormError, inputClass, SaveNotice } from "./form-bits";

type Props = {
  messages: Messages["interview"];
  /** What the form starts with: the stored deceased, or what the visitor had typed. */
  initial: DeceasedValues;
  errors: Errors | null;
  notice: Notice | null;
  saving: boolean;
  /** An existing deceased is being corrected, so cancelling is possible. */
  editing: boolean;
  onChange: (values: DeceasedValues, field: string) => void;
  onBlur: (field: string, values: DeceasedValues) => void;
  onSubmit: (values: DeceasedValues) => void;
  onCancel: () => void;
};

export function DeceasedForm({
  messages,
  initial,
  errors,
  notice,
  saving,
  editing,
  onChange,
  onBlur,
  onSubmit,
  onCancel,
}: Props) {
  const [values, setValues] = useState(initial);
  const genderError = errorText(messages, "gender", errors);
  const estateError = errorText(messages, "estate", errors);

  function change(field: keyof DeceasedValues, value: string) {
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
      <h3 className="text-lg font-semibold">{messages.deceasedHeading}</h3>

      <fieldset
        role="radiogroup"
        aria-required="true"
        aria-invalid={genderError !== null}
        aria-describedby="deceased-gender-error"
        // Validation on leaving the group, not on moving between its radios.
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) onBlur("gender", values);
        }}
        className="flex flex-col gap-2"
      >
        <legend className="mb-2 font-medium">{messages.genderLegend}</legend>
        <div className="flex flex-wrap gap-3">
          {(["male", "female"] as const).map((gender) => (
            <label
              key={gender}
              className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-current/60 px-4 py-3 has-checked:border-current has-checked:bg-current/10 has-checked:shadow-[inset_0_0_0_1px_currentColor] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-current"
            >
              <input
                type="radio"
                name="gender"
                value={gender}
                checked={values.gender === gender}
                data-focus={gender === "male" ? "gender" : undefined}
                onChange={() => change("gender", gender)}
                className="size-5 shrink-0 accent-current"
              />
              <span>{gender === "male" ? messages.genderMale : messages.genderFemale}</span>
            </label>
          ))}
        </div>
        <FieldError id="deceased-gender-error" text={genderError} />
      </fieldset>

      <div className="flex flex-col gap-1">
        <label htmlFor="deceased-estate" className="font-medium">
          {messages.estateLabel}
        </label>
        <input
          id="deceased-estate"
          name="estate"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          dir="auto"
          value={values.estate}
          readOnly={saving}
          data-focus="estate"
          aria-invalid={estateError !== null}
          aria-describedby="deceased-estate-hint deceased-estate-error"
          onChange={(event) => change("estate", event.target.value)}
          onBlur={() => onBlur("estate", values)}
          className={inputClass}
        />
        <p id="deceased-estate-hint" className="text-sm">
          {messages.estateHint}
        </p>
        <FieldError id="deceased-estate-error" text={estateError} />
      </div>

      <FormError messages={messages} errors={errors} fields={["gender", "estate"]} />
      <SaveNotice messages={messages} notice={notice} saving={saving} />

      <div className="flex flex-wrap gap-3">
        <button type="submit" className={buttonClass} aria-disabled={saving}>
          {messages.deceasedSave}
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
            {messages.deceasedCancel}
          </button>
        )}
      </div>
    </form>
  );
}

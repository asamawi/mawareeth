"use client";

import { useState, type FormEvent } from "react";

import { SUNNI_IDS, type SunniId } from "@/api/case";
import type { Messages } from "@/i18n/messages";
import { localFraction } from "@/interview/format";
import { previewRows } from "@/interview/preview";
import type { ChoosePreview } from "@/interview/results";

import { buttonClass } from "./form-bits";

/**
 * Shown when the visitor has not chosen a school and the four Sunni schools differ for this
 * family: what the difference rests on, each school's own result in brief, and the choice.
 * It never picks for the visitor. Choosing saves the school and everything works as before.
 */
export function SchoolChoice({
  messages,
  locale,
  preview,
  labels,
  disabled,
  failed,
  onChoose,
}: {
  messages: Messages["interview"];
  locale: string;
  preview: ChoosePreview;
  /** A label for every heir id, so no share reads as a raw id. */
  labels: Record<string, string>;
  /** A save is in flight: the button does nothing. */
  disabled: boolean;
  failed: "failed" | "throttled" | null;
  onChoose: (madhab: SunniId) => void;
}) {
  const [picked, setPicked] = useState<SunniId | null>(null);
  const [prompt, setPrompt] = useState(false);
  const reasons = messages.previewReasons as Record<string, string | undefined>;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (disabled) return;
    // Nothing picked: say what is needed instead of doing nothing.
    if (picked === null) setPrompt(true);
    else onChoose(picked);
  }

  return (
    <div data-school-choice className="flex flex-col gap-3">
      <p className="font-semibold">{messages.schoolsDiffer}</p>
      {preview.rules.length > 0 && (
        <div>
          <p>{messages.schoolsDifferBecause}</p>
          <ul className="flex list-disc flex-col gap-1 ps-6">
            {preview.rules.map((rule) => (
              <li key={rule.code}>{rule.label}</li>
            ))}
          </ul>
        </div>
      )}
      <ul className="grid gap-3 sm:grid-cols-2">
        {SUNNI_IDS.map((id) => {
          const body = preview.schools[id];
          return (
            <li key={id} className="flex flex-col gap-2 rounded-md border border-current/60 p-3">
              <strong>{messages.madhabs[id].name}</strong>
              {body.status === "available" ? (
                <ul className="flex flex-col gap-1">
                  {previewRows(body).rows.map((row) => (
                    <li key={row.heirId} className="flex flex-wrap justify-between gap-x-3">
                      <bdi>{labels[row.heirId] ?? row.heirId}</bdi>
                      {row.blocked || row.fraction === null ? (
                        <span>{messages.previewNoShare}</span>
                      ) : (
                        <bdi dir="ltr">{localFraction(row.fraction, locale)}</bdi>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{reasons[body.reason] ?? messages.previewUnavailable}</p>
              )}
            </li>
          );
        })}
      </ul>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <fieldset role="radiogroup" className="flex flex-col gap-2">
          <legend className="mb-1 font-semibold">{messages.chooseSchool}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {SUNNI_IDS.map((id) => (
              <label
                key={id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border-2 border-current/60 p-3 has-checked:border-current has-checked:bg-current/10 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-current"
              >
                <input
                  type="radio"
                  name="school-choice"
                  value={id}
                  checked={picked === id}
                  onChange={() => {
                    setPicked(id);
                    setPrompt(false);
                  }}
                  className="size-5 shrink-0 accent-current"
                />
                <span className="font-semibold">{messages.madhabs[id].name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {prompt && picked === null && <p role="alert">{messages.chooseSchool}</p>}
        {failed && (
          <p role="alert">{failed === "throttled" ? messages.throttled : messages.failed}</p>
        )}
        <div>
          <button type="submit" className={buttonClass} aria-disabled={disabled}>
            {messages.madhabContinue}
          </button>
        </div>
      </form>
    </div>
  );
}

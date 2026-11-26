"use client";

import { useId } from "react";
import { NAME_LIMIT, graphemeCount } from "@/api/saved-cases";
import type { Messages } from "@/i18n/messages";

/** The Case name input with its grapheme counter, invalid state and error text, shared by the naming dialog and inline rename. */
export function CaseNameField({ locale, text, value, error = null, autoFocus = false, readOnly = false, onChange, inputRef, onKeyDown }: {
  locale: string;
  text: Messages["results"];
  value: string;
  /** Why the server refused the name last time, already in words. */
  error?: string | null;
  autoFocus?: boolean;
  readOnly?: boolean;
  onChange: (value: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  const field = useId();
  const counter = useId();
  const count = graphemeCount(value.trim(), locale);
  const tooLong = count > NAME_LIMIT;
  return (
    <>
      <label htmlFor={field} className="font-semibold">{text.nameLabel}</label>
      <input
        id={field}
        ref={inputRef}
        autoFocus={autoFocus}
        readOnly={readOnly}
        dir="auto"
        type="text"
        autoComplete="off"
        value={value}
        aria-invalid={tooLong}
        aria-describedby={counter}
        className="min-h-11 w-full rounded-lg border border-muted bg-transparent px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current aria-[invalid=true]:border-dashed"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <p id={counter} className="text-sm text-muted" aria-live="polite" aria-atomic="true">
        {text.nameCounter.split("{count}").join(String(count))}
        {tooLong ? <> {text.nameTooLong}</> : error && <> {error}</>}
      </p>
    </>
  );
}

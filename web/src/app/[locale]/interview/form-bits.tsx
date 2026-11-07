import type { Messages } from "@/i18n/messages";
import { templateParts, type Errors } from "@/interview/answers";
import type { Notice } from "@/interview/flow";

export const buttonClass =
  "rounded-md border border-current px-4 py-2 text-base font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current aria-disabled:opacity-60";

export const inputClass =
  "w-full rounded-md border-2 border-current/60 bg-transparent px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current aria-[invalid=true]:border-current aria-[invalid=true]:border-dashed read-only:opacity-70";

/** The message for a field's error code; an unknown code falls back to the generic failure. */
export function errorText(
  messages: Messages["interview"],
  field: string,
  errors: Errors | null,
): string | null {
  const code = errors?.[field];
  if (code === undefined) return null;
  return messages.fieldErrors[field]?.[code] ?? messages.failed;
}

/**
 * A sentence with an heir in it. The name sits in its own `bdi`, so a name in the other
 * direction cannot reorder the words around it.
 */
export function WithHeir({ template, heir }: { template: string; heir: string }) {
  const [before, after] = templateParts(template);
  return (
    <>
      {before}
      <bdi>{heir}</bdi>
      {after}
    </>
  );
}

/**
 * The room for a field's message is always there, so a message appearing on blur never
 * shifts the button the visitor is about to click.
 */
export function FieldError({ id, text }: { id: string; text: string | null }) {
  return (
    <p id={id} className="min-h-6 text-sm font-medium">
      {text}
    </p>
  );
}

/**
 * The save status. The live region stays mounted and only its text changes, so screen
 * readers announce it; a failure is an alert of its own.
 */
export function SaveNotice({
  messages,
  notice,
  saving,
}: {
  messages: Messages["interview"];
  notice: Notice | null;
  saving: boolean;
}) {
  return (
    <>
      <p role="status">{saving ? messages.formSaving : ""}</p>
      {!saving && notice === "throttled" && <p role="alert">{messages.throttled}</p>}
      {!saving && notice === "failed" && <p role="alert">{messages.failed}</p>}
    </>
  );
}

/**
 * Errors that belong to none of the form's fields, such as the heir limit, or to a field
 * the form does not have. An unrecognised code reads as the generic failure, never silence.
 */
export function FormError({
  messages,
  errors,
  fields,
}: {
  messages: Messages["interview"];
  errors: Errors | null;
  /** The fields this form shows its own message for. */
  fields: readonly string[];
}) {
  const others = Object.keys(errors ?? {}).filter((field) => !fields.includes(field));
  if (others.length === 0) return null;
  return (
    <p role="alert" tabIndex={-1} data-focus="form-error" className="outline-none">
      {others.map((field) => errorText(messages, field, errors)).join(" ")}
    </p>
  );
}

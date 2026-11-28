"use client";

import { useEffect, useId, useRef, useState } from "react";
import { NAME_LIMIT, graphemeCount, suggestedName } from "@/api/saved-cases";
import type { Messages } from "@/i18n/messages";
import { directionOf } from "@/i18n/messages";
import { buttonClass } from "../interview/form-bits";
import { CaseNameField } from "./case-name-field";

/**
 * The naming dialog of a first Save. It is mounted only while open: the field starts with `initial` (what the
 * visitor typed before a failed save) or else the server's suggestion, and a blank name is sent as "" so the
 * server falls back to its suggestion. Submitting reports the trimmed name; Escape and Cancel report nothing.
 */
export function NameDialog({ locale, text, initial, error = null, onSubmit, onCancel }: {
  locale: string;
  text: Messages["results"];
  initial: string | null;
  /** Why the server refused the name last time, already in words. */
  error?: string | null;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [value, setValue] = useState(initial ?? "");
  const touched = useRef(initial !== null);
  const submitted = useRef<string | null>(null);

  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);

  useEffect(() => {
    if (initial !== null) return;
    const controller = new AbortController();
    void suggestedName(controller.signal, locale).then((name) => {
      if (name && !touched.current) setValue(name);
    });
    return () => controller.abort();
  }, [initial, locale]);

  const trimmed = value.trim();
  const tooLong = graphemeCount(trimmed, locale) > NAME_LIMIT;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (tooLong) return;
    submitted.current = trimmed;
    dialog.current?.close();
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={title}
      dir={directionOf(locale)}
      className="m-auto w-full max-w-md rounded-lg border border-muted bg-background p-6 text-foreground backdrop:bg-black/50"
      onClose={() => { if (submitted.current !== null) onSubmit(submitted.current); else onCancel(); }}
    >
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <h2 id={title} className="text-xl font-semibold">{text.nameTitle}</h2>
        <CaseNameField locale={locale} text={text} value={value} error={error} autoFocus onChange={(next) => { touched.current = true; setValue(next); }} />
        <div className="flex flex-wrap gap-3">
          <button type="submit" aria-disabled={tooLong} className={buttonClass}>{text.nameSubmit}</button>
          <button type="button" className={buttonClass} onClick={() => dialog.current?.close()}>{text.nameCancel}</button>
        </div>
      </form>
    </dialog>
  );
}

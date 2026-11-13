"use client";

import { useState } from "react";
import type { RelativeAnswers, RelativeQuestion, RelationshipId } from "@/api/case";
import type { Messages } from "@/i18n/messages";
import { buttonClass, inputClass } from "./form-bits";

export function RelativesQuestion({ questions, messages, labels, saving, initial, onSubmit }: {
  questions: RelativeQuestion[];
  messages: Messages["interview"];
  labels: Record<string, string>;
  saving: boolean;
  initial?: RelativeAnswers;
  onSubmit: (answers: RelativeAnswers) => void;
}) {
  const mothers = questions.filter((q) => q.options.length === 2 && q.options.includes("mother") && q.options.includes("none"));
  const motherChoice = mothers.length > 1;
  const label = (q: RelativeQuestion) => labels[q.person] ?? q.person;
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(
    questions.map((q) => {
      const given = q.kind === "shared_father" ? initial?.shared_father : initial?.relatives?.[q.id];
      const fallback = motherChoice && mothers.some((mother) => mother.id === q.id) ? (q.id === mothers[0].id ? "mother" : "none") : q.suggested;
      return [q.id, given !== undefined && q.options.includes(given) ? given : fallback];
    }),
  ));
  return <form className="flex w-full flex-col gap-3" data-focus="relatives" tabIndex={-1} onSubmit={(event) => {
    event.preventDefault();
    if (saving) return;
    const relatives = Object.fromEntries(questions.filter((q) => q.kind === "relative").map((q) => [q.id, values[q.id] ?? q.suggested]));
    const shared = questions.find((q) => q.kind === "shared_father");
    onSubmit({ relatives, ...(shared ? { shared_father: values[shared.id] ?? shared.suggested } : {}) });
  }}>
    {motherChoice && <label className="flex flex-col gap-1">
      <span>{messages.relativesMotherQuestion}</span>
      <select className={inputClass} data-focus="relativeMother" disabled={saving} value={mothers.find((q) => values[q.id] === "mother")?.id ?? "none"}
        onChange={(event) => setValues({ ...values, ...Object.fromEntries(mothers.map((q) => [q.id, q.id === event.target.value ? "mother" : "none"])) })}>
        {mothers.map((q) => <option key={q.id} value={q.id}>{label(q)}</option>)}
        <option value="none">{messages.relativesNone}</option>
      </select>
    </label>}
    {questions.filter((q) => !motherChoice || !mothers.some((mother) => mother.id === q.id)).map((q) => <label key={q.id} className="flex flex-col gap-1">
      <span>{q.kind === "shared_father" ? messages.sharedFatherQuestion : messages.relativesQuestion} <bdi>{label(q)}</bdi></span>
      <select className={inputClass} data-focus={`relative:${q.id}`} disabled={saving} value={values[q.id] ?? q.suggested}
        onChange={(event) => setValues({ ...values, [q.id]: event.target.value })}>
        {q.options.map((option) => <option key={option} value={option}>{
          option === "none" ? messages.relativesNone : option === "yes" ? messages.relativesYes :
          option === "no" ? messages.relativesNo : messages.relationships[option as RelationshipId]
        }</option>)}
      </select>
    </label>)}
    <button className={buttonClass} data-focus="relativesSubmit" disabled={saving} type="submit">{messages.relativesSubmit}</button>
  </form>;
}

import { useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import type { HeirFields, PlacementOption } from "@/api/case";
import type { Messages } from "@/i18n/messages";
import type { FocusTarget, StartedView } from "@/interview/flow";
import { relationshipIssue } from "@/interview/answers";
import { layerAt } from "@/interview/layers";
import { estateModel, treeDescription, type TreePerson } from "@/interview/tree";
import { AddHere } from "./add-here";
import { buttonClass, errorText, FieldError, FormError, inputClass, SaveNotice, WithHeir } from "./form-bits";
import { RelationshipFields } from "./heir-form";

const phoneQuery = "(width < 640px)";
function subscribePhone(notify: () => void) {
  const media = window.matchMedia(phoneQuery);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}

type Copy = Messages["interview"];
type Props = {
  messages: Copy;
  view: StartedView;
  person: TreePerson;
  label: string;
  frozen: boolean;
  onClose: () => void;
  onSave: (fields: HeirFields, focus: FocusTarget, close?: boolean) => void;
  onRemove: (confirm: boolean) => void;
  /** The engine's placement entries for this person, and the add they make (Story 9.7). */
  entries?: readonly PlacementOption[];
  atLimit?: boolean;
  addAlert?: string | null;
  onAddHere?: (entry: PlacementOption) => void;
  /** Story 9.8: choose a later death here, and open the person's own estate. */
  /** `name` is an uncommitted name edit, saved before the death is sent; undefined when there is none. */
  onMarkLater?: (name?: string | null) => void;
  /** `name` is an uncommitted name edit, saved before the estate opens; undefined when there is none. */
  onOpenEstate?: (name?: string | null) => void;
  /** The order question of a refused later death, shown inside the sheet. */
  orderQuestion?: ((name?: string | null) => React.ReactNode) | null;
};

function ImpactList({ view, messages }: Pick<Props, "view" | "messages">) {
  const impact = view.confirming?.impact;
  if (!impact || !(impact.persons.length || impact.estates.length)) return null;
  const labels = new Map<string, string>();
  for (const layer of [null, ...view.case.deaths.map(d => d.heir_id)]) {
    const model = estateModel(view.case, layer, null);
    for (const words of treeDescription(messages, model).people) {
      const person = model.people.find(p => p.id === words.id)!;
      if (!labels.has(person.personId)) labels.set(person.personId,
        person.name ? `${words.relationship} · ${person.name}` : words.label);
    }
  }
  return <>
    <p>{messages.removeImpactIntro}</p>
    <ul className="list-disc ps-6">
      {impact.persons.map(id => <li key={id}><bdi dir="auto">{labels.get(id) ?? id}</bdi></li>)}
      {impact.estates.map(order => {
        const id = view.case.deaths.find(d => d.order === order)?.heir_id;
        return <li key={order}><WithHeir template={messages.removeImpactEstate}
          heir={(id && labels.get(id)) ?? String(order)} /></li>;
      })}
    </ul>
  </>;
}

export function EditSheet({ messages, view, person, label, frozen, onClose, onSave, onRemove, entries = [], atLimit = false, addAlert = null, onAddHere, onMarkLater, onOpenEstate, orderQuestion = null }: Props) {
  const phone = useSyncExternalStore(subscribePhone, () => window.matchMedia(phoneQuery).matches, () => false);
  const heading = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const name = useRef<HTMLInputElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  // A press inside the sheet: the pressed control carries the draft name, so the blur it causes saves nothing.
  const pressing = useRef(false);
  const pressHandlers = {
    onPointerDownCapture: () => { pressing.current = true; },
    onClickCapture: () => { setTimeout(() => { pressing.current = false; }); },
    onPointerCancelCapture: () => { pressing.current = false; },
  };
  const [draft, setDraft] = useState<{ text: string; basis: typeof view.case } | null>(null);
  // A picked relationship the server already marks impossible: explained at once, never sent.
  const [issue, setIssue] = useState<{ code: string; basis: typeof view.case; id: string } | null>(null);
  const [seq, setSeq] = useState(0);
  const localIssue = issue?.basis === view.case && issue.id === person.id ? issue.code : null;
  const accepted = person.name ?? "";
  const text = draft?.basis === view.case ? draft.text : accepted;
  const confirmation = view.confirming;
  const layer = layerAt(view.case, view.layer);
  const options = layer.heirs.find(h => h.id === person.id)?.edit_options ?? view.case.heir_options;
  const draftName = text.trim() || null;
  const dirty = draftName !== (person.name ?? null);
  const fields = { relationship: person.relationship, name: draftName };
  const nameError = errorText(messages, "name", view.errors);
  const deathAlert = view.sheetDeath && view.ordering === null
    ? errorText(messages, "death", view.errors) ?? errorText(messages, "empty", view.errors) ?? errorText(messages, "relatives", view.errors)
    : null;
  const sheetAlert = deathAlert;
  const statusError = errorText(messages, "status", view.errors) ?? errorText(messages, "heirs", view.errors);
  useLayoutEffect(() => {
    const modal = dialog.current;
    if (modal && !modal.open) modal.showModal();
    return () => { if (modal?.open) modal.close(); };
  }, [phone]);
  useLayoutEffect(() => {
    (confirmation ? keep.current : name.current)?.focus();
  }, [phone, person.id, confirmation]);

  function save(next: HeirFields, focus: FocusTarget, closing?: boolean) {
    setIssue(null);
    onSave(next, focus, closing);
  }
  function commitName() {
    if (!frozen && dirty) save(fields, "name");
  }
  function close() {
    if (frozen) return;
    if (dirty && !confirmation) save(fields, "name", true);
    else onClose();
  }
  const content = <div className="flex min-w-0 flex-col gap-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 id={heading} className="text-lg font-semibold">{confirmation
        ? <WithHeir template={messages.heirRemoveConfirm} heir={label} /> : messages.heirEditHeading}</h3>
      <button type="button" className={buttonClass} aria-disabled={frozen} onClick={close}>{messages.editClose}</button>
    </div>
    {view.conflict && <p role="alert">{messages.conflictNotice}</p>}
    {confirmation ? <>
      <ImpactList view={view} messages={messages} />
      <div className="flex flex-wrap gap-2">
        <button type="button" className={buttonClass} aria-disabled={frozen}
          onClick={() => { if (!frozen) onRemove(confirmation.impact !== null); }}>{messages.heirRemoveYes}</button>
        <button ref={keep} type="button" className={buttonClass} aria-disabled={frozen} onClick={close}>{messages.heirRemoveNo}</button>
      </div>
    </> : <>
      <div>
        <label htmlFor="edit-name">{messages.heirNameLabel}</label>
        <input id="edit-name" data-focus="name" ref={name} dir="auto" className={inputClass} value={text}
          readOnly={frozen} aria-invalid={!!nameError} aria-describedby="edit-name-error"
          onChange={event => { if (!frozen) setDraft({ text: event.target.value, basis: view.case }); }}
          onBlur={event => {
            const next = event.relatedTarget as Node | null;
            // Tab and other focus moves still commit; only a press on a control inside the sheet defers to it.
            if (pressing.current && next && (dialog.current ?? panel.current)?.contains(next)) return;
            commitName();
          }} onKeyDown={event => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); commitName(); }
          }} />
        <FieldError id="edit-name-error" text={nameError} />
      </div>
      <RelationshipFields messages={messages} options={options} deceasedGender={layer.gender ?? person.gender}
        labelBlocked={false} value={person.relationship} frozen={frozen} immediate errorAnnounce={seq}
        relationshipError={localIssue
          ? errorText(messages, "relationship", { relationship: localIssue })
          : errorText(messages, "relationship", view.errors)}
        onChange={(relationship, control) => {
          if (!relationship || relationship === fields.relationship) { setIssue(null); return; }
          const code = relationshipIssue(options, relationship);
          if (code) { setIssue({ code, basis: view.case, id: person.id }); setSeq(n => n + 1); return; }
          save({ ...fields, relationship: relationship as HeirFields["relationship"] }, `editRelationship:${control}`);
        }} />
      {person.state !== "died_later" && <fieldset aria-describedby="edit-status-error">
        <legend>{messages.statusLegend}</legend>
        {(view.layer === null ? ["alive", "died_before_or_with"] as const : ["alive"] as const).map(status => <label key={status} className="flex min-h-11 items-center gap-2">
          <input type="radio" name="edit-status" value={status} data-focus={`editStatus:${status}`}
            checked={(person.state === "died_before") === (status === "died_before_or_with")}
            aria-disabled={frozen} onChange={() => { if (!frozen) save({ ...fields, status }, `editStatus:${status}`); }} />
          {status === "alive" ? messages.statusAlive : messages.statusDiedBefore}
        </label>)}
        {person.state !== "died_before" && (view.case.deaths.length >= 2
          ? <p>{messages.laterDeathLimit}</p>
          : <label className="flex min-h-11 items-center gap-2">
            <input type="radio" name="edit-status" value="died_later" data-focus="editStatus:died_later"
              checked={false} aria-disabled={frozen}
              onChange={() => { if (!frozen) { setIssue(null); onMarkLater?.(dirty ? draftName : undefined); } }} />
            {messages.statusDiedLater}
          </label>)}
        <FieldError id="edit-status-error" text={statusError} />
        {sheetAlert && <p role="alert">{sheetAlert}</p>}
        {orderQuestion?.(dirty ? draftName : undefined)}
      </fieldset>}
      {person.state === "died_later" && <button type="button" data-focus="openEstate"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md bg-accent px-4 py-2 text-base font-semibold text-accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current aria-disabled:opacity-60"
        aria-disabled={frozen} onClick={() => { if (!frozen) onOpenEstate?.(dirty ? draftName : undefined); }}>
        <WithHeir template={messages.openOwnEstate} heir={label} /></button>}
      <AddHere messages={messages} anchor={person.personId} personLabel={label} entries={entries}
        frozen={frozen} atLimit={atLimit} alert={addAlert} onChoose={entry => onAddHere?.(entry)} />
      {person.state !== "died_later" && <button type="button" className={buttonClass} aria-disabled={frozen}
        onClick={() => { if (!frozen) onRemove(false); }}><WithHeir template={messages.heirRemove} heir={label} /></button>}
    </>}
    <FormError messages={messages} errors={view.errors} fields={["name", "relationship", "status", "heirs", "death", "empty", "relatives"]} />
    <SaveNotice messages={messages} notice={view.notice} saving={view.saving} />
  </div>;

  return phone ? <dialog ref={dialog} aria-labelledby={heading} data-edit-sheet {...pressHandlers}
    className="fixed start-0 end-0 top-auto bottom-0 m-0 max-h-[85dvh] w-full max-w-none overflow-y-auto rounded-t-sheet border border-graphic bg-surface p-4 text-[var(--foreground)] backdrop:bg-scrim"
    onCancel={event => { event.preventDefault(); close(); }}>{content}</dialog>
    : <section ref={panel} aria-labelledby={heading} data-edit-sheet {...pressHandlers} className="rounded-sheet border border-graphic bg-surface p-4"
      onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); close(); } }}>{content}</section>;
}

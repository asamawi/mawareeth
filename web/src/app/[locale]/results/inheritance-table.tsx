"use client";

import { useEffect, useId, useLayoutEffect, useReducer, useRef, useState } from "react";

import type { Messages } from "@/i18n/messages";
import type { PreviewRow } from "@/interview/preview";
import { RelationshipText } from "../interview/relationship-text";
import { bodyCells, NO_NOTE, noteReducer, pruneNote, visibleNote, type ProofText, type TableView, type ViewRow } from "@/interview/table";

const cellClass = "border border-current/40 px-2 py-1 text-start align-middle";
const headClass = "border border-current/40 px-2 py-1 text-start align-middle font-semibold";

/** The explanation of one heir's share: the server's own worded facts. */
export function ProofList({
  text,
  proof,
}: {
  text: Messages["results"];
  proof: ProofText;
}) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
      <dt>{text.proofRule}</dt>
      <dd>{proof.labels.rule}</dd>
      {proof.labels.condition && (
        <>
          <dt>{text.proofCondition}</dt>
          <dd>{proof.labels.condition}</dd>
        </>
      )}
      {proof.labels.blocked_by && (
        <>
          <dt>{text.proofBlockedBy}</dt>
          <dd>{proof.labels.blocked_by}</dd>
        </>
      )}
      {proof.fraction && (
        <>
          <dt>{text.proofFraction}</dt>
          <dd>
            <bdi dir="ltr">{proof.fraction}</bdi>
          </dd>
        </>
      )}
      {proof.labels.school_rule && (
        <>
          <dt>{text.proofSchoolRule}</dt>
          <dd>{proof.labels.school_rule}</dd>
        </>
      )}
      {proof.labels.option && (
        <>
          <dt>{text.proofOption}</dt>
          <dd>{proof.labels.option}</dd>
        </>
      )}
      {proof.labels.verse && (
        <>
          <dt>{text.proofVerse}</dt>
          <dd>{proof.labels.verse}</dd>
        </>
      )}
    </dl>
  );
}

function DeathTitle({ text, order }: { text: string; order: number }) {
  const [before, after] = text.split("{n}");
  return <>{before}<bdi dir="ltr">{order}</bdi>{after}</>;
}

/**
 * The scholars' table of single or successive deaths, shared by results and the interview
 * preview. Every number in it is the engine's own, shown as the server's text; a merged cell is the group's total. A heir's
 * explanation is a side note: hover or keyboard focus previews it, click or Enter pins it, and
 * Escape closes it. The side note sits beside the table from `md` up and below it on narrow
 * screens, never inside the row grid. The table scrolls inside its own container.
 */
export function InheritanceTable({
  text,
  relationships,
  view,
  labels,
  relations,
  segments,
  proofs,
}: {
  text: Messages["results"];
  relationships: Record<string, string>;
  view: TableView;
  /** The label of each heir, by session id. */
  labels: Record<string, string>;
  /** The relationship id of each heir, by session id. */
  relations: Record<string, string>;
  /** The server's translated and Arabic-original relationship of each living heir, by session id. */
  segments: Record<string, PreviewRow["relationship"] | undefined>;
  /** The proof entry of each heir, by session id. */
  proofs: Record<string, ProofText | undefined>;
}) {
  const t = text.table;
  const [raw, dispatch] = useReducer(noteReducer, NO_NOTE);
  const noteId = useId();
  const ids = new Set(view.rows.filter((row) => row.kind !== "unallocated").map((row) => row.heirId));
  // a heir that is no longer in the table is forgotten
  const state = pruneNote(raw, ids);
  const open = visibleNote(state);
  const withAmount = view.rows.some((row) => row.amount !== null);
  const withPercent = view.rows.some((row) => row.percent !== null);

  const frame = useRef<HTMLDivElement>(null);
  const rowsRef = useRef(new Map<string, HTMLTableRowElement>());
  const [top, setTop] = useState(0);

  // the note sits just under the open heir's row
  useLayoutEffect(() => {
    if (open === null) return;
    const place = () => {
      const row = rowsRef.current.get(open);
      if (row && frame.current) {
        setTop(row.getBoundingClientRect().bottom - frame.current.getBoundingClientRect().top);
      }
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  useEffect(() => {
    if (open === null) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") dispatch({ type: "escape" });
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);

  const note = (id: string) => {
    const proof = proofs[id];
    const label = labels[id] ?? id;
    return (
      <div className="flex flex-col gap-2">
        <strong>{t.noteTitle.split("{heir}").join(label)}</strong>
        {view.notes ? (view.notes[id] ?? []).map((entry) => (
          <section key={entry.order} className="flex flex-col gap-2">
            <h3><DeathTitle text={t.death} order={entry.order} /></h3>
            <ProofList text={text} proof={entry.proof} />
          </section>
        )) : proof ? <ProofList text={text} proof={proof} /> : null}
      </div>
    );
  };

  const renderRow = (row: ViewRow) => {
    const id = row.heirId;
    const label = row.kind === "unallocated" ? t.unallocated : labels[id] ?? id;
    const active = row.kind !== "unallocated" && open === id;
    const proof = row.kind === "unallocated" ? undefined : proofs[id] ?? view.notes?.[id]?.[0]?.proof;
    return (
      <tr
        key={JSON.stringify([row.kind ?? "person", id])}
        ref={(element) => {
          if (row.kind === "unallocated") return;
          if (element) rowsRef.current.set(id, element);
          else rowsRef.current.delete(id);
        }}
        data-active={active ? "" : undefined}
        className={active ? "bg-current/10" : undefined}
        onMouseEnter={row.kind === "unallocated" ? undefined : () => dispatch({ type: "hover", id })}
        onMouseLeave={row.kind === "unallocated" ? undefined : () => dispatch({ type: "unhover", id })}
      >
          <th scope="row" className={cellClass}>
            {proof ? (
              <button
                type="button"
                className="text-start underline decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
                aria-expanded={active}
                aria-controls={noteId}
                aria-label={t.noteFor.split("{heir}").join(label)}
                onFocus={() => dispatch({ type: "focus", id })}
                onBlur={() => dispatch({ type: "blur", id })}
                onClick={() => dispatch({ type: "toggle", id })}
              >
                <bdi>{label}</bdi>
              </button>
            ) : (
              <bdi>{label}</bdi>
            )}
          </th>
          <td className={cellClass}>{segments[id] ? <RelationshipText relationship={segments[id]} /> : relationships[relations[id] ?? ""] ?? ""}</td>
          {!view.groups && row.prescribedSpan > 0 && (
            <td className={cellClass} rowSpan={row.prescribedSpan}>
              {row.prescribed.kind === "fraction" ? (
                <bdi dir="ltr">{row.prescribed.fraction}</bdi>
              ) : row.prescribed.kind === "residuary" ? (
                t.residuary
              ) : (
                t.blocked
              )}
            </td>
          )}
          {bodyCells(row, view.columns).map((cell) => (
            <td key={cell.code} rowSpan={cell.rowSpan} className={cellClass}>
              {cell.covered ? <span className="sr-only">{cell.members?.map((id) => labels[id] ?? id).join(", ")}</span> : cell.code.endsWith(":prescribed") ? (() => {
                const prescribed = row.prescribedByLayer?.[view.groups!.findIndex((g) => cell.code.startsWith(`${g.order}:`))];
                return <>{prescribed?.kind === "fraction" ? <bdi dir="ltr">{prescribed.fraction}</bdi> : prescribed?.kind === "blocked" ? t.blocked : prescribed?.kind === "residuary" ? t.residuary : null}{cell.members && <small className="block">{cell.members.map((id) => labels[id] ?? id).join(", ")}</small>}</>;
              })() : cell.text === null ? null : <>
                <bdi dir="ltr">{cell.text}</bdi>
                {cell.members && <small className="block">{cell.members.map((id) => labels[id] ?? id).join(", ")}</small>}
              </>}
            </td>
          ))}
          {withPercent && (
            <td className={cellClass}>
              {row.percent !== null && <bdi dir="ltr">{row.percent}</bdi>}
            </td>
          )}
          <td className={cellClass}>{row.kirat !== null && <bdi dir="ltr">{row.kirat}</bdi>}</td>
          {withAmount && (
            <td className={cellClass}>
              {row.amount !== null && <bdi dir="auto">{row.amount}</bdi>}
            </td>
          )}
      </tr>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">{t.noteHint}</p>
      {/* The note floats under its row and takes no room of its own; the table keeps the full width. */}
      <div ref={frame} className="relative">
        <div
          role="region"
          aria-label={t.caption}
          tabIndex={0}
          className="relative min-w-0 overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        >
          <table className="w-full min-w-max border-collapse text-sm">
            <caption className="sr-only">{t.caption}</caption>
            <thead>
              {view.groups && <tr>
                <th colSpan={2} className={headClass}>{t.caption}</th>
                {view.groups.map((group) => <th key={group.order} colSpan={group.count} scope="colgroup" className={headClass}>
                  <span><DeathTitle text={t.death} order={group.order} /></span>
                  {group.heir && <bdi> {"\u00b7"} {labels[group.heir] ?? group.heir}</bdi>}
                  {group.p !== null && <div className="font-normal">
                    {t.deceasedShare}: <bdi dir="ltr">{group.p}</bdi> {"\u00b7"} {t.multiplier}: <bdi dir="ltr">{"\u00d7"}{group.old} / {"\u00d7"}{group.next}</bdi> {"\u00b7"} {group.relation === "no_share" ? t.noShare : t[group.relation as "tamathul" | "tawafuq" | "tabayun"]}
                  </div>}
                </th>)}
                <th colSpan={(withPercent ? 1 : 0) + 1 + (withAmount ? 1 : 0)} className={headClass} />
              </tr>}
              <tr>
                <th scope="col" rowSpan={2} className={headClass}>{t.name}</th>
                <th scope="col" rowSpan={2} className={headClass}>{t.relation}</th>
                {!view.groups && <th scope="col" rowSpan={2} className={headClass}>{t.prescribed}</th>}
                {view.columns.map((column) => (
                  <th key={column.code} scope="col" className={headClass}>{column.label === "prescribed" ? t.prescribed : column.label === "jamia" ? t.jamia : column.label}</th>
                ))}
                {withPercent && <th scope="col" rowSpan={2} className={headClass}>{t.percent}</th>}
                <th scope="col" rowSpan={2} className={headClass}>{t.kirat}</th>
                {withAmount && <th scope="col" rowSpan={2} className={headClass}>{t.amount}</th>}
              </tr>
              <tr>
                {view.columns.map((column) => (
                  <td key={column.code} className={headClass}>
                    <span className="sr-only">{t.total}: </span>
                    <bdi dir="ltr">{column.total > 0 ? column.totalText : ""}</bdi>
                  </td>
                ))}
              </tr>
            </thead>
            <tbody>{view.rows.map(renderRow)}</tbody>
          </table>
        </div>
        <aside
          id={noteId}
          aria-live="polite"
          hidden={open === null}
          onMouseEnter={() => dispatch({ type: "panelEnter" })}
          onMouseLeave={() => dispatch({ type: "panelLeave" })}
          style={{ top }}
          className="absolute end-0 z-20 w-80 max-w-full rounded-md border border-current/60 bg-[var(--background)] p-3 shadow-lg"
        >
          {open !== null && note(open)}
        </aside>
      </div>
    </div>
  );
}

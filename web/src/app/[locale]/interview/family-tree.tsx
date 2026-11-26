"use client";

import { useId, useLayoutEffect, useRef, useState } from "react";
import type { PlacementLink, PlacementOption, RelationshipId } from "@/api/case";
import type { Messages } from "@/i18n/messages";
import { dropEntry, fitZoom, layoutTree, pinBox, placeholders, treeDescription, treeNeighbour, ZOOM_LEVELS, type EstateModel } from "@/interview/tree";
import { focusRing, focusRingOnAccent, secondaryButton } from "../ui";
import { AddHere } from "./add-here";

export function FamilyTree({ messages, model, rootText, editingId, locale, onAnnounce, frozen = false, onEdit, onRemoveRequest, dragging = null, atLimit = false, addOutcome = null, dropAlert = null, onAddHere, onOpenEstate, breadcrumb = null }: {
  messages: Messages["interview"]; model: EstateModel; rootText?: string;
  frozen?: boolean; onEdit?: (id: string) => void; onRemoveRequest?: (id: string) => void;
  editingId: string | null; locale: string; onAnnounce: (note: string) => void;
  /** The relationship chip being dragged: every card and placeholder is marked as a legal or illegal drop. */
  dragging?: RelationshipId | null;
  atLimit?: boolean;
  /** The refusal of the last positioned add, with the anchor it was made at. */
  addOutcome?: { anchor: string; text: string } | null;
  /** The alert of a drop the placement does not allow. */
  dropAlert?: string | null;
  onAddHere?: (anchor: string, entry: PlacementOption) => void;
  /** A died-later card opens that person's own estate (by their person id). */
  onOpenEstate?: (personId: string) => void;
  /** The "Estate level" breadcrumb, shown directly above the canvas. */
  breadcrumb?: React.ReactNode;
}) {
  const heading = useId();
  const area = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const [view, setView] = useState({ width: 288, height: 320, scrollLeft: 0, scrollTop: 0 });
  const [wide, setWide] = useState(false);
  const [rtl, setRtl] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [rootLink, setRootLink] = useState<PlacementLink | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; touch: boolean } | null>(null);
  const suppress = useRef(false);
  const measure = () => {
    const el = area.current;
    if (el) setView({ width: el.clientWidth || 288, height: el.clientHeight || 320, scrollLeft: el.scrollLeft, scrollTop: el.scrollTop });
  };
  useLayoutEffect(() => {
    const el = area.current!;
    const resize = () => { measure(); setWide(window.innerWidth >= 640); setRtl(window.getComputedStyle(el).direction === "rtl"); };
    resize();
    window.addEventListener("resize", resize);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(el);
    return () => { observer?.disconnect(); window.removeEventListener("resize", resize); };
  }, []);
  const layout = layoutTree(model, Math.max(264, view.width - 16), wide ? 136 : 108);
  // Scroll that centres the deceased horizontally, in inline coordinates (negative in RTL by the caller); the 8px is the canvas padding.
  const centreInline = (z: number, viewWidth: number) => Math.max(0, (layout.deceased.x + layout.deceased.width / 2) * z + 8 - viewWidth / 2);
  const settled = useRef(false);
  const lastSpine = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    const previous = lastSpine.current;
    lastSpine.current = layout.spineX;
    if (!settled.current) {
      // First real measurement: centre the deceased when the tree is wider than the canvas.
      if (el.clientWidth > 0 && view.width === el.clientWidth) {
        settled.current = true;
        const inline = centreInline(zoom, view.width);
        if (inline > 0) { el.scrollLeft = rtl ? -inline : inline; measure(); }
      }
      return;
    }
    if (previous !== null && previous !== layout.spineX) {
      // The spine moved inside the layout: keep the deceased where it was on screen.
      const d = (layout.spineX - previous) * zoom;
      el.scrollLeft = view.scrollLeft + (rtl ? -d : d);
      measure();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.spineX, zoom, rtl, view.width]);
  const text = treeDescription(messages, model, rootText);
  const ids = ["root", ...layout.nodes.map(n => n.id)];
  // The deceased is the tab stop until a card is pressed; only a pressed or edited card is current.
  const current = selected !== null && ids.includes(selected) ? selected : "root";
  const pinned = pinBox(layout.deceased, { ...view, scrollLeft: view.scrollLeft + (rtl ? 8 : -8), scrollTop: view.scrollTop - 8 }, zoom, 6, rtl);
  const announceZoom = (z: number) => {
    setZoom(z);
    onAnnounce(messages.treeZoomStatus.replace("{percent}", new Intl.NumberFormat(locale, { style: "percent" }).format(z)));
  };
  const stepZoom = (delta: 1 | -1) => {
    const next = ZOOM_LEVELS[ZOOM_LEVELS.indexOf(zoom as typeof ZOOM_LEVELS[number]) + delta];
    if (next !== undefined) announceZoom(next);
  };
  const empty = placeholders(model);
  const openLink = rootLink !== null && (empty as readonly string[]).includes(rootLink) ? rootLink : null;
  const currentPerson = model.people.find(p => p.id === current);
  const rowAnchor = openLink ? "root" : currentPerson ? currentPerson.personId : "root";
  const rowLabel = openLink || current === "root" ? text.deceased : text.people.find(p => p.id === current)?.label ?? text.deceased;
  const mark = (anchor: string, link?: PlacementLink) => dragging === null ? null : dropEntry(model, anchor, dragging, link) ? "legal" : "illegal";
  const height = layout.height + (empty.length ? 128 : 0) + 16;
  const card = (id: string, box: typeof layout.deceased) => {
    const person = model.people.find(p => p.id === id);
    const words = text.people.find(p => p.id === id);
    const state = person?.state ?? "deceased";
    const editable = state !== "deceased" && state !== "died_later";
    const target = mark(person?.personId ?? "root");
    return <button key={id} data-focus={`card:${id}`} data-drop-anchor={person?.personId ?? "root"} data-drop={target ?? undefined} aria-disabled={editable && frozen} type="button" data-node={id} data-state={state}
      ref={el => { if (el) buttons.current.set(id, el); else buttons.current.delete(id); }}
      tabIndex={current === id ? 0 : -1} aria-current={(editingId ?? selected) === id ? "true" : undefined}
      onClick={() => {
        if (editable && frozen) return;
        setRootLink(null);
        if (state === "died_later" && person && onOpenEstate) { onOpenEstate(person.personId); return; }
        setSelected(id);
        if (editable) onEdit?.(id);
      }}
      onFocus={event => { setRootLink(null); setSelected(id); if (id !== "root") event.currentTarget.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" }); }}
      onKeyDown={event => {
        // Modified arrows keep their browser meaning, such as Alt+Left for back.
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.key === "Delete") {
          if (state === "deceased") return;
          event.preventDefault();
          if (!frozen) onRemoveRequest?.(id);
          return;
        }
        if (event.key === "+" || event.key === "=" || event.key === "-" || event.key === "_") {
          event.preventDefault();
          stepZoom(event.key === "+" || event.key === "=" ? 1 : -1);
          return;
        }
        const dir = ({ ArrowUp: "up", ArrowDown: "down", Home: "home", End: "end",
          ArrowRight: rtl ? "prev" : "next", ArrowLeft: rtl ? "next" : "prev" } as const)[event.key as "ArrowUp"];
        if (!dir) return;
        event.preventDefault();
        const next = treeNeighbour(model, ids, id, dir);
        if (next !== id) { setSelected(next); buttons.current.get(next)?.focus(); }
      }}
      className={`absolute ${id === "root" ? "" : "motion-safe:transition-[inset-inline-start,top] motion-safe:duration-300"} scroll-m-2 flex flex-col items-center justify-center gap-1 rounded-node p-2 text-center [overflow-wrap:anywhere] ${editingId === id ? "outline-3 -outline-offset-3 outline-current" : "aria-[current=true]:outline aria-[current=true]:outline-offset-2 aria-[current=true]:outline-accent"} ${target === "illegal" ? `bg-surface text-muted ${focusRing}` : state === "deceased" ? `bg-accent text-accent-foreground ${focusRingOnAccent}` : focusRing} ${target !== "illegal" && (state === "normal" || state === "died_later") ? "bg-[var(--background)]" : ""} ${target !== "illegal" && (state === "died_before" || state === "blocked") ? "bg-surface" : ""}`}
      style={{ insetInlineStart: box.x, top: box.y, width: box.width, height: box.height,
        border: target === "legal" ? "2px solid var(--accent)" : state === "deceased" || state === "died_before" ? "none" : state === "died_later" ? "2px solid var(--accent)" : "1.5px solid var(--graphic)",
        backgroundImage: state === "blocked" ? "repeating-linear-gradient(135deg, var(--surface) 0 6px, var(--blocked-stripe) 6px 12px)" : undefined }}>
      {state === "died_before" && <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" fill="none"><rect x="1" y="1" width={box.width - 2} height={box.height - 2} rx="9" stroke="var(--graphic)" strokeWidth="2" strokeDasharray="4 3" /></svg>}
      <strong className={`text-node-name ${state === "blocked" ? "bg-surface text-muted" : ""}`}>{id === "root" ? <bdi>{text.deceased}</bdi> : words?.relationship}</strong>
      {words?.secondary && <span className={`text-node-meta ${state === "blocked" ? "bg-surface text-muted" : ""}`}><bdi>{words.secondary}</bdi></span>}
      {target && <span aria-hidden="true" className={`absolute inset-x-1 bottom-1 rounded px-1 text-badge font-semibold ${target === "legal" ? "bg-accent text-accent-foreground" : "bg-surface text-muted"}`}>{target === "legal" ? messages.dropHere : messages.dropNotHere}</span>}
      {words?.badge && <span className={`rounded-full border px-1 text-badge ${state === "died_later" ? "border-accent bg-accent-soft text-accent" : state === "died_before" ? "border-dashed border-graphic bg-[var(--background)]" : "border-graphic bg-surface text-muted"}`}>{words.badge}{state === "died_later" && <span aria-hidden="true" className="inline-block rtl:-scale-x-100"> ›</span>}</span>}
    </button>;
  };
  return <section data-tree aria-labelledby={heading} data-wide className="flex w-full flex-col gap-2">
    <h3 id={heading} tabIndex={-1} data-focus="treeHeading" className={`text-lg font-semibold ${focusRing}`}>{rootText ?? messages.treeHeading}</h3>
    <p className="text-sm text-muted">{messages.treeHint}</p>
    <div className="flex gap-2">
      <button type="button" className={`${secondaryButton} motion-reduce:transition-none`} onClick={() => {
        const z = fitZoom({ width: layout.width, height }, view); announceZoom(z);
        requestAnimationFrame(() => { const el = area.current; if (el) { el.scrollTop = 0; const inline = centreInline(z, view.width); el.scrollLeft = rtl ? -inline : inline; measure(); } });
      }}>{messages.treeFit}</button>
      {([1, -1] as const).map(delta => <button key={delta} type="button" className={`${secondaryButton} motion-reduce:transition-none`} disabled={zoom === (delta === 1 ? 1.5 : 0.6)} onClick={() => stepZoom(delta)}><span aria-hidden="true">{delta === 1 ? "+" : "−"}</span><span className="sr-only">{delta === 1 ? messages.treeZoomIn : messages.treeZoomOut}</span></button>)}
    </div>
    {breadcrumb}
    <div ref={area} data-tree-area role="group" aria-labelledby={heading}
      className="relative h-[45vh] min-h-[200px] w-full select-none overflow-auto border-y border-line bg-surface p-2"
      style={{ touchAction: "pan-y pinch-zoom", backgroundImage: "radial-gradient(var(--color-line) 1px, transparent 1px)", backgroundSize: "18px 18px" }}
      onScroll={measure}
      onClickCapture={event => { if (suppress.current) { event.preventDefault(); event.stopPropagation(); suppress.current = false; } }}
      onPointerDown={event => { if (event.button !== 0) return; suppress.current = false; drag.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop, touch: event.pointerType === "touch" }; }}
      onPointerMove={event => {
        const d = drag.current; if (!d) return;
        // A mouse released outside the canvas sends no pointerup here; stop rather than pan unpressed.
        if (event.pointerType === "mouse" && event.buttons === 0) { drag.current = null; return; }
        const dx = event.clientX - d.x, dy = event.clientY - d.y;
        if (Math.hypot(dx, d.touch ? 0 : dy) <= 6 && !suppress.current) return;
        suppress.current = true; event.currentTarget.setPointerCapture?.(event.pointerId);
        event.currentTarget.scrollLeft = d.left - dx;
        if (!d.touch) event.currentTarget.scrollTop = d.top - dy;
        measure();
      }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; suppress.current = false; }}>
      <div style={{ width: layout.width * zoom, height: height * zoom }}>
        <div className="relative" style={{ width: layout.width, height, transform: `scale(${zoom})`, transformOrigin: rtl ? "100% 0" : "0 0" }}>
          <svg aria-hidden="true" width={layout.width} height={height} className="pointer-events-none absolute start-0 top-0 rtl:-scale-x-100" fill="none" stroke="var(--graphic)" strokeWidth="2">
            <path d={`M${layout.spineX} ${layout.spine.top}V${layout.spine.bottom}`} />
            {layout.edges.map(e => <path key={e.id} d={e.path} />)}
          </svg>
          {layout.nodes.map(n => card(n.id, n))}
          {card("root", pinned)}
          {empty.map((link, i) => {
            const target = mark("root", link);
            return <button key={link} type="button" data-focus={`placeholder:${link}`} data-drop-anchor="root" data-drop-link={link} data-drop={target ?? undefined}
              aria-disabled={frozen} onClick={() => { if (!frozen) setRootLink(link); }}
              className={`absolute flex min-h-[76px] min-w-11 flex-col items-center justify-center gap-1 rounded-node border-dashed p-2 aria-disabled:opacity-60 ${focusRing} ${target === "illegal" ? "bg-surface text-muted border-[1.5px] border-graphic" : target === "legal" ? "border-2 border-accent text-accent" : "border-[1.5px] border-accent text-accent"}`}
              style={{ insetInlineStart: i * ((wide ? 136 : 108) + 8), top: layout.height + 16, width: wide ? 136 : 108 }}>
              {link === "parent" ? messages.treeAddParent : messages.treeAddSpouse}
              {target && <span aria-hidden="true" className={`rounded px-1 text-badge font-semibold ${target === "legal" ? "bg-accent text-accent-foreground" : "bg-surface text-muted"}`}>{target === "legal" ? messages.dropHere : messages.dropNotHere}</span>}
            </button>;
          })}
        </div>
      </div>
    </div>
    {editingId === null && <div data-add-row className="flex flex-col gap-2 px-2">
      <AddHere key={`${rowAnchor}:${openLink ?? ""}`} messages={messages} anchor={rowAnchor} personLabel={rowLabel}
        entries={model.placement[rowAnchor] ?? []} link={openLink ?? undefined} defaultOpen={openLink !== null}
        frozen={frozen} atLimit={atLimit}
        alert={dropAlert ?? (addOutcome && addOutcome.anchor === rowAnchor ? addOutcome.text : null)}
        onChoose={entry => onAddHere?.(rowAnchor, entry)} />
    </div>}
  </section>;
}

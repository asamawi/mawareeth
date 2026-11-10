"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";

import type { Gender, Heir } from "@/api/case";
import type { Messages } from "@/i18n/messages";
import { heirLabels } from "@/interview/answers";
import { layoutTree, treeDescription } from "@/interview/tree";

// Before the first measurement, and where there is no ResizeObserver.
const FALLBACK_WIDTH = 288;

/**
 * The saved deceased and heirs as a tree. Heirs hang from one shared spine, because the case
 * records kinship to the deceased only. The scroll area is the single tab stop; the nodes are
 * not interactive, and the heir list remains the way to select, edit or remove.
 */
export function FamilyTree({
  messages,
  gender,
  rootText,
  heirs,
  editingId,
}: {
  messages: Messages["interview"];
  /** The gender of the layer's deceased. */
  gender: Gender;
  /** A later layer's root text, such as "Son (2nd death)"; the first deceased uses the plain text. */
  rootText?: string;
  /** The heirs of the layer shown: the tree draws only one layer. */
  heirs: Heir[];
  /** The heir whose form is open, marked by an outline. */
  editingId: string | null;
}) {
  const area = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(FALLBACK_WIDTH);

  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth || FALLBACK_WIDTH);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(() => layoutTree(heirs, width), [heirs, width]);
  const labels = heirLabels(heirs, messages.relationships, messages.heirNumbered);
  const description = treeDescription(messages, { gender }, heirs, rootText);
  const nodeById = new Map(heirs.map((heir) => [heir.id, heir]));
  const move = "absolute transition-[inset-inline-start,top] duration-300 motion-reduce:transition-none";

  return (
    <section data-tree aria-labelledby="tree-heading" data-wide className="flex w-full flex-col gap-2">
      <h3 id="tree-heading" className="text-lg font-semibold">
        {messages.treeHeading}
      </h3>
      <div
        ref={area}
        data-tree-area
        tabIndex={0}
        role="img"
        aria-label={description}
        className="max-h-[45vh] w-full overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable] rounded-md border border-current/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
      >
        <div className="relative mx-auto" style={{ width: layout.width, height: layout.height }}>
          <svg
            aria-hidden="true"
            focusable="false"
            width={layout.width}
            height={layout.height}
            className="absolute start-0 top-0 rtl:-scale-x-100"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d={`M${layout.spineX} ${layout.spine.top}V${layout.spine.bottom}`} />
            {layout.edges.map((edge) => (
              <path key={edge.id} d={edge.path} />
            ))}
          </svg>
          <div
            className={`${move} flex items-center justify-center overflow-hidden rounded-lg border-2 border-current bg-[var(--foreground)] p-2 text-center font-semibold text-[var(--background)]`}
            style={{
              insetInlineStart: layout.deceased.x,
              top: layout.deceased.y,
              width: layout.deceased.width,
              height: layout.deceased.height,
            }}
          >
            <span className="line-clamp-2 [overflow-wrap:anywhere]">
              {rootText !== undefined ? (
                <bdi>{rootText}</bdi>
              ) : gender === "male" ? (
                messages.treeDeceasedMale
              ) : (
                messages.treeDeceasedFemale
              )}
            </span>
          </div>
          {layout.nodes.map((node) => {
            const heir = nodeById.get(node.id);
            if (!heir) return null;
            const editing = editingId === heir.id;
            return (
              <div
                key={node.id}
                data-node={node.id}
                className={`${move} flex flex-col justify-center overflow-hidden rounded-lg bg-[var(--background)] p-2 text-center text-sm border border-current ${
                  editing ? "outline-[3px] -outline-offset-3 outline-current" : ""
                }`}
                style={{
                  insetInlineStart: node.x,
                  top: node.y,
                  width: node.width,
                  height: node.height,
                }}
              >
                <strong className="line-clamp-2 [overflow-wrap:anywhere]">
                  <bdi>{labels[node.id]}</bdi>
                </strong>
                {heir.name !== null && (
                  <span className="truncate text-xs">{messages.relationships[heir.relationship]}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {heirs.length === 0 && <p>{messages.treePrompt}</p>}
    </section>
  );
}

"use client";

import type { Messages } from "@/i18n/messages";
import { deathLayerText, type Crumb } from "@/interview/layers";

/** "<label> (2nd death)": the label sits in its own `bdi`, so a name cannot reorder the words. */
function CrumbText({ messages, crumb }: { messages: Messages["interview"]; crumb: Crumb }) {
  if (crumb.label === null) return <>{messages.deathsFirst}</>;
  const order = crumb.order === 2 ? messages.deathSecond : messages.deathThird;
  const [before, rest] = messages.deathLayerLabel.split("{label}");
  const [between, after] = (rest ?? "").split("{order}");
  return (
    <>
      {before}
      <bdi>{crumb.label}</bdi>
      {between}
      {order}
      {after}
    </>
  );
}

/** The text of a crumb as one string, for the tree's root and a layer's heading. */
export function crumbTextOf(messages: Messages["interview"], crumb: Crumb): string {
  if (crumb.label === null) return messages.deathsFirst;
  const order = crumb.order === 2 ? messages.deathSecond : messages.deathThird;
  return deathLayerText(messages.deathLayerLabel, crumb.label, order);
}

/**
 * "Estate level": the first deceased, then each estate down to the open one, above the tree. The
 * open level is plain text marked `aria-current="page"`; earlier levels are links that open that
 * estate and move focus to the tree heading. Absent at the first deceased.
 */
export function DeathBreadcrumb({
  messages,
  crumbs,
  active,
  disabled,
  onOpen,
}: {
  messages: Messages["interview"];
  /** The levels from the first deceased to the open estate. */
  crumbs: Crumb[];
  active: string | null;
  disabled: boolean;
  onOpen: (id: string | null) => void;
}) {
  if (active === null || crumbs.length < 2) return null;
  return (
    <nav aria-label={messages.estateLevel} data-breadcrumb>
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {crumbs.map((crumb, index) => {
          const current = crumb.id === active;
          return (
            <li key={crumb.id ?? "first"} className="flex items-center gap-1">
              {index > 0 && (
                <svg aria-hidden="true" focusable="false" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 rtl:-scale-x-100">
                  <path d="M6 3l5 5-5 5" />
                </svg>
              )}
              {current ? (
                <span aria-current="page" className="inline-flex min-h-11 items-center font-semibold">
                  <CrumbText messages={messages} crumb={crumb} />
                </span>
              ) : (
                <a
                  href="#"
                  className="inline-flex min-h-11 min-w-11 items-center text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-disabled:opacity-60"
                  aria-disabled={disabled}
                  onClick={(event) => {
                    event.preventDefault();
                    if (!disabled) onOpen(crumb.id);
                  }}
                >
                  <CrumbText messages={messages} crumb={crumb} />
                </a>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

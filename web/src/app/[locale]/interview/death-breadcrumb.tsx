"use client";

import type { Messages } from "@/i18n/messages";
import { deathLayerText, type Crumb } from "@/interview/layers";

import { buttonClass } from "./form-bits";

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
 * The layers of a case in death order: "First deceased > A (2nd death) > B (3rd death)". The
 * active one is marked `aria-current`; the others are buttons that move the heirs screen there.
 * Only shown for a case that has later deaths.
 */
export function DeathBreadcrumb({
  messages,
  crumbs,
  active,
  disabled,
  onOpen,
}: {
  messages: Messages["interview"];
  crumbs: Crumb[];
  active: string | null;
  disabled: boolean;
  onOpen: (id: string | null) => void;
}) {
  return (
    <nav aria-label={messages.deathsNavLabel} data-focus="breadcrumb">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {crumbs.map((crumb, index) => {
          const current = crumb.id === active;
          return (
            <li key={crumb.id ?? "first"} className="flex items-center gap-2">
              {index > 0 && (
                <span aria-hidden="true" className="rtl:-scale-x-100">
                  ›
                </span>
              )}
              {current ? (
                <span aria-current="true" data-focus={`layer:${crumb.id ?? "first"}`} className="font-semibold">
                  <CrumbText messages={messages} crumb={crumb} />
                </span>
              ) : (
                <button
                  type="button"
                  className={buttonClass}
                  data-focus={`layer:${crumb.id ?? "first"}`}
                  aria-disabled={disabled}
                  onClick={() => {
                    if (!disabled) onOpen(crumb.id);
                  }}
                >
                  <CrumbText messages={messages} crumb={crumb} />
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

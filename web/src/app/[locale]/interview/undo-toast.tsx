"use client";

import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";

import { setObstruction, TOAST_GAP, toastFloats, useObstructionHeight } from "@/interview/obstruction";

import type { Messages } from "@/i18n/messages";

import { focusRingOnToast } from "../ui";
import { buttonClass } from "./form-bits";

/** How long a change's toast stays, at least; hover or focus inside it pauses the countdown. */
export const TOAST_MS = 10_000;

/**
 * Whether a key event is the Undo shortcut: Ctrl (Cmd on macOS) with Z, no Shift or Alt. A Latin
 * "z" matches by its character; on a non-Latin layout (Arabic) the physical Z key matches by `code`.
 * `code` alone is never enough: on AZERTY the physical Z key types "w".
 */
export function isUndoShortcut(event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return false;
  if (event.key === "z" || event.key === "Z") return true;
  return !/^[a-z]$/i.test(event.key) && event.code === "KeyZ";
}

/** A persistent Undo control. It is `aria-disabled`, never natively disabled, while saving or offline. */
export function UndoButton({
  messages,
  disabled,
  onUndo,
}: {
  messages: Messages["interview"];
  disabled: boolean;
  onUndo: () => void;
}) {
  return (
    <button
      type="button"
      className={`${buttonClass} min-w-11`}
      data-focus="undoLastChange"
      aria-disabled={disabled}
      onClick={() => {
        if (!disabled) onUndo();
      }}
    >
      {messages.undoLastChange}
    </button>
  );
}

/**
 * The toast after a change. It is not a live region: the polite status region in the Heirs list
 * already announces the change. Mount it with a new `key` for each change so its timer restarts.
 * It never takes focus, and hiding it leaves the history alone.
 */
export function UndoToast({
  messages,
  children,
  disabled,
  onUndo,
}: {
  messages: Messages["interview"];
  children: ReactNode;
  disabled: boolean;
  onUndo: () => void;
}) {
  const [visible, setVisible] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const bar = useObstructionHeight("bar");
  const [height, setHeight] = useState(0);
  // The last height measured while floating, so a taller flow layout cannot flip the decision back and forth.
  const [floatHeight, setFloatHeight] = useState<number | null>(null);
  const [viewport, setViewport] = useState(() => (typeof window === "undefined" ? 0 : window.innerHeight));
  const floats = toastFloats(bar ?? 0, floatHeight ?? height, viewport);

  useEffect(() => {
    const onResize = () => setViewport(window.innerHeight);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useLayoutEffect(() => {
    if (!box) return;
    const measure = () => setHeight(box.getBoundingClientRect().height);
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(box, { box: "border-box" });
    return () => observer?.disconnect();
  }, [box]);

  if (floats && height > 0 && floatHeight !== height) setFloatHeight(height);

  const hasBar = bar !== null && bar > 0;
  useEffect(() => {
    if (!box) return;
    // Floating: height plus the gap. In flow: nothing while the bar is registered, else the height (9.11).
    if (floats) setObstruction("toast", height + TOAST_GAP);
    else if (!hasBar) setObstruction("toast", height);
    else setObstruction("toast", null);
    return () => setObstruction("toast", null);
  }, [box, floats, hasBar, height]);

  useEffect(() => {
    if (!visible || paused) return;
    const timer = setTimeout(() => setVisible(false), TOAST_MS);
    return () => clearTimeout(timer);
  }, [visible, paused]);

  if (!visible) return null;
  return (
    <div
      ref={setBox}
      data-undo-toast
      data-toast-placement={floats ? "float" : "flow"}
      style={floats ? { insetBlockEnd: `${(bar ?? 0) + TOAST_GAP}px` } : undefined}
      className={`flex flex-wrap items-center justify-between gap-3 rounded-sheet bg-foreground px-4 py-3 text-background${floats ? " fixed inset-x-4 z-40 mx-auto w-auto max-w-xl" : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <span>{children}</span>
      <button
        type="button"
        className={`min-h-11 min-w-11 rounded-md border border-current px-4 py-2 text-base font-medium aria-disabled:opacity-60 ${focusRingOnToast}`}
        aria-disabled={disabled}
        onClick={() => {
          if (!disabled) onUndo();
        }}
      >
        {messages.undoAction}
      </button>
    </div>
  );
}

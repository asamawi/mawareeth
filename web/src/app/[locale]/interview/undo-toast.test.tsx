import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { messages } from "@/i18n/messages";
import { installDom, teardownDom } from "@/test/dom";

import { isUndoShortcut, TOAST_MS, UndoButton, UndoToast } from "./undo-toast";

const text = messages.en.interview;

async function mount(disabled = false) {
  const dom = installDom("https://localhost/en/interview/");
  mock.timers.enable({ apis: ["setTimeout"] });
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  let presses = 0;
  const key = { current: 1 };
  async function render() {
    await act(async () => {
      root.render(
        <>
          <UndoButton messages={text} disabled={disabled} onUndo={() => { presses += 1; }} />
          <UndoToast key={key.current} messages={text} disabled={disabled} onUndo={() => { presses += 1; }}>
            Son added.
          </UndoToast>
        </>,
      );
    });
  }
  await render();
  return {
    node, render, key,
    presses: () => presses,
    toast: () => node.querySelector<HTMLElement>("[data-undo-toast]"),
    async tick(ms: number) { await act(async () => { mock.timers.tick(ms); }); },
    async close() {
      await act(async () => root.unmount());
      mock.timers.reset();
      await teardownDom(dom);
    },
  };
}

test("the toast shows the change and an Undo button, is not a live region and never takes focus", async () => {
  const ui = await mount();
  try {
    const toast = ui.toast()!;
    assert.match(toast.textContent ?? "", /Son added\./);
    assert.equal(toast.querySelector("button")?.textContent, "Undo");
    assert.equal(toast.closest("[role],[aria-live]"), null);
    assert.equal(toast.querySelector("[role],[aria-live]"), null);
    assert.notEqual(document.activeElement, toast.querySelector("button"));
    assert.match(toast.className, /bg-foreground/);
    assert.match(toast.querySelector("button")!.className, /outline-toast-focus/);
  } finally { await ui.close(); }
});

test("the toast lasts the full 10 seconds, pauses on hover and restarts in full", async () => {
  const ui = await mount();
  try {
    await ui.tick(TOAST_MS - 1);
    assert.ok(ui.toast());
    await ui.tick(1);
    assert.equal(ui.toast(), null);
  } finally { await ui.close(); }
  const paused = await mount();
  try {
    await paused.tick(5000);
    await act(async () => { paused.toast()!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
    await act(async () => { paused.toast()!.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })); });
    // React maps mouseenter/leave from over/out; if the pointer is still inside nothing restarts.
    await paused.tick(TOAST_MS - 1);
    assert.ok(paused.toast(), "a restarted timer needs the full 10 s again");
    await paused.tick(1);
    assert.equal(paused.toast(), null);
  } finally { await paused.close(); }
});

test("focus inside the toast pauses the countdown", async () => {
  const ui = await mount();
  try {
    await ui.tick(4000);
    const button = ui.toast()!.querySelector("button")!;
    await act(async () => { button.focus(); });
    await ui.tick(60_000);
    assert.ok(ui.toast());
    await act(async () => { button.blur(); });
    await ui.tick(TOAST_MS - 1);
    assert.ok(ui.toast());
    await ui.tick(1);
    assert.equal(ui.toast(), null);
  } finally { await ui.close(); }
});

test("a new change replaces the toast with a fresh 10 seconds", async () => {
  const ui = await mount();
  try {
    await ui.tick(9000);
    ui.key.current = 2;
    await ui.render();
    await ui.tick(9000);
    assert.ok(ui.toast());
    await ui.tick(1000);
    assert.equal(ui.toast(), null);
  } finally { await ui.close(); }
});

test("Undo presses count, and a disabled control is aria-disabled and does nothing", async () => {
  const ui = await mount();
  try {
    for (const button of ui.node.querySelectorAll("button")) {
      await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    }
    assert.equal(ui.presses(), 2);
  } finally { await ui.close(); }
  const off = await mount(true);
  try {
    for (const button of off.node.querySelectorAll("button")) {
      assert.equal(button.getAttribute("aria-disabled"), "true");
      assert.equal(button.hasAttribute("disabled"), false);
      await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    }
    assert.equal(off.presses(), 0);
  } finally { await off.close(); }
});

test("isUndoShortcut accepts Ctrl/Cmd+Z by character, or by the physical key on a non-Latin layout", () => {
  const base = { key: "z", code: "KeyZ", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false };
  assert.equal(isUndoShortcut(base), true);
  assert.equal(isUndoShortcut({ ...base, key: "Z" }), true);
  assert.equal(isUndoShortcut({ ...base, ctrlKey: false, metaKey: true }), true);
  assert.equal(isUndoShortcut({ ...base, key: "ئ" }), true);
  assert.equal(isUndoShortcut({ ...base, key: "w" }), false, "AZERTY: the physical Z key types w");
  assert.equal(isUndoShortcut({ ...base, shiftKey: true }), false);
  assert.equal(isUndoShortcut({ ...base, altKey: true }), false);
  assert.equal(isUndoShortcut({ ...base, ctrlKey: false }), false);
});

test("the toast floats above a bar that leaves room, and stays in flow otherwise; Undo works in both", async () => {
  const { setObstruction } = await import("@/interview/obstruction");
  const ui = await mount();
  const w = window as unknown as { innerHeight: number };
  const originalHeight = w.innerHeight;
  try {
    assert.equal(ui.toast()!.getAttribute("data-toast-placement"), "flow", "no bar: in flow");
    // happy-dom measures 0 for the toast; a bar of 60 plus gap 8 fits in 25% of a 1000px viewport.
    w.innerHeight = 1000;
    await act(async () => { setObstruction("bar", 60); window.dispatchEvent(new Event("resize")); });
    assert.equal(ui.toast()!.getAttribute("data-toast-placement"), "float");
    await act(async () => { ui.toast()!.querySelector("button")!.click(); });
    assert.equal(ui.presses(), 1);
    w.innerHeight = 200;
    await act(async () => { window.dispatchEvent(new Event("resize")); });
    assert.equal(ui.toast()!.getAttribute("data-toast-placement"), "flow", "too tall: in flow");
    await act(async () => { ui.toast()!.querySelector("button")!.click(); });
    assert.equal(ui.presses(), 2);
  } finally {
    w.innerHeight = originalHeight;
    setObstruction("bar", null);
    await ui.close();
  }
});

test("a floating toast reflects aria-disabled, ignores Undo and still pauses on hover", async () => {
  const { setObstruction } = await import("@/interview/obstruction");
  const ui = await mount(true);
  const w = window as unknown as { innerHeight: number };
  const originalHeight = w.innerHeight;
  try {
    w.innerHeight = 1000;
    await act(async () => { setObstruction("bar", 60); window.dispatchEvent(new Event("resize")); });
    assert.equal(ui.toast()!.getAttribute("data-toast-placement"), "float");
    const button = ui.toast()!.querySelector("button")!;
    assert.equal(button.getAttribute("aria-disabled"), "true");
    await act(async () => { button.click(); });
    assert.equal(ui.presses(), 0);
    await ui.tick(5000);
    await act(async () => { ui.toast()!.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); });
    await ui.tick(TOAST_MS * 2);
    assert.ok(ui.toast(), "hover keeps the floating toast past the timer");
  } finally {
    w.innerHeight = originalHeight;
    setObstruction("bar", null);
    await ui.close();
  }
});

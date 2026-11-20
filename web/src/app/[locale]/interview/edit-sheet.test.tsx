import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import type { Case } from "@/api/case";
import { messages } from "@/i18n/messages";
import type { StartedView } from "@/interview/flow";
import { estateModel } from "@/interview/tree";
import { installDom, teardownDom } from "@/test/dom";

import { EditSheet } from "./edit-sheet";

const NONE = { blocked: [], invalid: {} };
const KASE: Case = {
  id: "c1", revision: 4, started_at: "2026-11-19T10:00:00Z", madhab: null,
  deceased: { gender: "male", estate: "100", name: null } as Case["deceased"],
  heirs: [
    { id: "h1", relationship: "son", gender: "male", name: "Ali", edit_options: NONE },
    { id: "h2", relationship: "daughter", gender: "female", name: null, edit_options: NONE },
  ],
  heir_options: NONE, deaths: [],
};

function viewOf(extra: Partial<StartedView> = {}, layer: string | null = null): StartedView {
  return {
    name: "started", case: KASE, resumed: false, changing: false, editingDeceased: false,
    editingHeir: "h1", layer, ordering: null, formEpoch: 0, notice: null, errors: null,
    focus: null, announcement: null, saving: false, ...extra,
  };
}

async function mount(opts: { phone?: boolean; frozen?: boolean; view?: StartedView; alert?: string } = {}) {
  const dom = installDom("https://localhost/en/interview/");
  const win = window as unknown as { matchMedia: unknown };
  win.matchMedia = () => ({ matches: !!opts.phone, addEventListener() {}, removeEventListener() {} });
  const shown: string[] = [];
  const proto = (dom.HTMLDialogElement as unknown as { prototype: object }).prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal = function (this: HTMLDialogElement) { shown.push("modal"); this.setAttribute("open", ""); };
  proto.close = function (this: HTMLDialogElement) { this.removeAttribute("open"); };
  const view = opts.view ?? viewOf();
  const person = estateModel(view.case, view.layer, null).people.find(p => p.id === view.editingHeir)!;
  const saves: unknown[] = [];
  const removes: boolean[] = [];
  const added: string[] = [];
  let closed = 0;
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  await act(async () => {
    root.render(<EditSheet messages={messages.en.interview} view={view} person={person} label="Son Ali"
      frozen={opts.frozen ?? false} onClose={() => { closed += 1; }}
      onSave={(fields, focus) => saves.push({ fields, focus })} onRemove={c => removes.push(c)}
      entries={[{ relationship: "son_of_son", link: "child", blocked: false, gender: "male" }]} atLimit={false}
      addAlert={opts.alert ?? null} onAddHere={entry => added.push(entry.relationship)} />);
  });
  return {
    dom, node, shown, saves, removes, added, closed: () => closed,
    async stop() { await act(async () => root.unmount()); await teardownDom(dom); },
  };
}

test("a wide viewport renders a non-modal panel with name, relationship, status and Remove", async () => {
  const t = await mount();
  try {
    assert.equal(t.node.querySelector("dialog"), null);
    const panel = t.node.querySelector("section")!;
    assert.equal(panel.querySelector("h3")?.textContent, messages.en.interview.heirEditHeading);
    const name = t.node.querySelector<HTMLInputElement>("#edit-name")!;
    assert.equal(name.value, "Ali");
    assert.equal(document.activeElement, name);
    assert.ok(panel.querySelector('input[name="relationship"]'));
    const radios = [...panel.querySelectorAll<HTMLInputElement>('input[name="edit-status"]')];
    assert.equal(radios.length, 2);
    assert.equal(radios[0].checked, true);
    assert.ok(panel.textContent?.includes(messages.en.interview.statusDiedBefore));
    assert.ok(panel.textContent?.includes(messages.en.interview.editClose));
    assert.ok([...panel.querySelectorAll("button")].some(b => b.textContent === "Remove Son Ali"));
    assert.equal(t.shown.length, 0);
  } finally { await t.stop(); }
});

test("Escape and Close ask to close; a changed name saves once on blur and an unchanged one does not", async () => {
  const t = await mount();
  try {
    const panel = t.node.querySelector("section")!;
    const dom = t.dom;
    await act(async () => { panel.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }) as unknown as Event); });
    assert.equal(t.closed(), 1);
    const close = [...panel.querySelectorAll("button")].find(b => b.textContent === messages.en.interview.editClose)!;
    await act(async () => close.click());
    assert.equal(t.closed(), 2);
    const name = t.node.querySelector<HTMLInputElement>("#edit-name")!;
    await act(async () => { name.dispatchEvent(new dom.FocusEvent("focusout", { bubbles: true }) as unknown as Event); });
    assert.equal(t.saves.length, 0);
  } finally { await t.stop(); }
});

test("a phone viewport renders a modal dialog", async () => {
  const t = await mount({ phone: true });
  try {
    const dialog = t.node.querySelector("dialog")!;
    assert.ok(dialog);
    assert.equal(t.shown[0], "modal");
    assert.ok(dialog.hasAttribute("open"));
    assert.equal(t.node.querySelector("section"), null);
  } finally { await t.stop(); }
});

test("status radios are hidden outside the first estate", async () => {
  const kase: Case = { ...KASE, deaths: [{ heir_id: "h2", order: 1, placement: {}, heirs: [
    { id: "l1", relationship: "son", gender: "male", name: null, edit_options: NONE }] } as unknown as Case["deaths"][number]] };
  const view = viewOf({ case: kase, layer: "h2" });
  const t = await mount({ view: { ...view, editingHeir: "l1" } });
  try {
    assert.equal(t.node.querySelector('input[name="edit-status"]'), null);
  } finally { await t.stop(); }
});

test("the confirmation lists the impact, Keep is focused and Yes asks to confirm", async () => {
  const view = viewOf({ confirming: { heirId: "h1", impact: { persons: ["h2"], estates: [] }, fromRow: false } });
  const t = await mount({ view });
  try {
    assert.equal(t.node.querySelector("h3")?.textContent, "Remove Son Ali?");
    assert.ok(t.node.textContent?.includes(messages.en.interview.removeImpactIntro));
    assert.equal(t.node.querySelectorAll("li").length, 1);
    assert.equal(document.activeElement?.textContent, messages.en.interview.heirRemoveNo);
    assert.equal(t.node.querySelector("#edit-name"), null);
    const yes = [...t.node.querySelectorAll("button")].find(b => b.textContent === messages.en.interview.heirRemoveYes)!;
    await act(async () => yes.click());
    assert.deepEqual(t.removes, [true]);
  } finally { await t.stop(); }
});

test("a frozen surface is aria-disabled, never natively disabled, and sends nothing", async () => {
  const t = await mount({ frozen: true });
  try {
    assert.equal(t.node.querySelectorAll(":disabled").length, 0);
    const name = t.node.querySelector<HTMLInputElement>("#edit-name")!;
    assert.equal(name.readOnly, true);
    const close = [...t.node.querySelectorAll("button")].find(b => b.textContent === messages.en.interview.editClose)!;
    assert.equal(close.getAttribute("aria-disabled"), "true");
    await act(async () => close.click());
    assert.equal(t.closed(), 0);
    const remove = [...t.node.querySelectorAll("button")].find(b => b.textContent === "Remove Son Ali")!;
    await act(async () => remove.click());
    assert.equal(t.removes.length, 0);
  } finally { await t.stop(); }
});

test("clicking Died before the deceased saves the status with the current name and relationship", async () => {
  const t = await mount();
  try {
    const radio = t.node.querySelectorAll<HTMLInputElement>('input[name="edit-status"]')[1];
    await act(async () => radio.click());
    assert.deepEqual(t.saves, [{
      fields: { relationship: "son", name: "Ali", status: "died_before_or_with" },
      focus: "editStatus:died_before_or_with",
    }]);
  } finally { await t.stop(); }
});

test("a changed name saves on a Tab inside the sheet, but not when a press inside the sheet moves focus", async () => {
  const t = await mount();
  try {
    const name = t.node.querySelector<HTMLInputElement>("#edit-name")!;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(name), "value")!.set!;
    await act(async () => {
      name.focus();
      setter.call(name, "Omar");
      for (const type of ["input", "keyup", "change"]) name.dispatchEvent(new t.dom.Event(type, { bubbles: true }) as unknown as Event);
    });
    const inside = t.node.querySelector<HTMLInputElement>('input[name="edit-status"]')!;
    await act(async () => { inside.dispatchEvent(new t.dom.Event("pointerdown", { bubbles: true }) as unknown as Event); });
    await act(async () => { name.dispatchEvent(new t.dom.FocusEvent("focusout", { bubbles: true, relatedTarget: inside as never }) as unknown as Event); });
    assert.equal(t.saves.length, 0);
    await act(async () => { inside.dispatchEvent(new t.dom.Event("pointercancel", { bubbles: true }) as unknown as Event); });
    await act(async () => { name.dispatchEvent(new t.dom.FocusEvent("focusout", { bubbles: true, relatedTarget: inside as never }) as unknown as Event); });
    assert.deepEqual(t.saves, [{ fields: { relationship: "son", name: "Omar" }, focus: "name" }]);
  } finally { await t.stop(); }
});

test("a changed name saves exactly once on blur to outside the sheet, and not when a press keeps focus inside", async () => {
  const t = await mount();
  try {
    const name = t.node.querySelector<HTMLInputElement>("#edit-name")!;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(name), "value")!.set!;
    await act(async () => {
      name.focus();
      setter.call(name, " Omar ");
      for (const type of ["input", "keyup", "change"]) name.dispatchEvent(new t.dom.Event(type, { bubbles: true }) as unknown as Event);
    });
    const inside = t.node.querySelector<HTMLInputElement>('input[name="edit-status"]')!;
    await act(async () => { inside.dispatchEvent(new t.dom.Event("pointerdown", { bubbles: true }) as unknown as Event); });
    await act(async () => { name.dispatchEvent(new t.dom.FocusEvent("focusout", { bubbles: true, relatedTarget: inside as never }) as unknown as Event); });
    assert.equal(t.saves.length, 0);
    await act(async () => { inside.dispatchEvent(new t.dom.Event("pointercancel", { bubbles: true }) as unknown as Event); });
    await act(async () => { name.dispatchEvent(new t.dom.FocusEvent("focusout", { bubbles: true, relatedTarget: null }) as unknown as Event); });
    assert.deepEqual(t.saves, [{ fields: { relationship: "son", name: "Omar" }, focus: "name" }]);
  } finally { await t.stop(); }
});

for (const phone of [false, true]) test(`the edit sheet offers Add relative here for the edited person (${phone ? "phone" : "wide"})`, async () => {
  const ui = await mount({ phone, alert: "Refused here" });
  try {
    const toggle = ui.node.querySelector<HTMLButtonElement>('[data-focus="addHere"]')!;
    assert.equal(toggle.textContent, messages.en.interview.addRelativeHere);
    assert.equal(ui.node.querySelector('[role="alert"]')?.textContent, "Refused here");
    await act(async () => toggle.click());
    await act(async () => ui.node.querySelector<HTMLButtonElement>('[data-focus="addHere:son_of_son"]')!.click());
    assert.deepEqual(ui.added, ["son_of_son"]);
  } finally { await ui.stop(); }
});

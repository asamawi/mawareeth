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
  const addedNames: (string | null | undefined)[] = [];
  const later: (string | null | undefined)[] = [];
  let closed = 0;
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  const draw = async (v: StartedView) => {
    const who = estateModel(v.case, v.layer, null).people.find(p => p.id === v.editingHeir)!;
    await act(async () => {
      root.render(<EditSheet messages={messages.en.interview} view={v} person={who} label="Son Ali"
        frozen={opts.frozen ?? false} onClose={() => { closed += 1; }}
        onSave={(fields, focus) => saves.push({ fields, focus })} onRemove={c => removes.push(c)}
        entries={[{ relationship: "son_of_son", link: "child", blocked: false, gender: "male" }]} atLimit={false}
        addAlert={opts.alert ?? null} onAddHere={(entry, name) => { added.push(entry.relationship); addedNames.push(name); }}
        onMarkLater={() => later.push("mark")} onOpenEstate={name => later.push(name === undefined ? "open" : `open:${name}`)}
        orderQuestion={opts.alert === "order" ? () => <p id="order-stub">order</p> : null} />);
    });
  };
  void person;
  await draw(view);
  return {
    draw, dom, node, shown, saves, removes, added, addedNames, later, closed: () => closed,
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
    assert.equal(radios.length, 3);
    assert.equal(radios[0].checked, true);
    assert.ok(panel.textContent?.includes(messages.en.interview.statusDiedLater));
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

test("outside the first estate the died-before radio is hidden but the later-death radio stays", async () => {
  const kase: Case = { ...KASE, deaths: [{ heir_id: "h2", order: 2, placement: {}, heirs: [
    { id: "l1", relationship: "son", gender: "male", name: null, edit_options: NONE }] } as unknown as Case["deaths"][number]] };
  const view = viewOf({ case: kase, layer: "h2" });
  const t = await mount({ view: { ...view, editingHeir: "l1" } });
  try {
    const radios = [...t.node.querySelectorAll<HTMLInputElement>('input[name="edit-status"]')];
    assert.deepEqual(radios.map(r => r.value), ["alive", "died_later"]);
  } finally { await t.stop(); }
});

test("choosing the later-death radio asks to mark the death", async () => {
  const t = await mount();
  try {
    const radio = t.node.querySelector<HTMLInputElement>('input[value="died_later"]')!;
    await act(async () => radio.click());
    assert.deepEqual(t.later, ["mark"]);
  } finally { await t.stop(); }
});

test("with two later deaths the radio is replaced by the limit text", async () => {
  const dead = (id: string, order: number) => ({ heir_id: id, order, placement: {}, heirs: [] }) as unknown as Case["deaths"][number];
  const kase: Case = { ...KASE, heirs: [...KASE.heirs, { id: "h3", relationship: "son", gender: "male", name: null, edit_options: NONE }],
    deaths: [dead("h2", 2), dead("h3", 3)] };
  const t = await mount({ view: viewOf({ case: kase }) });
  try {
    assert.equal(t.node.querySelector('input[value="died_later"]'), null);
    assert.ok(t.node.textContent?.includes(messages.en.interview.laterDeathLimit));
  } finally { await t.stop(); }
});

test("a died-later person shows the Open own estate button, not the status group", async () => {
  const kase: Case = { ...KASE, deaths: [{ heir_id: "h1", order: 2, placement: {}, heirs: [] } as unknown as Case["deaths"][number]] };
  const t = await mount({ view: viewOf({ case: kase }) });
  try {
    assert.equal(t.node.querySelector('input[name="edit-status"]'), null);
    const button = t.node.querySelector<HTMLButtonElement>('[data-focus="openEstate"]')!;
    assert.ok(button.textContent?.startsWith("Open own estate"));
    await act(async () => button.click());
    assert.deepEqual(t.later, ["open"]);
  } finally { await t.stop(); }
});

test("an order question is shown inside the sheet", async () => {
  const t = await mount({ alert: "order" });
  try {
    assert.ok(t.node.querySelector("#order-stub"));
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
    assert.equal(ui.node.querySelector('[role="alert"]:not(#heir-relationship-error)')?.textContent, "Refused here");
    await act(async () => toggle.click());
    await act(async () => ui.node.querySelector<HTMLButtonElement>('[data-focus="addHere:son_of_son"]')!.click());
    assert.deepEqual(ui.added, ["son_of_son"]);
  } finally { await ui.stop(); }
});

test("Add relative here carries an uncommitted name so it is saved before the sheet closes", async () => {
  const t = await mount();
  try {
    const name = t.node.querySelector<HTMLInputElement>("#edit-name")!;
    await act(async () => {
      name.focus();
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(name), "value")!.set!.call(name, "Omar");
      for (const type of ["input", "keyup", "change"]) name.dispatchEvent(new t.dom.Event(type, { bubbles: true }) as unknown as Event);
    });
    await act(async () => t.node.querySelector<HTMLButtonElement>('[data-focus="addHere"]')!.click());
    await act(async () => t.node.querySelector<HTMLButtonElement>('[data-focus="addHere:son_of_son"]')!.click());
    assert.deepEqual(t.added, ["son_of_son"]);
    assert.deepEqual(t.addedNames, ["Omar"], "the dirty name is passed so the caller saves it first");
  } finally { await t.stop(); }
});

function withInvalid(invalid: Record<string, string>, deceasedGender: "male" | "female" = "male"): StartedView {
  const kase: Case = {
    ...KASE, deceased: { ...KASE.deceased, gender: deceasedGender } as Case["deceased"],
    heirs: [{ ...KASE.heirs[0], edit_options: { blocked: [], invalid } } as Case["heirs"][number], KASE.heirs[1]],
  };
  return viewOf({ case: kase });
}
const relationshipErrors = messages.en.interview.fieldErrors.relationship;
const slot = (node: Element) => node.querySelector("#heir-relationship-error")?.textContent ?? "";
const radio = (node: Element, id: string) => node.querySelector<HTMLInputElement>(`input[name="relationship"][value="${id}"]`)!;

async function pickSelect(t: Awaited<ReturnType<typeof mount>>, value: string) {
  await act(async () => t.node.querySelector<HTMLButtonElement>('button[aria-controls="heir-relationship-more"]')!.click());
  const select = t.node.querySelector<HTMLSelectElement>("#heir-relationship-rare")!;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), "value")!.set!;
  await act(async () => {
    setter.call(select, value);
    select.dispatchEvent(new t.dom.Event("change", { bubbles: true }) as unknown as Event);
  });
  return select;
}

test("a valid relationship pick saves at once with no local message", async () => {
  const t = await mount({ view: withInvalid({ husband: "husband_of_male" }) });
  try {
    await act(async () => radio(t.node, "daughter").click());
    assert.deepEqual(t.saves, [{ fields: { relationship: "daughter", name: "Ali" }, focus: "editRelationship:daughter" }]);
    assert.equal(slot(t.node), "");
  } finally { await t.stop(); }
});

test("a gender-locked pick is explained, not saved, and the saved relationship stays checked", async () => {
  const t = await mount({ view: withInvalid({ daughter: "gender_locked" }) });
  try {
    await act(async () => radio(t.node, "daughter").click());
    assert.equal(t.saves.length, 0);
    assert.equal(slot(t.node), relationshipErrors.gender_locked);
    assert.equal(radio(t.node, "son").checked, true);
    assert.equal(radio(t.node, "daughter").checked, false);
  } finally { await t.stop(); }
});

test("a kinship-invalid pick from the more select is explained, not saved, and the select reverts", async () => {
  const t = await mount({ view: withInvalid({ husband: "husband_of_male" }) });
  try {
    const select = await pickSelect(t, "husband");
    assert.equal(t.saves.length, 0);
    assert.equal(slot(t.node), relationshipErrors.husband_of_male);
    assert.equal(select.value, "");
    assert.equal(radio(t.node, "son").checked, true);
  } finally { await t.stop(); }
});

test("a valid pick after an invalid one clears the message and saves", async () => {
  const t = await mount({ view: withInvalid({ daughter: "gender_locked" }) });
  try {
    await act(async () => radio(t.node, "daughter").click());
    assert.equal(slot(t.node), relationshipErrors.gender_locked);
    await act(async () => radio(t.node, "father").click());
    assert.equal(slot(t.node), "");
    assert.deepEqual(t.saves, [{ fields: { relationship: "father", name: "Ali" }, focus: "editRelationship:father" }]);
  } finally { await t.stop(); }
});

test("a server relationship error still shows when no local issue is pending", async () => {
  const t = await mount({ view: { ...withInvalid({}), errors: { relationship: "second_father" } } });
  try {
    assert.equal(slot(t.node), relationshipErrors.second_father);
  } finally { await t.stop(); }
});

test("a frozen sheet neither saves nor explains an invalid pick", async () => {
  const t = await mount({ frozen: true, view: withInvalid({ daughter: "gender_locked" }) });
  try {
    await act(async () => radio(t.node, "daughter").click());
    assert.equal(t.saves.length, 0);
    assert.equal(slot(t.node), "");
  } finally { await t.stop(); }
});

test("a replaced view.case for the same row clears the local message", async () => {
  const view = withInvalid({ daughter: "gender_locked" });
  const t = await mount({ view });
  try {
    await act(async () => radio(t.node, "daughter").click());
    assert.equal(slot(t.node), relationshipErrors.gender_locked);
    await t.draw({ ...view, case: { ...view.case } });
    assert.equal(slot(t.node), "");
  } finally { await t.stop(); }
});

test("a refused pick from a saved rare relationship leaves the select on that value", async () => {
  const kase: Case = { ...KASE, heirs: [
    { ...KASE.heirs[0], relationship: "brother", edit_options: { blocked: [], invalid: { husband: "husband_of_male" } } } as Case["heirs"][number],
    KASE.heirs[1]] };
  const t = await mount({ view: viewOf({ case: kase }) });
  try {
    const select = t.node.querySelector<HTMLSelectElement>("#heir-relationship-rare")!;
    assert.equal(select.value, "brother");
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), "value")!.set!;
    await act(async () => {
      setter.call(select, "husband");
      select.dispatchEvent(new t.dom.Event("change", { bubbles: true }) as unknown as Event);
    });
    assert.equal(t.saves.length, 0);
    assert.equal(slot(t.node), relationshipErrors.husband_of_male);
    assert.equal(select.value, "brother");
  } finally { await t.stop(); }
});

test("a blocked but not invalid relationship still saves", async () => {
  const kase: Case = { ...KASE, heirs: [
    { ...KASE.heirs[0], edit_options: { blocked: ["daughter"], invalid: {} } } as Case["heirs"][number], KASE.heirs[1]] };
  const t = await mount({ view: viewOf({ case: kase }) });
  try {
    await act(async () => radio(t.node, "daughter").click());
    assert.equal(t.saves.length, 1);
    assert.equal(slot(t.node), "");
  } finally { await t.stop(); }
});

test("a later-estate row is refused by its own options, not the root row's", async () => {
  const kase: Case = { ...KASE, deaths: [{ heir_id: "h2", order: 1, placement: {}, heirs: [
    { id: "l1", relationship: "son", gender: "male", name: null,
      edit_options: { blocked: [], invalid: { daughter: "gender_locked" } } }] } as unknown as Case["deaths"][number]] };
  const view = { ...viewOf({ case: kase, layer: "h2" }), editingHeir: "l1" };
  const t = await mount({ view });
  try {
    await act(async () => radio(t.node, "daughter").click());
    assert.equal(t.saves.length, 0);
    assert.equal(slot(t.node), relationshipErrors.gender_locked);
  } finally { await t.stop(); }
});

test("a status save or the placeholder pick clears the local message", async () => {
  const t = await mount({ view: withInvalid({ daughter: "gender_locked", husband: "husband_of_male" }) });
  try {
    await act(async () => radio(t.node, "daughter").click());
    assert.equal(slot(t.node), relationshipErrors.gender_locked);
    await act(async () => t.node.querySelectorAll<HTMLInputElement>('input[name="edit-status"]')[1].click());
    assert.equal(t.saves.length, 1);
    assert.equal(slot(t.node), "");
    const select = await pickSelect(t, "husband");
    assert.equal(slot(t.node), relationshipErrors.husband_of_male);
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), "value")!.set!;
    await act(async () => {
      setter.call(select, "");
      select.dispatchEvent(new t.dom.Event("change", { bubbles: true }) as unknown as Event);
    });
    assert.equal(slot(t.node), "");
  } finally { await t.stop(); }
});

test("the sheet's relationship slot is a live region, empty until a refusal, with focus left in place", async () => {
  const t = await mount({ view: withInvalid({ daughter: "gender_locked" }) });
  try {
    const el = t.node.querySelector("#heir-relationship-error")!;
    assert.equal(el.getAttribute("role"), "alert");
    assert.equal(el.textContent, "");
    const daughter = radio(t.node, "daughter");
    daughter.focus();
    await act(async () => daughter.click());
    assert.equal(el.isConnected, true);
    assert.equal(t.node.querySelector("#heir-relationship-error"), el);
    assert.equal(el.getAttribute("role"), "alert");
    assert.equal(el.textContent, relationshipErrors.gender_locked);
    assert.equal(document.activeElement, daughter);
  } finally { await t.stop(); }
});

test("a repeated identical refusal replaces the text node so it is announced again", async () => {
  const t = await mount({ view: withInvalid({ daughter: "gender_locked" }) });
  try {
    const el = t.node.querySelector("#heir-relationship-error")!;
    await act(async () => radio(t.node, "daughter").click());
    const first = el.querySelector("span")!;
    assert.ok(first);
    await act(async () => radio(t.node, "daughter").click());
    const second = el.querySelector("span")!;
    assert.equal(second.textContent, relationshipErrors.gender_locked);
    assert.notEqual(second, first);
    assert.equal(first.isConnected, false);
    assert.equal(el.isConnected, true);
    assert.equal(t.node.querySelector("#heir-relationship-error"), el);
  } finally { await t.stop(); }
});

test("a repeated identical refusal through the more select is announced again", async () => {
  const t = await mount({ view: withInvalid({ husband: "husband_of_male" }) });
  try {
    const select = await pickSelect(t, "husband");
    const first = t.node.querySelector("#heir-relationship-error span")!;
    assert.equal(first.textContent, relationshipErrors.husband_of_male);
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), "value")!.set!;
    await act(async () => {
      setter.call(select, "husband");
      select.dispatchEvent(new t.dom.Event("change", { bubbles: true }) as unknown as Event);
    });
    const second = t.node.querySelector("#heir-relationship-error span")!;
    assert.equal(second.textContent, relationshipErrors.husband_of_male);
    assert.notEqual(second, first);
    assert.equal(first.isConnected, false);
  } finally { await t.stop(); }
});

test("a server relationship error arriving in the mounted empty alert shows there", async () => {
  const view = withInvalid({});
  const t = await mount({ view });
  try {
    const el = t.node.querySelector("#heir-relationship-error")!;
    assert.equal(el.textContent, "");
    await t.draw({ ...view, errors: { relationship: "second_father" } });
    assert.equal(t.node.querySelector("#heir-relationship-error"), el);
    assert.equal(el.getAttribute("role"), "alert");
    assert.equal(el.textContent, relationshipErrors.second_father);
  } finally { await t.stop(); }
});

test("Open own estate passes an uncommitted name so it is saved first", async () => {
  const kase: Case = { ...KASE, deaths: [{ heir_id: "h1", order: 2, placement: {}, heirs: [] } as unknown as Case["deaths"][number]] };
  const t = await mount({ view: viewOf({ case: kase }) });
  try {
    const name = t.node.querySelector<HTMLInputElement>("#edit-name")!;
    await act(async () => {
      name.focus();
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(name), "value")!.set!.call(name, "Newer");
      for (const type of ["input", "keyup", "change"]) name.dispatchEvent(new t.dom.Event(type, { bubbles: true }) as unknown as Event);
    });
    await act(async () => t.node.querySelector<HTMLButtonElement>('[data-focus="openEstate"]')!.click());
    assert.deepEqual(t.later, ["open:Newer"]);
  } finally { await t.stop(); }
});

const LATER: Case = {
  ...KASE,
  heirs: [
    { id: "w", relationship: "wife", gender: "female", name: "Amal", edit_options: NONE },
    { id: "s1", relationship: "son", gender: "male", name: "Sami", edit_options: NONE },
    { id: "s2", relationship: "son", gender: "male", name: "عمر", edit_options: NONE },
  ],
  deaths: [{
    heir_id: "s1", order: 2, gender: "male", heir_options: NONE,
    heirs: [
      { id: "r1", relationship: "mother", gender: "female", name: null, edit_options: NONE, link_candidates: ["w"] },
      { id: "r2", relationship: "brother", gender: "male", name: "عمر", same_as: "s2", edit_options: NONE, link_candidates: ["s2"] },
      { id: "r3", relationship: "sister", gender: "female", name: null, edit_options: NONE, link_candidates: [] },
    ],
  }],
};
const laterView = (editingHeir: string, extra: Partial<StartedView> = {}) => viewOf({ case: LATER, editingHeir, ...extra }, "s1");
const sameAs = (node: Element) => node.querySelector<HTMLSelectElement>("#edit-same-as");

test("the Same person as field follows the relationship field with Nobody else plus the server candidates", async () => {
  for (const phone of [false, true]) {
    const t = await mount({ phone, view: laterView("r1") });
    try {
      const select = sameAs(t.node)!;
      assert.equal(t.node.querySelector('label[for="edit-same-as"]')!.textContent, messages.en.interview.linkSameAsLabel);
      assert.deepEqual([...select.options].map(o => o.text), [messages.en.interview.linkNobody, "⁨Wife · Amal⁩"]);
      assert.equal(select.value, "");
      assert.ok(select.classList.contains("min-h-11"));
      const relationship = t.node.querySelector('fieldset [role="radiogroup"]')!.closest("fieldset")!;
      assert.ok(relationship.compareDocumentPosition(select) & 4, "after the relationship field");
    } finally { await t.stop(); }
  }
});

test("the field is absent without candidates and in the first estate", async () => {
  const none = await mount({ view: laterView("r3") });
  try { assert.equal(sameAs(none.node), null); } finally { await none.stop(); }
  const first = await mount();
  try { assert.equal(sameAs(first.node), null); } finally { await first.stop(); }
});

test("choosing a person saves same_as at once; Nobody else sends null; the linked row shows its target selected", async () => {
  const t = await mount({ view: laterView("r1") });
  try {
    const select = sameAs(t.node)!;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), "value")!.set!;
    await act(async () => { setter.call(select, "w"); select.dispatchEvent(new t.dom.Event("change", { bubbles: true }) as unknown as Event); });
    assert.deepEqual(t.saves, [{ fields: { relationship: "mother", name: null, same_as: "w" }, focus: "same_as" }]);
  } finally { await t.stop(); }
  const linked = await mount({ view: laterView("r2") });
  try {
    const select = sameAs(linked.node)!;
    assert.equal(select.value, "s2");
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(select), "value")!.set!;
    await act(async () => { setter.call(select, ""); select.dispatchEvent(new linked.dom.Event("change", { bubbles: true }) as unknown as Event); });
    assert.deepEqual(linked.saves.map(s => (s as { fields: unknown }).fields), [{ relationship: "brother", name: "عمر", same_as: null }]);
  } finally { await linked.stop(); }
});

test("a refused link shows its reason at the field", async () => {
  const t = await mount({ view: laterView("r1", { errors: { same_as: "not_alive" } }) });
  try {
    assert.equal(t.node.querySelector("#edit-same-as-error")!.textContent, messages.en.interview.fieldErrors.same_as.not_alive);
    assert.equal(sameAs(t.node)!.getAttribute("aria-invalid"), "true");
  } finally { await t.stop(); }
});

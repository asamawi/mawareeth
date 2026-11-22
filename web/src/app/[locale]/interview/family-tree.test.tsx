import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { messages } from "@/i18n/messages";
import { treeDescription, type EstateModel } from "@/interview/tree";
import { installDom, teardownDom } from "@/test/dom";
import { FamilyTree } from "./family-tree";

for (const locale of ["en", "ar"] as const) test(`cards, reading keys, badges and zoom in ${locale}`, async () => {
  const dom = installDom();
  const node = document.createElement("div"); document.body.append(node);
  const root = createRoot(node), notes: string[] = [];
  const model: EstateModel = { placement: {}, people: [
    { id: "a", personId: "a", relationship: "son", gender: "male", name: null, parentId: null, state: "died_before" },
    { id: "b", personId: "b", relationship: "wife", gender: "female", name: null, parentId: null, state: "died_later" },
    { id: "c", personId: "c", relationship: "brother", gender: "male", name: null, parentId: null, state: "blocked" },
  ] };
  try {
    await act(async () => { root.render(<div dir={locale === "ar" ? "rtl" : "ltr"} style={{ direction: locale === "ar" ? "rtl" : "ltr" }}><FamilyTree messages={messages[locale].interview} model={model} locale={locale} editingId={null} onAnnounce={n => notes.push(n)} /></div>); });
    const group = node.querySelector('[role="group"]')!;
    assert.equal(node.querySelector('[role="img"]'), null);
    assert.equal(document.getElementById(group.getAttribute("aria-labelledby")!)?.textContent, messages[locale].interview.treeHeading);
    const cards = [...group.querySelectorAll<HTMLButtonElement>("button")];
    assert.equal(cards.length, 4);
    assert.equal(cards.filter(b => b.tabIndex === 0).length, 1);
    const deceased = cards.find(b => b.dataset.node === "root")!;
    // Positioned cards glide over 300ms, motion-safe only; the pinned deceased never lags the scroll.
    for (const card of cards.filter(b => b.dataset.node !== "root")) assert.ok(card.className.includes("motion-safe:duration-300") && card.className.includes("motion-safe:transition-[inset-inline-start,top]"));
    assert.ok(!deceased.className.includes("transition"));
    // Nothing is current until a card is pressed; the deceased is only the tab stop.
    assert.equal(node.querySelectorAll('[aria-current="true"]').length, 0);
    assert.equal(deceased.tabIndex, 0);
    await act(async () => { cards[0].click(); });
    assert.equal(cards[0].getAttribute("aria-current"), "true");
    const key = async (value: string) => { await act(async () => { (document.activeElement ?? deceased).dispatchEvent(new dom.KeyboardEvent("keydown", { key: value, bubbles: true }) as unknown as Event); }); };
    await act(async () => deceased.focus());
    const at = () => (document.activeElement as HTMLElement).dataset.node;
    const next = locale === "ar" ? "ArrowLeft" : "ArrowRight", prev = locale === "ar" ? "ArrowRight" : "ArrowLeft";
    // The deceased has no siblings or parent: the inline arrows and Up leave focus alone.
    await key(next); assert.equal(at(), "root");
    await key("ArrowUp"); assert.equal(at(), "root");
    await key("ArrowDown"); assert.equal(at(), "b");
    await key(next); assert.equal(at(), "c");
    await key(next); assert.equal(at(), "a");
    await key(next); assert.equal(at(), "a");
    await key(prev); assert.equal(at(), "c");
    await key("ArrowDown"); assert.equal(at(), "c", "a leaf has no child");
    await key("ArrowUp"); assert.equal(at(), "root");
    await key("End"); assert.equal(at(), "a");
    await key("Home"); assert.equal(document.activeElement, deceased);
    // Alt+Arrow keeps its browser meaning: focus stays and the event is not cancelled.
    const alt = new dom.KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true, cancelable: true }) as unknown as Event;
    await act(async () => { deceased.dispatchEvent(alt); });
    assert.equal(document.activeElement, deceased); assert.equal(alt.defaultPrevented, false);
    const absent = new dom.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }) as unknown as Event;
    await act(async () => { deceased.dispatchEvent(absent); });
    assert.equal(absent.defaultPrevented, true);
    assert.equal(cards.filter(b => b.tabIndex === 0).length, 1);
    assert.ok(group.textContent?.includes(messages[locale].interview.treeDiedBefore.male));
    assert.ok(group.textContent?.includes(messages[locale].interview.treeDiedLater.female));
    assert.ok(group.textContent?.includes(messages[locale].interview.treeNoShare));
    const zoom = [...node.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.includes(messages[locale].interview.treeZoomIn))!;
    await act(async () => zoom.click());
    const percent = (z: number) => messages[locale].interview.treeZoomStatus.replace("{percent}", new Intl.NumberFormat(locale, { style: "percent" }).format(z));
    assert.equal(notes[0], percent(1.25));
    await act(async () => deceased.focus());
    await key("+"); assert.equal(notes.at(-1), percent(1.5));
    const count = notes.length; await key("="); assert.equal(notes.length, count, "no step beyond 150%");
    await key("-"); await key("_"); await key("-"); await key("-"); assert.equal(notes.at(-1), percent(0.6));
    const total = notes.length; await key("-"); assert.equal(notes.length, total, "no step below 60%");
    await key("+"); assert.equal(notes.at(-1), percent(0.8));
  } finally { await act(async () => root.unmount()); await teardownDom(dom); }
});
test("empty placeholders are native buttons that open the chooser", async () => {
  const dom = installDom(), node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
  try {
    await act(async () => root.render(<FamilyTree messages={messages.en.interview} model={{ people: [], placement: { root: [{ relationship: "father", link: "parent", blocked: false }, { relationship: "wife", link: "spouse", blocked: false }] } }} locale="en" editingId={null} onAnnounce={() => {}} />));
    const buttons = [...node.querySelector('[role="group"]')!.querySelectorAll<HTMLButtonElement>("button")];
    assert.deepEqual(buttons.map(b => b.dataset.focus), ["card:root", "placeholder:parent", "placeholder:spouse"]);
    assert.ok(node.textContent?.includes(messages.en.interview.treeAddParent));
    // Activating one opens the chooser for the root, filtered to that link.
    await act(async () => buttons[1].click());
    const options = [...node.querySelectorAll<HTMLButtonElement>('[data-add-row] [role="group"] button')];
    assert.deepEqual(options.map(o => o.dataset.focus), ["addHere:father"]);
    assert.ok(node.textContent?.includes(messages.en.interview.treeAddSpouse));
  } finally { await act(async () => root.unmount()); await teardownDom(dom); }
});

test("while dragging, legal targets and placeholders say Drop here and illegal ones say Not allowed", async () => {
  const dom = installDom(), node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
  const model: EstateModel = {
    people: [
      { id: "s", personId: "s", relationship: "son", gender: "male", name: null, parentId: null, state: "normal" },
      { id: "d", personId: "d", relationship: "daughter", gender: "female", name: null, parentId: null, state: "normal" },
    ],
    placement: {
      root: [{ relationship: "son", link: "child", blocked: false, gender: "male" }, { relationship: "daughter", link: "child", blocked: false, gender: "female" }],
      s: [{ relationship: "son_of_son", link: "child", blocked: false, gender: "male" }],
      d: [],
    },
  };
  const text = messages.en.interview;
  try {
    await act(async () => root.render(<FamilyTree messages={text} model={model} locale="en" editingId={null} onAnnounce={() => {}} dragging="son" />));
    const card = (id: string) => node.querySelector<HTMLElement>(`[data-node="${id}"]`)!;
    assert.deepEqual(["root", "s", "d"].map(id => card(id).dataset.drop), ["legal", "legal", "illegal"]);
    assert.ok(card("s").textContent?.includes(text.dropHere));
    assert.ok(card("d").textContent?.includes(text.dropNotHere));
    assert.ok(card("d").className.includes("bg-surface text-muted"));
    assert.equal(card("s").dataset.dropAnchor, "s");
    await act(async () => root.render(<FamilyTree messages={text} model={model} locale="en" editingId={null} onAnnounce={() => {}} />));
    assert.equal(card("s").dataset.drop, undefined);
    assert.equal(card("s").textContent?.includes(text.dropHere), false);
  } finally { await act(async () => root.unmount()); await teardownDom(dom); }
});

test("the action row follows the current card and sends the anchor and entry", async () => {
  const dom = installDom(), node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
  const model: EstateModel = {
    people: [{ id: "row1", personId: "s", relationship: "son", gender: "male", name: null, parentId: null, state: "normal" }],
    placement: { root: [{ relationship: "son", link: "child", blocked: false, gender: "male" }], s: [{ relationship: "son_of_son", link: "child", blocked: false, gender: "male" }] },
  };
  const sent: string[] = [];
  try {
    await act(async () => root.render(<FamilyTree messages={messages.en.interview} model={model} locale="en" editingId={null} onAnnounce={() => {}}
      onAddHere={(anchor, entry) => sent.push(`${anchor}:${entry.relationship}`)} addOutcome={{ anchor: "s", text: "Refused" }} />));
    const toggle = () => node.querySelector<HTMLButtonElement>('[data-add-row] [data-focus="addHere"]')!;
    assert.equal(node.querySelector('[data-add-row] [role="alert"]'), null, "an outcome for another anchor is not shown");
    await act(async () => toggle().click());
    await act(async () => node.querySelector<HTMLButtonElement>('[data-add-row] [data-focus="addHere:son"]')!.click());
    await act(async () => node.querySelector<HTMLButtonElement>('[data-node="row1"]')!.focus());
    assert.equal(toggle().getAttribute("aria-expanded"), "false", "the row collapses when the current card changes");
    assert.equal(node.querySelector('[data-add-row] [role="alert"]')?.textContent, "Refused");
    await act(async () => toggle().click());
    await act(async () => node.querySelector<HTMLButtonElement>('[data-add-row] [data-focus="addHere:son_of_son"]')!.click());
    assert.deepEqual(sent, ["root:son", "s:son_of_son"]);
  } finally { await act(async () => root.unmount()); await teardownDom(dom); }
});

test("no action row while a person is being edited, and focusing a card clears a placeholder's filter", async () => {
  const dom = installDom(), node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
  const text = messages.en.interview;
  const empty: EstateModel = { people: [], placement: { root: [{ relationship: "father", link: "parent", blocked: false }, { relationship: "wife", link: "spouse", blocked: false }] } };
  const one: EstateModel = { people: [{ id: "a", personId: "a", relationship: "son", gender: "male", name: null, parentId: null, state: "normal" }], placement: empty.placement };
  const tree = (model: EstateModel, editingId: string | null) => <FamilyTree messages={text} model={model} locale="en" editingId={editingId} onAnnounce={() => {}} />;
  try {
    await act(async () => root.render(tree(one, "a")));
    assert.equal(node.querySelector("[data-add-row]"), null);
    await act(async () => root.render(tree(one, null)));
    assert.ok(node.querySelector("[data-add-row]"));
    await act(async () => root.render(tree(empty, null)));
    await act(async () => node.querySelector<HTMLButtonElement>('[data-focus="placeholder:parent"]')!.click());
    assert.deepEqual([...node.querySelectorAll('[data-add-row] [role="group"] button')].map(b => (b as HTMLElement).dataset.focus), ["addHere:father"]);
    await act(async () => node.querySelector<HTMLButtonElement>('[data-node="root"]')!.focus());
    assert.deepEqual([...node.querySelectorAll('[data-add-row] [role="group"] button')].map(b => (b as HTMLElement).dataset.focus), ["addHere:father", "addHere:wife"]);
  } finally { await act(async () => root.unmount()); await teardownDom(dom); }
});

test("a died-later card opens its estate, the heading is focusable and names the estate, and the breadcrumb slot sits above the canvas", async () => {
  const dom = installDom(), node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
  const text = messages.en.interview;
  const model: EstateModel = { placement: {}, people: [
    { id: "r1", personId: "p1", relationship: "son", gender: "male", name: null, parentId: null, state: "died_later" },
    { id: "r2", personId: "p2", relationship: "daughter", gender: "female", name: null, parentId: null, state: "normal" },
  ] };
  const opened: string[] = [], edited: string[] = [];
  try {
    await act(async () => root.render(<FamilyTree messages={text} model={model} locale="en" editingId={null} onAnnounce={() => {}}
      rootText="Son (2nd death)" breadcrumb={<nav data-slot aria-label="x" />} onOpenEstate={id => opened.push(id)} onEdit={id => edited.push(id)} />));
    const heading = node.querySelector<HTMLElement>('[data-focus="treeHeading"]')!;
    assert.equal(heading.tagName, "H3");
    assert.equal(heading.tabIndex, -1);
    assert.equal(heading.textContent, "Son (2nd death)");
    const area = node.querySelector("[data-tree-area]")!;
    assert.equal(node.querySelector("[data-slot]")!.nextElementSibling, area);
    await act(async () => node.querySelector<HTMLButtonElement>('[data-node="r1"]')!.click());
    assert.deepEqual(opened, ["p1"]);
    assert.deepEqual(edited, []);
    await act(async () => node.querySelector<HTMLButtonElement>('[data-node="r2"]')!.click());
    assert.deepEqual(edited, ["r2"]);
    await act(async () => root.render(<FamilyTree messages={text} model={model} locale="en" editingId={null} onAnnounce={() => {}} />));
    assert.equal(node.querySelector('[data-focus="treeHeading"]')!.textContent, text.treeHeading);
  } finally { await act(async () => root.unmount()); await teardownDom(dom); }
});

test("Delete asks to remove any card but the deceased, never while frozen", async () => {
  const dom = installDom(), node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
  const model: EstateModel = { placement: {}, people: [
    { id: "n", personId: "n", relationship: "son", gender: "male", name: null, parentId: null, state: "normal" },
    { id: "l", personId: "l", relationship: "daughter", gender: "female", name: null, parentId: null, state: "died_later" },
  ] };
  const asked: string[] = [];
  const tree = (frozen: boolean) => <FamilyTree messages={messages.en.interview} model={model} locale="en" editingId={null} frozen={frozen} onAnnounce={() => {}} onRemoveRequest={id => asked.push(id)} />;
  const press = async (id: string) => { const el = node.querySelector<HTMLElement>(`[data-node="${id}"]`)!; await act(async () => { el.dispatchEvent(new dom.KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }) as unknown as Event); }); };
  try {
    await act(async () => root.render(tree(false)));
    await press("l"); await press("n"); await press("root");
    assert.deepEqual(asked, ["l", "n"]);
    await act(async () => root.render(tree(true)));
    await press("l"); await press("n");
    assert.deepEqual(asked, ["l", "n"]);
  } finally { await act(async () => root.unmount()); await teardownDom(dom); }
});

test("each card shows the text and badge of its Heirs-list outline entry", async () => {
  const dom = installDom(), node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
  const text = messages.en.interview;
  const model: EstateModel = { placement: {}, people: [
    { id: "a", personId: "a", relationship: "son", gender: "male", name: "Omar", parentId: null, state: "died_before" },
    { id: "b", personId: "b", relationship: "wife", gender: "female", name: null, parentId: null, state: "died_later" },
    { id: "c", personId: "c", relationship: "brother", gender: "male", name: null, parentId: null, state: "blocked" },
  ] };
  try {
    await act(async () => root.render(<FamilyTree messages={text} model={model} locale="en" editingId={null} onAnnounce={() => {}} />));
    for (const word of treeDescription(text, model).people) {
      const card = node.querySelector<HTMLElement>(`[data-node="${word.id}"]`)!.textContent ?? "";
      assert.ok(card.includes(word.relationship));
      if (word.secondary) assert.ok(card.includes(word.secondary));
      if (word.badge) assert.ok(card.includes(word.badge));
    }
  } finally { await act(async () => root.unmount()); await teardownDom(dom); }
});

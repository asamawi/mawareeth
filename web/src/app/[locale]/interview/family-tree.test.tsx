import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { messages } from "@/i18n/messages";
import type { EstateModel } from "@/interview/tree";
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
    // Nothing is current until a card is pressed; the deceased is only the tab stop.
    assert.equal(node.querySelectorAll('[aria-current="true"]').length, 0);
    assert.equal(deceased.tabIndex, 0);
    await act(async () => { cards[0].click(); });
    assert.equal(cards[0].getAttribute("aria-current"), "true");
    const key = async (value: string) => { await act(async () => { (document.activeElement ?? deceased).dispatchEvent(new dom.KeyboardEvent("keydown", { key: value, bubbles: true }) as unknown as Event); }); };
    await act(async () => deceased.focus());
    await key(locale === "ar" ? "ArrowLeft" : "ArrowRight");
    assert.equal((document.activeElement as HTMLElement).dataset.node, "b");
    await key("End"); assert.equal((document.activeElement as HTMLElement).dataset.node, "a");
    await key("Home"); assert.equal(document.activeElement, deceased);
    // Alt+Arrow keeps its browser meaning: focus stays and the event is not cancelled.
    const alt = new dom.KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true, cancelable: true }) as unknown as Event;
    await act(async () => { deceased.dispatchEvent(alt); });
    assert.equal(document.activeElement, deceased); assert.equal(alt.defaultPrevented, false);
    await key(locale === "ar" ? "ArrowRight" : "ArrowLeft"); assert.equal(document.activeElement, deceased);
    assert.ok(group.textContent?.includes(messages[locale].interview.treeDiedBefore.male));
    assert.ok(group.textContent?.includes(messages[locale].interview.treeDiedLater.female));
    assert.ok(group.textContent?.includes(messages[locale].interview.treeNoShare));
    const zoom = [...node.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent?.includes(messages[locale].interview.treeZoomIn))!;
    await act(async () => zoom.click());
    assert.equal(notes[0], messages[locale].interview.treeZoomStatus.replace("{percent}", new Intl.NumberFormat(locale, { style: "percent" }).format(1.25)));
  } finally { await act(async () => root.unmount()); await teardownDom(dom); }
});
test("empty placeholders are plain items", async () => {
  const dom = installDom(), node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
  try {
    await act(async () => root.render(<FamilyTree messages={messages.en.interview} model={{ people: [], placement: { root: [{ relationship: "father", link: "parent", blocked: false }, { relationship: "wife", link: "spouse", blocked: false }] } }} locale="en" editingId={null} onAnnounce={() => {}} />));
    assert.equal(node.querySelector('[role="group"]')!.querySelectorAll("button").length, 1);
    assert.ok(node.textContent?.includes(messages.en.interview.treeAddParent));
    assert.ok(node.textContent?.includes(messages.en.interview.treeAddSpouse));
  } finally { await act(async () => root.unmount()); await teardownDom(dom); }
});

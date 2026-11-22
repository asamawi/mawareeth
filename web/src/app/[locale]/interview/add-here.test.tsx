import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import type { PlacementOption } from "@/api/case";
import { messages, type Locale } from "@/i18n/messages";
import { installDom, teardownDom } from "@/test/dom";

import { AddHere } from "./add-here";

const ENTRIES: PlacementOption[] = [
  { relationship: "son_of_son", link: "child", blocked: false, gender: "male" },
  { relationship: "daughter_of_son", link: "child", blocked: true, gender: "female" },
  { relationship: "father", link: "parent", blocked: false, gender: "male" },
];

async function mount(props: { locale?: Locale; entries?: PlacementOption[]; frozen?: boolean; atLimit?: boolean; link?: "parent"; alert?: string | null } = {}) {
  const dom = installDom("https://localhost/en/interview/");
  const locale = props.locale ?? "en";
  const text = messages[locale].interview;
  const chosen: string[] = [];
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  await act(async () => {
    root.render(
      <AddHere messages={text} anchor="s" personLabel="Son 1" entries={props.entries ?? ENTRIES} link={props.link}
        frozen={props.frozen ?? false} atLimit={props.atLimit ?? false} alert={props.alert}
        onChoose={(entry) => chosen.push(entry.relationship)} />,
    );
  });
  const toggle = () => node.querySelector<HTMLButtonElement>('[data-focus="addHere"]')!;
  return {
    dom, node, text, chosen, toggle,
    group: () => node.querySelector<HTMLElement>('[role="group"]')!,
    option: (relationship: string) => node.querySelector<HTMLButtonElement>(`[data-focus="addHere:${relationship}"]`)!,
    async click(el: Element) { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); }); },
    async close() { await act(async () => root.unmount()); await teardownDom(dom); },
  };
}

for (const locale of ["en", "ar", "fr"] as const) test(`the chooser toggles, names its group and offers each entry in server order in ${locale}`, async () => {
  const view = await mount({ locale });
  try {
    assert.equal(view.toggle().textContent, view.text.addRelativeHere);
    assert.equal(view.toggle().getAttribute("aria-expanded"), "false");
    assert.equal(view.toggle().getAttribute("aria-controls"), view.group().id);
    assert.ok(view.group().hidden);
    await view.click(view.toggle());
    assert.equal(view.toggle().getAttribute("aria-expanded"), "true");
    assert.equal(view.group().hidden, false);
    assert.equal(view.group().getAttribute("aria-label"), view.text.addHereGroup.replace("{person}", "Son 1"));
    assert.deepEqual([...view.group().querySelectorAll("button")].map((b) => b.dataset.focus),
      ["addHere:son_of_son", "addHere:daughter_of_son", "addHere:father"]);
    const blocked = view.text.heirRelationshipBlocked.replace("{relationship}", view.text.relationships.daughter_of_son);
    assert.equal(view.option("daughter_of_son").textContent, view.text.addRelative.replace("{relationship}", blocked));
    await view.click(view.option("daughter_of_son"));
    assert.deepEqual(view.chosen, ["daughter_of_son"], "a blocked entry stays addable");
  } finally { await view.close(); }
});

test("a link filter offers only that link and no entries shows the none text", async () => {
  const filtered = await mount({ link: "parent" });
  try {
    await filtered.click(filtered.toggle());
    assert.deepEqual([...filtered.group().querySelectorAll("button")].map((b) => b.dataset.focus), ["addHere:father"]);
  } finally { await filtered.close(); }
  const none = await mount({ entries: [] });
  try {
    await none.click(none.toggle());
    assert.equal(none.group().textContent, none.text.addHereNone);
  } finally { await none.close(); }
});

test("Escape collapses and focuses the toggle", async () => {
  const view = await mount();
  try {
    await view.click(view.toggle());
    await act(async () => view.option("son_of_son").focus());
    await act(async () => { view.option("son_of_son").dispatchEvent(new view.dom.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }) as unknown as Event); });
    assert.equal(view.toggle().getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, view.toggle());
  } finally { await view.close(); }
});

test("frozen and at-limit disable everything; at the limit it says so", async () => {
  const frozen = await mount({ frozen: true });
  try {
    await frozen.click(frozen.toggle());
    assert.equal(frozen.toggle().getAttribute("aria-disabled"), "true");
    assert.equal(frozen.toggle().getAttribute("aria-expanded"), "false");
  } finally { await frozen.close(); }
  const full = await mount({ atLimit: true, alert: "Refused" });
  try {
    assert.ok(full.node.textContent?.includes(full.text.fieldErrors.heirs.limit));
    assert.equal(full.node.querySelector('[role="alert"]')?.textContent, "Refused");
    await full.click(full.option("son_of_son"));
    assert.deepEqual(full.chosen, []);
  } finally { await full.close(); }
});

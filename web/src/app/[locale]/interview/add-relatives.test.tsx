import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import type { RelationshipId } from "@/api/case";
import { messages, type Locale } from "@/i18n/messages";
import type { PanelOutcome } from "@/interview/flow";
import { addGroups } from "@/interview/relatives";
import { installDom, teardownDom } from "@/test/dom";

import { AddRelatives } from "./add-relatives";

async function mount(props: { locale?: Locale; atLimit?: boolean; disabled?: boolean; outcome?: PanelOutcome; blocked?: RelationshipId[] } = {}) {
  const dom = installDom("https://localhost/en/interview/");
  const locale = props.locale ?? "en";
  const pressed: string[] = [];
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  const groups = addGroups(
    [
      { relationship: "father", link: "parent", blocked: false },
      { relationship: "mother", link: "parent", blocked: false },
      { relationship: "wife", link: "spouse", blocked: false },
      { relationship: "son", link: "child", blocked: false },
    ],
    { blocked: props.blocked ?? [], invalid: {} },
  );
  await act(async () => {
    root.render(
      <AddRelatives
        messages={messages[locale].interview}
        groups={groups}
        atLimit={props.atLimit ?? false}
        disabled={props.disabled ?? false}
        outcome={props.outcome}
        onAdd={(relationship) => pressed.push(relationship)}
      />,
    );
  });
  return {
    node,
    pressed,
    button: (id: string) => node.querySelector<HTMLButtonElement>(`[data-focus="add:${id}"]`)!,
    async click(el: Element) {
      await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    },
    async close() { await act(async () => root.unmount()); await teardownDom(dom); },
  };
}

test("groups and headings in order; empty groups are not rendered", async () => {
  const ui = await mount();
  try {
    assert.equal(ui.node.querySelector("h3#add-relatives-heading")?.textContent, "Add relatives");
    assert.equal(ui.node.querySelector("h3#add-relatives-heading")?.getAttribute("tabindex"), "-1");
    const headings = [...ui.node.querySelectorAll('[role="group"] > h4')].map((h) => h.textContent);
    assert.deepEqual(headings.slice(0, 3), ["Spouse", "Parents", "Children"]);
    assert.equal(headings.at(-1), "More relatives");
    for (const group of ui.node.querySelectorAll('[role="group"]')) {
      assert.equal(group.getAttribute("aria-labelledby"), group.querySelector("h4")?.id);
    }
  } finally { await ui.close(); }
});

test("a button's text holds its visible label, the plus is aria-hidden, and a press adds", async () => {
  const ui = await mount();
  try {
    const son = ui.button("son");
    assert.equal(son.textContent?.replace(/\s+/g, " ").trim(), "Add Son +");
    assert.equal(son.querySelector('[aria-hidden="true"]')?.textContent?.trim(), "+");
    assert.equal(son.hasAttribute("aria-label"), false);
    assert.equal(son.getAttribute("aria-disabled"), "false");
    await ui.click(son);
    assert.deepEqual(ui.pressed, ["son"]);
  } finally { await ui.close(); }
});

test("at the limit or while frozen every button is aria-disabled and a press does nothing", async () => {
  for (const props of [{ atLimit: true }, { disabled: true }]) {
    const ui = await mount(props);
    try {
      const buttons = [...ui.node.querySelectorAll("button")];
      assert.ok(buttons.length > 4);
      assert.ok(buttons.every((b) => b.getAttribute("aria-disabled") === "true" && !b.disabled));
      await ui.click(ui.button("son"));
      assert.deepEqual(ui.pressed, []);
      if (props.atLimit) assert.ok(ui.node.textContent?.includes(messages.en.interview.fieldErrors.heirs.limit));
    } finally { await ui.close(); }
  }
});

test("a blocked relative carries the blocked wording and stays addable", async () => {
  const ui = await mount({ blocked: ["brother"] });
  try {
    assert.ok(ui.button("brother").textContent?.includes("does not inherit"));
    await ui.click(ui.button("brother"));
    assert.deepEqual(ui.pressed, ["brother"]);
  } finally { await ui.close(); }
});

test("a refusal and a conflict show in one alert", async () => {
  let ui = await mount({ outcome: { relationship: "father", errors: { relationship: "second_father" } } });
  try {
    const alerts = ui.node.querySelectorAll('[role="alert"]');
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].textContent, messages.en.interview.fieldErrors.relationship.second_father);
  } finally { await ui.close(); }
  ui = await mount({ outcome: { relationship: "son", notice: "conflict" } });
  try {
    assert.equal(ui.node.querySelector('[role="alert"]')?.textContent, messages.en.interview.conflictNotice);
  } finally { await ui.close(); }
});

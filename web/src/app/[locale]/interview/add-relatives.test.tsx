import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import type { RelationshipId } from "@/api/case";
import { messages, type Locale } from "@/i18n/messages";
import type { Announcement, PanelOutcome } from "@/interview/flow";
import { addGroups } from "@/interview/relatives";
import { installDom, teardownDom } from "@/test/dom";

import { AddRelatives, outcomeText } from "./add-relatives";

async function mount(props: { locale?: Locale; atLimit?: boolean; outcome?: PanelOutcome; blocked?: RelationshipId[] } = {}) {
  const dom = installDom("https://localhost/en/interview/");
  const locale = props.locale ?? "en";
  const pressed: [RelationshipId, number][] = [];
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
  const drags: string[] = [];
  async function render(remaining = 50, completed?: Announcement, outcome = props.outcome, disabled = false) {
    await act(async () => {
      root.render(
        <AddRelatives
          messages={messages[locale].interview}
          groups={groups}
          remaining={remaining}
          completed={completed}
          atLimit={props.atLimit ?? false}
          disabled={disabled}
          outcome={outcome}
          onAdd={(relationship, count) => pressed.push([relationship, count])}
          onDragStart={(id) => drags.push(`start:${id}`)}
          onDragEnd={() => drags.push("end")}
          onDrop={(id, target) => drags.push(`drop:${id}:${target.anchor}:${target.link ?? ""}`)}
        />,
      );
    });
  }
  await render();
  return {
    node,
    pressed,
    drags,
    dom,
    render,
    labelled: (label: string) => node.querySelector<HTMLElement>(`[aria-label="${label}"]`)!,
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
    assert.deepEqual(ui.pressed, [["son", 1]]);
  } finally { await ui.close(); }
});

test("at the limit or while frozen every button is aria-disabled and a press does nothing", async () => {
  for (const atLimit of [true, false]) {
    const ui = await mount({ atLimit });
    try {
      const plus = ui.labelled("One more Son");
      const minus = ui.labelled("One fewer Son");
      const count = ui.labelled("Number of Son to add");
      if (!atLimit) {
        await ui.click(plus);
        assert.equal(count.textContent, "2");
        await ui.render(50, undefined, undefined, true);
      }
      const buttons = [...ui.node.querySelectorAll("button")];
      assert.ok(buttons.length > 4);
      assert.ok(buttons.every((b) => b.getAttribute("aria-disabled") === "true" && !b.disabled));
      await ui.click(minus);
      assert.equal(count.textContent, atLimit ? "1" : "2");
      await ui.click(plus);
      assert.equal(count.textContent, atLimit ? "1" : "2");
      await ui.click(ui.button("son"));
      assert.deepEqual(ui.pressed, []);
      if (atLimit) assert.ok(ui.node.textContent?.includes(messages.en.interview.fieldErrors.heirs.limit));
    } finally { await ui.close(); }
  }
});

test("a blocked relative carries the blocked wording and stays addable", async () => {
  const ui = await mount({ blocked: ["brother"] });
  try {
    assert.ok(ui.button("brother").textContent?.includes("does not inherit"));
    await ui.click(ui.button("brother"));
    assert.deepEqual(ui.pressed, [["brother", 1]]);
  } finally { await ui.close(); }
});

test("steppers have localized names and silent counts, including blocked relatives", async () => {
  for (const locale of ["en", "ar", "fr"] as const) {
    const ui = await mount({ locale, blocked: ["brother"] });
    try {
      const copy = messages[locale].interview;
      const label = (template: string) => template.replace("{relationship}", copy.relationships.brother);
      const minus = ui.labelled(label(copy.stepperFewer));
      const plus = ui.labelled(label(copy.stepperMore));
      const count = ui.labelled(label(copy.stepperCount));
      assert.equal(minus.querySelector('[aria-hidden="true"]')?.textContent, "−");
      assert.equal(plus.querySelector('[aria-hidden="true"]')?.textContent, "+");
      assert.equal(count.tagName, "OUTPUT");
      assert.equal(count.getAttribute("aria-live"), "off");
      assert.equal(minus.getAttribute("aria-disabled"), "true");
      assert.equal(minus.hasAttribute("disabled"), false);
      await ui.click(minus);
      assert.equal(count.textContent, "1");
      await ui.click(plus);
      assert.equal(count.textContent, "2");
      const [descriptionId, valueId] = ui.button("brother").getAttribute("aria-describedby")?.split(" ") ?? [];
      assert.equal(document.getElementById(descriptionId), count);
      assert.equal(count.querySelector(`[id="${valueId}"]`)?.textContent, "2");
      await ui.click(minus);
      assert.equal(count.textContent, "1");
      assert.deepEqual(ui.pressed, []);
    } finally { await ui.close(); }
  }
});

test("counts clamp to remaining room, survive refusals and reset only the accepted relationship", async () => {
  const ui = await mount();
  try {
    const son = ui.labelled("Number of Son to add");
    const more = ui.labelled("One more Son");
    await ui.click(ui.labelled("One more Mother"));
    for (let press = 0; press < 4; press++) await ui.click(more);
    assert.equal(son.textContent, "5");
    await ui.render(3);
    assert.equal(son.textContent, "3");
    assert.equal(more.getAttribute("aria-disabled"), "true");
    assert.equal(more.hasAttribute("disabled"), false);
    await ui.click(more);
    await ui.click(ui.button("son"));
    assert.deepEqual(ui.pressed, [["son", 3]]);
    for (const outcome of [{ notice: "failed" }, { notice: "conflict" }, { errors: { heirs: "limit" } }] as const) {
      await ui.render(3, undefined, { relationship: "son", ...outcome });
      assert.equal(son.textContent, "3");
    }
    const completed: Announcement = { kind: "added", seq: 1, id: "s3", heir: { relationship: "son", name: null }, ordinal: 3, panelCount: 3 };
    await ui.render(3, completed);
    assert.equal(son.textContent, "1");
    assert.equal(ui.labelled("Number of Mother to add").textContent, "2");
    await ui.click(more);
    await ui.render(3, completed);
    assert.equal(son.textContent, "2");
    await ui.render(3, { ...completed });
    assert.equal(son.textContent, "2");
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

function pointer(dom: unknown, type: string, element: EventTarget, init: { x: number; y: number }) {
  const event = new (dom as { Event: typeof Event }).Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerId: 1, pointerType: "mouse", button: 0, buttons: 1, clientX: init.x, clientY: init.y });
  element.dispatchEvent(event);
}

test("a press that moves more than 6px drags the relationship, drops on a target and swallows the click", async () => {
  const ui = await mount();
  try {
    const target = document.createElement("div");
    target.dataset.dropAnchor = "s";
    target.dataset.dropLink = "child";
    document.body.append(target);
    (document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => target;
    const son = ui.button("son");
    await act(async () => pointer(ui.dom, "pointerdown", son, { x: 10, y: 10 }));
    await act(async () => pointer(ui.dom, "pointermove", window, { x: 13, y: 12 }));
    assert.deepEqual(ui.drags, [], "a small move is still a tap");
    await act(async () => pointer(ui.dom, "pointermove", window, { x: 40, y: 12 }));
    await act(async () => pointer(ui.dom, "pointerup", window, { x: 40, y: 12 }));
    assert.deepEqual(ui.drags, ["start:son", "end", "drop:son:s:child"]);
    await ui.click(son);
    assert.deepEqual(ui.pressed, [], "the click after a drag adds nothing");
    await ui.click(son);
    assert.deepEqual(ui.pressed, [["son", 1]], "a later plain tap still adds");
  } finally { await ui.close(); }
});

test("a cancelled pointer, a release away from any target and a disabled button drop nothing", async () => {
  const ui = await mount();
  try {
    (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () => null;
    const son = ui.button("son");
    await act(async () => pointer(ui.dom, "pointerdown", son, { x: 0, y: 0 }));
    await act(async () => pointer(ui.dom, "pointermove", window, { x: 30, y: 0 }));
    await act(async () => pointer(ui.dom, "pointerup", window, { x: 30, y: 0 }));
    assert.deepEqual(ui.drags, ["start:son", "end"]);
    ui.drags.length = 0;
    await act(async () => pointer(ui.dom, "pointerdown", son, { x: 0, y: 0 }));
    await act(async () => pointer(ui.dom, "pointermove", window, { x: 30, y: 0 }));
    await act(async () => pointer(ui.dom, "pointercancel", window, { x: 30, y: 0 }));
    assert.deepEqual(ui.drags, ["start:son", "end"]);
    ui.drags.length = 0;
    await ui.render(50, undefined, undefined, true);
    await act(async () => pointer(ui.dom, "pointerdown", son, { x: 0, y: 0 }));
    await act(async () => pointer(ui.dom, "pointermove", window, { x: 30, y: 0 }));
    assert.deepEqual(ui.drags, []);
  } finally { await ui.close(); }
});

test("outcomeText turns an anchor schema refusal into its localized text", () => {
  const text = messages.en.interview;
  assert.equal(outcomeText(text, { errors: { anchor: "schema_unsupported" } }), text.fieldErrors.anchor.schema_unsupported);
});

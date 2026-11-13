import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { RELATIONSHIP_IDS, type Gender, type HeirOptions } from "@/api/case";
import { messages, type Locale } from "@/i18n/messages";
import type { HeirValues } from "@/interview/answers";
import { installDom, teardownDom } from "@/test/dom";

import { HeirForm } from "./heir-form";

const NONE: HeirOptions = { blocked: [], invalid: {} };

async function mount(
  props: {
    locale?: Locale;
    gender?: Gender;
    initial?: HeirValues;
    editing?: boolean;
    options?: HeirOptions;
    saving?: boolean;
    errors?: Record<string, string> | null;
  } = {},
) {
  const dom = installDom("https://localhost/en/interview/");
  const changes: { values: HeirValues; field: string }[] = [];
  const blurs: { field: string; values: HeirValues }[] = [];
  const submits: HeirValues[] = [];
  const locale = props.locale ?? "en";
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  await act(async () => {
    root.render(
      <div dir={locale === "ar" ? "rtl" : "ltr"}>
        <HeirForm
          messages={messages[locale].interview}
          initial={props.initial ?? { relationship: "", name: "" }}
          errors={props.errors ?? null}
          notice={null}
          saving={props.saving ?? false}
          editing={props.editing ?? false}
          options={props.options ?? NONE}
          deceasedGender={props.gender ?? "male"}
          onChange={(values, field) => changes.push({ values, field })}
          onBlur={(field, values) => blurs.push({ field, values })}
          onSubmit={(values) => submits.push(values)}
          onCancel={() => {}}
        />
      </div>,
    );
  });
  const radios = () => [...node.querySelectorAll<HTMLInputElement>('input[type="radio"][name="relationship"]')];
  const select = () => node.querySelector<HTMLSelectElement>("#heir-relationship-rare");
  const moreButton = () => node.querySelector<HTMLButtonElement>("button[aria-controls]");
  return {
    node, changes, blurs, submits, radios, select, moreButton,
    async click(el: Element) {
      await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
    },
    async choose(el: HTMLSelectElement, value: string) {
      await act(async () => {
        el.value = value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
    },
    async focusOut(from: Element, to: Element | null) {
      await act(async () => {
        const event = new Event("focusout", { bubbles: true }) as Event & { relatedTarget: Element | null };
        Object.defineProperty(event, "relatedTarget", { value: to });
        from.dispatchEvent(event);
      });
    },
    async close() { await act(async () => root.unmount()); await teardownDom(dom); },
  };
}

const ids = (ui: Awaited<ReturnType<typeof mount>>) => ui.radios().map((radio) => radio.value);

test("male deceased: common heirs in order, wife among them, 18 others in More relatives", async () => {
  const ui = await mount();
  try {
    assert.deepEqual(ids(ui), ["wife", "son", "daughter", "father", "mother"]);
    assert.equal(ui.select(), null);
    await ui.click(ui.moreButton()!);
    const options = [...ui.select()!.options].map((o) => o.value).filter(Boolean);
    assert.equal(options.length, 18);
    assert.ok(options.includes("husband"));
    assert.deepEqual(options, RELATIONSHIP_IDS.filter((id) => !ids(ui).includes(id)));
  } finally { await ui.close(); }
});

test("female deceased: husband is common, wife is in More relatives", async () => {
  const ui = await mount({ gender: "female" });
  try {
    assert.deepEqual(ids(ui), ["husband", "son", "daughter", "father", "mother"]);
    await ui.click(ui.moreButton()!);
    assert.ok([...ui.select()!.options].some((o) => o.value === "wife"));
  } finally { await ui.close(); }
});

test("tapping Son checks it and reports the change", async () => {
  const ui = await mount();
  try {
    await ui.click(ui.radios().find((r) => r.value === "son")!);
    assert.equal(ui.radios().find((r) => r.value === "son")!.checked, true);
    assert.deepEqual(ui.changes.at(-1), { values: { relationship: "son", name: "" }, field: "relationship" });
  } finally { await ui.close(); }
});

test("More relatives reveals and focuses the select; a rare pick checks no radio", async () => {
  const ui = await mount();
  try {
    await ui.click(ui.moreButton()!);
    assert.equal(ui.moreButton(), null);
    assert.equal(document.activeElement, ui.select());
    await ui.choose(ui.select()!, "brother");
    assert.equal(ui.changes.at(-1)!.values.relationship, "brother");
    assert.ok(ui.radios().every((r) => !r.checked));
    assert.equal(ui.node.querySelector('[data-focus="relationship"]'), ui.select());
  } finally { await ui.close(); }
});

test("editing a rare heir starts with the select open and selected", async () => {
  const ui = await mount({ editing: true, initial: { relationship: "uncle", name: "" } });
  try {
    assert.equal(ui.select()!.value, "uncle");
    assert.equal(ui.moreButton(), null);
  } finally { await ui.close(); }
});

test("switching back to a common heir resets the select to its placeholder", async () => {
  const ui = await mount({ initial: { relationship: "uncle", name: "" } });
  try {
    await ui.click(ui.radios().find((r) => r.value === "mother")!);
    assert.equal(ui.changes.at(-1)!.values.relationship, "mother");
    assert.equal(ui.select()!.value, "");
  } finally { await ui.close(); }
});

test("blocked relatives carry the blocked label in the add form, plain in the edit form", async () => {
  const options: HeirOptions = { blocked: ["brother", "son"], invalid: {} };
  const add = await mount({ options });
  try {
    await add.click(add.moreButton()!);
    const brother = [...add.select()!.options].find((o) => o.value === "brother")!;
    assert.match(brother.text, /does not inherit/);
    assert.match(add.radios().find((r) => r.value === "son")!.closest("label")!.textContent!, /does not inherit/);
  } finally { await add.close(); }
  const edit = await mount({ options, editing: true, initial: { relationship: "brother", name: "" } });
  try {
    const brother = [...edit.select()!.options].find((o) => o.value === "brother")!;
    assert.doesNotMatch(brother.text, /does not inherit/);
  } finally { await edit.close(); }
});

test("data-focus lands on the checked radio, else the first radio", async () => {
  const blank = await mount();
  try {
    assert.equal(blank.node.querySelectorAll('[data-focus="relationship"]').length, 1);
    assert.equal(blank.node.querySelector('[data-focus="relationship"]'), blank.radios()[0]);
  } finally { await blank.close(); }
  const mother = await mount({ initial: { relationship: "mother", name: "" } });
  try {
    assert.equal(mother.node.querySelectorAll('[data-focus="relationship"]').length, 1);
    assert.equal(mother.node.querySelector('[data-focus="relationship"]'), mother.radios()[4]);
  } finally { await mother.close(); }
});

test("missing relationship error is described by the group", async () => {
  const ui = await mount({ errors: { relationship: "required" } });
  try {
    assert.equal(ui.node.querySelector("fieldset")!.getAttribute("aria-describedby"), "heir-relationship-error");
    const group = ui.node.querySelector('[role="radiogroup"]')!;
    assert.equal(group.getAttribute("aria-required"), "true");
    assert.equal(group.getAttribute("aria-invalid"), "true");
    assert.equal(group.getAttribute("aria-describedby"), "heir-relationship-error");
    assert.notEqual(ui.node.querySelector("#heir-relationship-error")!.textContent, "");
    assert.equal(ui.node.querySelector('[data-focus="relationship"]'), ui.radios()[0]);
  } finally { await ui.close(); }
});

test("blur fires once when focus leaves the picker, not between its controls", async () => {
  const ui = await mount({ initial: { relationship: "son", name: "" } });
  try {
    const [first, second] = ui.radios();
    await ui.focusOut(first, second);
    await ui.focusOut(second, ui.moreButton());
    assert.equal(ui.blurs.length, 0);
    await ui.focusOut(second, document.querySelector("#heir-name"));
    assert.equal(ui.blurs.length, 1);
    assert.equal(ui.blurs[0].field, "relationship");
  } finally { await ui.close(); }
});

test("picks are ignored while saving", async () => {
  const ui = await mount({ saving: true });
  try {
    await ui.click(ui.radios()[1]);
    assert.equal(ui.changes.length, 0);
    assert.ok(ui.radios().every((r) => !r.checked));
  } finally { await ui.close(); }
});

test("Arabic renders the labels and the reveal button", async () => {
  const ui = await mount({ locale: "ar" });
  try {
    const m = messages.ar.interview;
    assert.equal(ui.node.querySelector("legend")!.textContent, m.heirRelationshipLabel);
    assert.equal(ui.moreButton()!.textContent, m.heirMoreRelatives);
    assert.equal(ui.radios()[1].closest("label")!.textContent, m.relationships.son);
  } finally { await ui.close(); }
});

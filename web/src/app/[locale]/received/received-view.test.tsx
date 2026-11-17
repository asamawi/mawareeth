import { test } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { installDom, teardownDom } from "@/test/dom";
import { messages } from "@/i18n/messages";
import { previewFixture } from "@/test/preview-fixtures";
import { ReceivedView } from "./received-view";
test("received fragment accepts only digits and foreign or revoked invites show unavailable", async () => {
  for (const hash of ["7", "7x", "-1", "1?token=secret"]) {
    const dom = installDom(`http://localhost/en/received/#${hash}`);
    document.cookie = "csrftoken=test";
    const urls: string[] = [];
    globalThis.fetch = async (url) => { urls.push(String(url)); return Response.json({}, { status: 404 }); };
    const node = document.createElement("div"); document.body.append(node);
    const root = createRoot(node);
    try {
      await act(async () => { root.render(<ReceivedView messages={messages.en} locale="en" />); });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      assert.ok(node.textContent?.includes(messages.en.shared.unavailable));
      assert.deepEqual(urls, hash === "7" ? ["/api/v1/received/7/view/"] : []);
    } finally { await act(async () => root.unmount()); await teardownDom(dom); }
  }
});

const SERVED = previewFixture("Hanbali wife and son with an estate");
const AVAILABLE = SERVED.response;

test("available received results are read-only and Download uses the received report endpoint", async () => {
  const dom = installDom("http://localhost/en/received/#7");
  document.cookie = "csrftoken=test";
  const calls: { url: string; method: string }[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    if (String(url).endsWith("/report/")) return new Response(null, { status: 503 });
    return Response.json({ status: "available", owner: "Owner", case: { id: "invite-7", started_at: "2026-11-01", madhab: "hanbali", deceased: { gender: "male", estate: "8000" }, heirs: SERVED.case.heirs }, preview: AVAILABLE });
  };
  const node = document.createElement("div"); document.body.append(node);
  const root = createRoot(node);
  try {
    await act(async () => root.render(<ReceivedView messages={messages.en} locale="en" />));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    assert.ok(node.querySelector("#results-shares"), "available results render");
    // Every number on screen is the server's presented string: share, amount, kirat and the School line.
    const shown = node.textContent ?? "";
    for (const text of ["SAR1,000.00", "SAR7,000.00", "1/8", "87.5%", "12.5%", "3.00", "21.00"]) assert.ok(shown.includes(text), text);
    assert.ok(shown.includes("Hanbali"), "the School line is the presented one");
    assert.ok(node.querySelector('span[lang="ar"][dir="rtl"]'), "the Arabic original relationship is rendered");
    assert.ok(node.textContent?.includes(messages.en.shared.banner));
    const buttons = Array.from(node.querySelectorAll("button"));
    assert.ok(!buttons.some((button) => button.textContent === messages.en.results.save || button.textContent === messages.en.results.shareAction));
    assert.equal(node.querySelector("dialog"), null);
    const download = buttons.find((button) => button.textContent?.includes(messages.en.results.pdfDownload));
    assert.ok(download);
    await act(async () => download.click());
    assert.deepEqual(calls, [
      { url: "/api/v1/received/7/view/", method: "POST" },
      { url: "/api/v1/received/7/report/", method: "POST" },
    ]);
    await act(async () => {
      history.replaceState(null, "", "/en/received/#8");
      window.dispatchEvent(new Event("hashchange"));
    });
    assert.ok(calls.some((call) => call.url === "/api/v1/received/8/view/"));
  } finally { await act(async () => root.unmount()); await teardownDom(dom); }
});

test("the calculation steps show the presented table's totals: awl, radd with a spouse and correction", async () => {
  for (const title of [
    "Husband and two sisters need awl",
    "Hanafi wife, mother and daughter need radd with a spouse",
    "Hanbali wife and three sons need correction",
  ]) {
    const served = previewFixture(title);
    const body = served.response as { proof: { steps: { step: string; value: number }[] } };
    const dom = installDom("http://localhost/en/received/#9");
    document.cookie = "csrftoken=test";
    globalThis.fetch = async () => Response.json({ status: "available", owner: "Owner", case: { id: "invite-9", started_at: "2026-11-01", madhab: served.case.madhab, deceased: served.case.deceased, heirs: served.case.heirs.map((heir) => ({ ...heir, name: heir.name ?? heir.id })) }, preview: served.response });
    const node = document.createElement("div"); document.body.append(node);
    const root = createRoot(node);
    try {
      await act(async () => root.render(<ReceivedView messages={messages.en} locale="en" />));
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      const steps = Array.from(node.querySelectorAll("#results-steps ~ ol li, section[aria-labelledby='results-steps'] li"));
      // Each step line ends with the legacy proof's own value for that step.
      for (const step of body.proof.steps) {
        assert.ok(steps.some((item) => item.querySelector("bdi")?.textContent === String(step.value)), `${title}: ${step.step} ${step.value}`);
      }
    } finally { await act(async () => root.unmount()); await teardownDom(dom); }
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { installDom, teardownDom } from "@/test/dom";
import { messages } from "@/i18n/messages";
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

const BASIS = { madhab: "hanbali", gender: "male", estate: "8000", heirs: [{ id: "a1", relationship: "wife" }] };

const AVAILABLE = {
  status: "available",
  madhab: "hanbali",
  basis: BASIS,
  shares: [{ heir_id: "a1", numerator: 1, denominator: 8, blocked: false, amount: "1000.00" }],
  unallocated: null,
  proof: {
    version: 1,
    madhab: "hanbali",
    school_rules: [],
    school_rule_labels: [],
    heirs: [
      {
        heir: "a1",
        relationship: "wife",
        rule: "fixed",
        condition: "descendant",
        blocked_by: null,
        fraction: { numerator: 1, denominator: 8 },
        share: { numerator: 1, denominator: 8 },
        verse: "4:12",
        school_rule: null,
        option: null,
        labels: {
          rule: "Fixed share",
          condition: "There is a descendant",
          blocked_by: null,
          verse: "Quran 4:12 (An-Nisa)",
          school_rule: null,
          option: null,
        },
      },
    ],
    steps: [{ step: "base", value: 8, label: "The common base of the fixed shares" }],
  },
  table: {
    columns: [{ code: "base", total: 8, label: "Shares" }],
    rows: [
      { heir: "a1", blocked: false, group_span: 1, prescribed: { numerator: 1, denominator: 8 }, cells: [{ value: 1, span: 1 }] },
    ],
  },
};


test("available received results are read-only and Download uses the received report endpoint", async () => {
  const dom = installDom("http://localhost/en/received/#7");
  document.cookie = "csrftoken=test";
  const calls: { url: string; method: string }[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    if (String(url).endsWith("/report/")) return new Response(null, { status: 503 });
    return Response.json({ status: "available", owner: "Owner", case: { id: "invite-7", started_at: "2026-11-01", madhab: "hanbali", deceased: { gender: "male", estate: "8000" }, heirs: [{ ...BASIS.heirs[0], gender: "female" }] }, preview: AVAILABLE });
  };
  const node = document.createElement("div"); document.body.append(node);
  const root = createRoot(node);
  try {
    await act(async () => root.render(<ReceivedView messages={messages.en} locale="en" />));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    assert.ok(node.querySelector("#results-shares"), "available results render");
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

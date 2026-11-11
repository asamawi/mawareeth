import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { saveCase, listSavedCases, openSavedCase } from "./saved-cases.ts";
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
const signal = () => new AbortController().signal;
const options = { cookie: () => "csrftoken=token" };
test("save submits only case id using shared CSRF transport and accepts create/update", async () => {
  for (const status of [200, 201]) {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "/api/v1/saved-cases/");
      assert.equal(init?.method, "POST");
      assert.equal(init?.body, JSON.stringify({ case_id: "live" }));
      assert.equal((init?.headers as Record<string, string>)["X-CSRFToken"], "token");
      assert.equal(init?.credentials, "same-origin");
      return Response.json({ id: 42, updated_at: "2026-11-11" }, { status });
    };
    assert.deepEqual(await saveCase(signal(), "live", options), { id: 42, updated_at: "2026-11-11" });
  }
});
test("save failures allow explicit retries and never retry silently", async () => {
  for (const status of [400, 403, 409, 500]) {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response("", { status }); };
    assert.equal(await saveCase(signal(), "live", options), null);
    assert.equal(calls, 1);
  }
  globalThis.fetch = async () => { throw new Error("offline"); };
  assert.equal(await saveCase(signal(), "live", options), null);
  globalThis.fetch = async () => Response.json({ id: "bad" });
  assert.equal(await saveCase(signal(), "live", options), null);
});
test("list handles own summaries, empty, malformed and forbidden responses", async () => {
  const row = { id: 1, updated_at: "2026-11-11", madhab: "hanafi", heir_count: 2, status: "draft" };
  for (const cases of [[], [row]]) {
    globalThis.fetch = async () => Response.json({ cases });
    assert.deepEqual(await listSavedCases(signal()), cases);
  }
  globalThis.fetch = async () => Response.json({ cases: [{}] });
  await assert.rejects(listSavedCases(signal()));
  globalThis.fetch = async () => new Response("", { status: 403 });
  await assert.rejects(listSavedCases(signal()));
});
test("open loads a fresh session case and rejects missing or foreign records", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/v1/saved-cases/42/open/");
    assert.equal(init?.method, "POST");
    return Response.json({ case: { id: "fresh", started_at: "now", madhab: "hanafi", heirs: [] } });
  };
  assert.equal((await openSavedCase(signal(), 42, options))?.id, "fresh");
  globalThis.fetch = async () => new Response("", { status: 404 });
  assert.equal(await openSavedCase(signal(), 42, options), null);
});

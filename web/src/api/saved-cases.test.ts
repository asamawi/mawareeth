import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { saveCase, listSavedCases, openSavedCase, suggestedName, graphemeCount, OPEN_CONFLICT, SAVE_CONFLICT, SCHOOL_REQUIRED, NAME_TOO_LONG, NAME_INVALID } from "./saved-cases.ts";
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
      return Response.json({ id: 42, name: "Estate", updated_at: "2026-11-11" }, { status });
    };
    assert.deepEqual(await saveCase(signal(), "live", options), { id: 42, name: "Estate", updated_at: "2026-11-11" });
  }
});
test("save failures allow explicit retries and never retry silently", async () => {
  for (const status of [400, 403, 409, 500, 503]) {
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
test("a 200 without the stored name is not a success", async () => {
  globalThis.fetch = async () => Response.json({ id: 42, updated_at: "2026-11-11" });
  assert.equal(await saveCase(signal(), "live", options), null);
});
test("save sends the name and tells a conflict and a missing school apart", async () => {
  let sent = "";
  globalThis.fetch = async (_url, init) => { sent = String(init?.body); return Response.json({ code: "saved_case_conflict", saved_id: 123, saved_name: "Test Case", revision: 5, working_revision: 2 }, { status: 409 }); };
  const result = await saveCase(signal(), "live", { ...options, name: "Mother's estate" });
  assert.ok(typeof result === "object" && result !== null && "code" in result && result.code === SAVE_CONFLICT);
  const conflictResult = result as { savedId: number; savedName: string; savedRevision: number; workingRevision: number };
  assert.equal(conflictResult.savedId, 123);
  assert.equal(conflictResult.savedName, "Test Case");
  assert.equal(conflictResult.savedRevision, 5);
  assert.equal(conflictResult.workingRevision, 2);
  assert.deepEqual(JSON.parse(sent), { case_id: "live", name: "Mother's estate" });
  globalThis.fetch = async () => Response.json({ code: "school_required" }, { status: 400 });
  assert.equal(await saveCase(signal(), "live", options), SCHOOL_REQUIRED);
});
test("the suggestion is read in the page Locale and failures give null", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/v1/saved-cases/name-suggestion/");
    assert.equal((init?.headers as Record<string, string>)["Accept-Language"], "ar");
    return Response.json({ name: "تركة" });
  };
  assert.equal(await suggestedName(signal(), "ar"), "تركة");
  globalThis.fetch = async () => new Response("", { status: 500 });
  assert.equal(await suggestedName(signal(), "ar"), null);
  globalThis.fetch = async () => { throw new Error("offline"); };
  assert.equal(await suggestedName(signal(), "ar"), null);
});
test("grapheme count matches the shared fixture the server also tests", () => {
  const rows = JSON.parse(readFileSync(new URL("./grapheme-names.json", import.meta.url), "utf8")) as { name: string; count: number }[];
  for (const row of rows) assert.equal(graphemeCount(row.name, "en"), row.count, row.name.slice(0, 12));
});
test("a legal stored empty name is still a success", async () => {
  globalThis.fetch = async () => Response.json({ id: 42, name: "", updated_at: "2026-11-11" }, { status: 200 });
  assert.deepEqual(await saveCase(signal(), "live", options), { id: 42, name: "", updated_at: "2026-11-11" });
});
test("the save POST carries the page Locale as Accept-Language", async () => {
  let language: string | undefined;
  globalThis.fetch = async (_url, init) => { language = (init?.headers as Record<string, string>)["Accept-Language"]; return Response.json({ id: 1, name: "n", updated_at: "x" }, { status: 201 }); };
  await saveCase(signal(), "live", { ...options, name: "", locale: "fr" });
  assert.equal(language, "fr");
});
test("a refused name is its own outcome, not a generic failure", async () => {
  globalThis.fetch = async () => Response.json({ errors: { name: "too_long" } }, { status: 400 });
  assert.equal(await saveCase(signal(), "live", { ...options, name: "x" }), NAME_TOO_LONG);
  globalThis.fetch = async () => Response.json({ errors: { name: "invalid" } }, { status: 400 });
  assert.equal(await saveCase(signal(), "live", { ...options, name: "x" }), NAME_INVALID);
});
test("without Intl.Segmenter the count falls back to code points", () => {
  const original = Intl.Segmenter;
  (Intl as unknown as Record<string, unknown>).Segmenter = undefined;
  try {
    assert.equal(graphemeCount("a\u0301b"), 3);
    assert.equal(graphemeCount("\ud83d\ude00x"), 2);
  } finally {
    (Intl as unknown as Record<string, unknown>).Segmenter = original;
  }
});
test("list handles own summaries, empty, malformed and forbidden responses", async () => {
  const row = { id: 1, name: "Mother's estate", updated_at: "2026-11-11", madhab: "hanafi", heir_count: 2, status: "draft" };
  const old = { id: 2, updated_at: "2026-11-11", madhab: "hanafi", heir_count: 2, status: "draft" };
  for (const cases of [[], [row], [old]]) {
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
  assert.equal(((await openSavedCase(signal(), 42, options)) as { id: string }).id, "fresh");
  globalThis.fetch = async () => new Response("", { status: 404 });
  assert.equal(await openSavedCase(signal(), 42, options), null);
});
test("open sends the optional check, and a 409 is a conflict outcome", async () => {
  const bodies: string[] = [];
  globalThis.fetch = async (_url, init) => { bodies.push(String(init?.body)); return new Response("{}", { status: 409 }); };
  assert.equal(await openSavedCase(signal(), 42, { ...options, check: { caseId: "c1", revision: 3 } }), OPEN_CONFLICT);
  assert.equal(await openSavedCase(signal(), 42, { ...options, check: { caseId: null, revision: null } }), OPEN_CONFLICT);
  assert.equal(await openSavedCase(signal(), 42, options), OPEN_CONFLICT);
  assert.deepEqual(bodies.map((b) => JSON.parse(b)), [{ case_id: "c1", expected_revision: 3 }, { case_id: null }, {}]);
});
test("a 409 whose case is null (no live case) is still a conflict", async () => {
  globalThis.fetch = async () => Response.json({ error: "conflict", case: null }, { status: 409 });
  assert.equal(await openSavedCase(signal(), 42, { ...options, check: { caseId: "gone", revision: 2 } }), OPEN_CONFLICT);
});

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { renameSavedCase, saveCase, createSavedCase, cutGraphemes, listSavedCases, openSavedCase, suggestedName, graphemeCount, OPEN_AUTH, OPEN_CONFLICT, SAVE_CONFLICT, SCHOOL_REQUIRED, NAME_TOO_LONG, NAME_INVALID } from "./saved-cases.ts";
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
  globalThis.fetch = async (_url, init) => { sent = String(init?.body); return Response.json({ code: "saved_case_conflict" }, { status: 409 }); };
  assert.equal(await saveCase(signal(), "live", { ...options, name: "Mother's estate" }), SAVE_CONFLICT);
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

test("a 401 or 403 on open is the auth outcome, a 404 stays a plain failure", async () => {
  for (const status of [401, 403]) {
    globalThis.fetch = async () => new Response("{}", { status });
    assert.equal(await openSavedCase(signal(), 42, options), OPEN_AUTH, String(status));
  }
  globalThis.fetch = async () => new Response("{}", { status: 404 });
  assert.equal(await openSavedCase(signal(), 42, options), null);
});

const CONFLICT_BODY = { error: "conflict", code: "saved_case_conflict", revision: 5, saved_id: 123, saved_name: "Test Case", working_case_id: "live", working_revision: 2 };
const CONFLICT = { code: SAVE_CONFLICT, savedId: 123, savedName: "Test Case", savedRevision: 5, workingCaseId: "live", workingRevision: 2 };
test("a complete 409 is a conflict with the stored case and the working copy it was shown against", async () => {
  globalThis.fetch = async () => Response.json(CONFLICT_BODY, { status: 409 });
  assert.deepEqual(await saveCase(signal(), "live", options), CONFLICT);
});
test("a 409 missing or mistyping any field is the text-only sentinel", async () => {
  for (const [field, value] of [["saved_id", undefined], ["saved_id", "123"], ["revision", 0], ["working_revision", 1.5], ["working_case_id", 7], ["saved_name", undefined]] as const) {
    globalThis.fetch = async () => Response.json({ ...CONFLICT_BODY, [field]: value }, { status: 409 });
    assert.equal(await saveCase(signal(), "live", options), SAVE_CONFLICT, `${field}=${String(value)}`);
  }
});
const args = { caseId: "live", expectedRevision: 2, savedId: 123, savedRevision: 5, requestKey: "3f2b8a5e-9d41-4c3a-8d0e-6a1b7c9d2e10" };
test("create sends the checked arguments and the request key to the create-only route", async () => {
  let seen: { url: string; init?: RequestInit } | null = null;
  globalThis.fetch = async (url, init) => { seen = { url: String(url), init }; return Response.json({ id: 9, name: "Copy", updated_at: "2026-11-26", revision: 1 }, { status: 201 }); };
  assert.deepEqual(await createSavedCase(signal(), { ...args, name: "Copy", locale: "fr" }, options), { id: 9, name: "Copy", updated_at: "2026-11-26", revision: 1 });
  assert.equal(seen!.url, "/api/v1/saved-cases/create/");
  assert.equal(seen!.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(seen!.init?.body)), { case_id: "live", expected_revision: 2, saved_id: 123, saved_revision: 5, request_key: args.requestKey, name: "Copy" });
  assert.equal((seen!.init?.headers as Record<string, string>)["Accept-Language"], "fr");
  assert.equal((seen!.init?.headers as Record<string, string>)["X-CSRFToken"], "token");
});
test("create omits an absent name, and a 200 replay is a success", async () => {
  let sent = "";
  globalThis.fetch = async (_url, init) => { sent = String(init?.body); return Response.json({ id: 9, name: "Copy", updated_at: "2026-11-26", revision: 1 }); };
  assert.equal(((await createSavedCase(signal(), args, options)) as { id: number }).id, 9);
  assert.equal("name" in JSON.parse(sent), false);
});
test("create tells every outcome apart", async () => {
  const answer = (status: number, body: unknown) => { globalThis.fetch = async () => Response.json(body, { status }); };
  answer(400, { code: "school_required" });
  assert.equal(await createSavedCase(signal(), args, options), SCHOOL_REQUIRED);
  answer(400, { errors: { name: "too_long" } });
  assert.equal(await createSavedCase(signal(), args, options), NAME_TOO_LONG);
  answer(400, { errors: { name: "invalid" } });
  assert.equal(await createSavedCase(signal(), args, options), NAME_INVALID);
  answer(400, { detail: "other" });
  assert.equal(await createSavedCase(signal(), args, options), null);
  answer(409, { code: "resolve_stale", conflict: CONFLICT_BODY, case: { id: "live", revision: 3, started_at: "now", heirs: [] } });
  const stale = (await createSavedCase(signal(), args, options)) as { stale: unknown; case: { revision: number } };
  assert.deepEqual(stale.stale, CONFLICT);
  assert.equal(stale.case.revision, 3);
  answer(409, { code: "resolve_stale", conflict: null, case: null });
  assert.deepEqual(await createSavedCase(signal(), args, options), { stale: null, case: null });
  answer(409, { detail: "something else" });
  assert.equal(await createSavedCase(signal(), args, options), null);
  for (const status of [404, 422, 503]) { answer(status, {}); assert.equal(await createSavedCase(signal(), args, options), null); }
  answer(201, { id: 9, name: "Copy", updated_at: "x" });
  assert.equal(await createSavedCase(signal(), args, options), null, "a success without the new revision is not a success");
  globalThis.fetch = async () => { throw new Error("offline"); };
  assert.equal(await createSavedCase(signal(), args, options), null);
});
test("open can return the 409 body's current case, and existing callers keep the bare conflict", async () => {
  globalThis.fetch = async () => Response.json({ error: "conflict", case: { id: "live", revision: 9, started_at: "now", heirs: [] } }, { status: 409 });
  const stale = (await openSavedCase(signal(), 42, { ...options, check: { caseId: "live", revision: 2 }, returnStale: true })) as { kind: string; case: { revision: number } };
  assert.equal(stale.kind, "stale");
  assert.equal(stale.case.revision, 9);
  assert.equal(await openSavedCase(signal(), 42, { ...options, check: { caseId: "live", revision: 2 } }), OPEN_CONFLICT);
  globalThis.fetch = async () => Response.json({ error: "conflict", case: null }, { status: 409 });
  assert.deepEqual(await openSavedCase(signal(), 42, { ...options, returnStale: true }), { kind: "stale", case: null });
});
test("cutGraphemes cuts by user-perceived characters", () => {
  assert.equal(cutGraphemes("abcdef", 3), "abc");
  assert.equal(cutGraphemes("ééé", 2), "éé");
  assert.equal(cutGraphemes("ab", 5), "ab");
});

test("list accepts a positive integer revision and drops any other", async () => {
  const base = { id: 1, name: "A", updated_at: "2026-11-11", madhab: "hanafi", heir_count: 2, status: "draft" };
  globalThis.fetch = async () => Response.json({ cases: [{ ...base, revision: 4 }, { ...base, id: 2 }, { ...base, id: 3, revision: 0 }, { ...base, id: 4, revision: "5" }, { ...base, id: 5, revision: 1.5 }] });
  const rows = await listSavedCases(signal());
  assert.deepEqual(rows.map((row) => row.revision), [4, undefined, undefined, undefined, undefined]);
});
test("rename posts the name and revision with the page Locale and returns the stored row", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "/api/v1/saved-cases/7/rename/");
    assert.equal(init?.method, "POST");
    assert.deepEqual(JSON.parse(String(init?.body)), { name: "أسرة", expected_revision: 3 });
    assert.equal((init?.headers as Record<string, string>)["Accept-Language"], "ar");
    assert.equal((init?.headers as Record<string, string>)["X-CSRFToken"], "token");
    return Response.json({ id: 7, name: "أسرة", updated_at: "2026-11-12", revision: 4 });
  };
  assert.deepEqual(await renameSavedCase(signal(), 7, { name: "أسرة", expectedRevision: 3, locale: "ar" }, options), { id: 7, name: "أسرة", updated_at: "2026-11-12", revision: 4 });
});
test("rename tells every outcome apart", async () => {
  const run = (response: () => Response) => { globalThis.fetch = async () => response(); return renameSavedCase(signal(), 7, { name: "x", expectedRevision: 3 }, options); };
  assert.equal(await run(() => Response.json({ errors: { name: "too_long" } }, { status: 400 })), NAME_TOO_LONG);
  assert.equal(await run(() => Response.json({ errors: { name: "invalid" } }, { status: 400 })), NAME_INVALID);
  assert.equal(await run(() => Response.json({ errors: { expected_revision: "invalid" } }, { status: 400 })), null);
  assert.deepEqual(await run(() => Response.json({ code: "rename_conflict", revision: 5, name: "Stored" }, { status: 409 })), { conflict: { revision: 5, name: "Stored" } });
  assert.equal(await run(() => Response.json({ code: "other" }, { status: 409 })), null);
  assert.equal(await run(() => Response.json({ code: "rename_conflict", revision: 0, name: "S" }, { status: 409 })), null);
  for (const status of [403, 404, 500]) assert.equal(await run(() => new Response("", { status })), null);
  assert.equal(await run(() => Response.json({ id: 7, updated_at: "x" })), null);
  globalThis.fetch = async () => { throw new Error("offline"); };
  assert.equal(await renameSavedCase(signal(), 7, { name: "x", expectedRevision: 3 }, options), null);
  assert.equal(await renameSavedCase(signal(), 0, { name: "x", expectedRevision: 3 }, options), null);
});

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { locales, messages } from "../i18n/messages.ts";
import {
  addHeir,
  fetchCase,
  fetchPreview,
  parsePreview,
  MADHAB_IDS,
  readCsrfToken,
  removeHeir,
  saveDeceased,
  setMadhab,
  startCase,
  updateHeir,
} from "./case.ts";

const realFetch = globalThis.fetch;

type Call = { url: unknown; init?: RequestInit };

function stubFetch(answer: (call: Call) => Promise<Response>): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = ((url: unknown, init?: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const CASE = { id: "abc123", started_at: "2026-11-06T10:00:00Z", madhab: null, deceased: null, heirs: [], heir_options: { blocked: [], invalid: {} } };
const signal = () => new AbortController().signal;
const withToken = { cookie: () => "other=1; csrftoken=tok%3D1" };
const header = (call: Call, name: string) => (call.init?.headers as Record<string, string>)[name];

test("readCsrfToken finds the cookie among others and decodes it", () => {
  assert.equal(readCsrfToken("a=1; csrftoken=abc%2B; b=2"), "abc+");
  assert.equal(readCsrfToken("a=1"), undefined);
});

test("fetchCase returns the case, or null when there is none", async () => {
  stubFetch(async () => Response.json({ case: CASE }));
  assert.deepEqual(await fetchCase(signal()), CASE);
  stubFetch(async () => Response.json({ case: null }));
  assert.equal(await fetchCase(signal()), null);
});

test("fetchCase rejects on a server error or a bad body", async () => {
  stubFetch(async () => new Response("", { status: 500 }));
  await assert.rejects(fetchCase(signal()));
  stubFetch(async () => Response.json({ nope: true }));
  await assert.rejects(fetchCase(signal()));
});

test("a hung read rejects at the timeout", async () => {
  stubFetch(
    ({ init }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  );
  await assert.rejects(fetchCase(signal(), { timeoutMs: 10 }));
});

test("startCase sends the CSRF token and returns the started case", async () => {
  const calls = stubFetch(async () => Response.json({ case: CASE }, { status: 201 }));
  assert.deepEqual(await startCase(signal(), withToken), { kind: "started", case: CASE });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/v1/case/");
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(header(calls[0], "X-CSRFToken"), "tok=1");
  assert.equal(calls[0].init?.body, "{}");
});

test("startCase asks to replace only when told to", async () => {
  const calls = stubFetch(async () => Response.json({ case: CASE }, { status: 201 }));
  await startCase(signal(), { ...withToken, replace: true });
  assert.equal(calls[0].init?.body, '{"replace":true}');
});

test("startCase probes the session first when there is no CSRF cookie", async () => {
  let cookie = "";
  const calls = stubFetch(async ({ url }) => {
    if (url === "/api/v1/session/") {
      cookie = "csrftoken=issued";
      return Response.json({ authenticated: false });
    }
    return Response.json({ case: CASE }, { status: 201 });
  });
  const result = await startCase(signal(), { cookie: () => cookie });
  assert.equal(result.kind, "started");
  assert.deepEqual(
    calls.map((call) => call.url),
    ["/api/v1/session/", "/api/v1/case/"],
  );
  assert.equal(header(calls[1], "X-CSRFToken"), "issued");
});

test("startCase reports an existing case on 409 and throttling on 429", async () => {
  stubFetch(async () => Response.json({ case: CASE }, { status: 409 }));
  assert.deepEqual(await startCase(signal(), withToken), { kind: "exists", case: CASE });
  stubFetch(async () => Response.json({ detail: "slow" }, { status: 429 }));
  assert.deepEqual(await startCase(signal(), withToken), { kind: "throttled" });
});

const failures: Record<string, () => Promise<Response>> = {
  "a network failure": async () => {
    throw new TypeError("fetch failed");
  },
  "a CSRF rejection": async () => new Response("{}", { status: 403 }),
  "a server error": async () => new Response("", { status: 503 }),
  "an unexpected body": async () => Response.json({ case: 5 }, { status: 201 }),
};

for (const [name, answer] of Object.entries(failures)) {
  test(`${name} reports failed after exactly one attempt`, async () => {
    const calls = stubFetch(answer);
    assert.deepEqual(await startCase(signal(), withToken), { kind: "failed" });
    assert.equal(calls.length, 1);
  });
}

test("a hung API reports failed at the timeout", async () => {
  stubFetch(
    ({ init }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  );
  assert.deepEqual(await startCase(signal(), { ...withToken, timeoutMs: 10 }), { kind: "failed" });
});

function strings(value: unknown, path: string): [string, string][] {
  if (typeof value === "string") return [[path, value]];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, inner]) =>
    strings(inner, `${path}.${key}`),
  );
}

test("every locale has its own interview text", () => {
  const byLocale = locales.map((locale) => new Map(strings(messages[locale].interview, "interview")));
  for (const path of byLocale[0].keys()) {
    const texts = byLocale.map((map) => map.get(path));
    assert.ok(texts.every((text) => typeof text === "string" && text.length > 0), path);
    assert.ok(new Set(texts).size >= 2, path);
  }
  assert.ok(byLocale[0].has("interview.madhabs.hanbali.name"));
  for (const key of ["treeHeading", "treeDeceasedMale", "treeDeceasedFemale", "treePrompt", "treeSummary", "treeCount"]) {
    assert.ok(byLocale[0].has(`interview.${key}`), key);
  }
  for (const locale of locales) {
    const template = messages[locale].interview.treeSummary;
    assert.ok(template.includes("{deceased}") && template.includes("{heirs}"), locale);
    const count = messages[locale].interview.treeCount;
    assert.ok(count.includes("{relationship}") && count.includes("{n}"), locale);
  }
  assert.deepEqual(
    byLocale.map((map) => [...map.keys()].sort()),
    byLocale.map(() => [...byLocale[0].keys()].sort()),
  );
});

test("every madhab has a name and a description in every locale", () => {
  for (const locale of locales) {
    assert.deepEqual(Object.keys(messages[locale].interview.madhabs), [...MADHAB_IDS]);
  }
});

test("parseCase reads a missing or unknown madhab as none and keeps a known one", async () => {
  for (const [madhab, expected] of [
    [undefined, null],
    ["zaydi", null],
    [4, null],
    ["jafari", "jafari"],
  ] as const) {
    stubFetch(async () => Response.json({ case: { ...CASE, madhab } }));
    assert.equal((await fetchCase(signal()))?.madhab, expected, String(madhab));
  }
});

test("setMadhab patches with the CSRF token, the school and the case id", async () => {
  const chosen = { ...CASE, madhab: "hanafi" };
  const calls = stubFetch(async () => Response.json({ case: chosen }));
  assert.deepEqual(await setMadhab(signal(), "hanafi", "abc123", withToken), {
    kind: "updated",
    case: chosen,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init?.method, "PATCH");
  assert.equal(header(calls[0], "X-CSRFToken"), "tok=1");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { madhab: "hanafi", case_id: "abc123" });
});

test("setMadhab maps 404, 409 and 429", async () => {
  stubFetch(async () => Response.json({ detail: "x" }, { status: 404 }));
  assert.deepEqual(await setMadhab(signal(), "hanafi", "abc123", withToken), { kind: "gone" });
  stubFetch(async () => Response.json({ case: CASE }, { status: 409 }));
  assert.deepEqual(await setMadhab(signal(), "hanafi", "abc123", withToken), {
    kind: "replaced",
    case: { ...CASE, madhab: null },
  });
  stubFetch(async () => Response.json({ detail: "slow" }, { status: 429 }));
  assert.deepEqual(await setMadhab(signal(), "hanafi", "abc123", withToken), { kind: "throttled" });
});

test("setMadhab probes the session first when there is no CSRF cookie", async () => {
  let cookie = "";
  const calls = stubFetch(async ({ url }) => {
    if (url === "/api/v1/session/") {
      cookie = "csrftoken=issued";
      return Response.json({ authenticated: false });
    }
    return Response.json({ case: CASE });
  });
  assert.equal((await setMadhab(signal(), "maliki", "abc123", { cookie: () => cookie })).kind, "updated");
  assert.deepEqual(calls.map((call) => call.url), ["/api/v1/session/", "/api/v1/case/"]);
});

for (const [name, answer] of Object.entries(failures)) {
  test(`setMadhab: ${name} reports failed after exactly one attempt`, async () => {
    const calls = stubFetch(answer);
    assert.deepEqual(await setMadhab(signal(), "hanafi", "abc123", withToken), { kind: "failed" });
    assert.equal(calls.length, 1);
  });
}

test("a hung PATCH reports failed at the timeout", async () => {
  stubFetch(
    ({ init }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      }),
  );
  assert.deepEqual(await setMadhab(signal(), "hanafi", "abc123", { ...withToken, timeoutMs: 10 }), { kind: "failed" });
});

const FULL_CASE = {
  ...CASE,
  madhab: "hanafi",
  deceased: { gender: "male", estate: "1250.5" },
  heirs: [{ id: "h1", relationship: "son", gender: "male", name: null }],
};

test("parseCase reads deceased and heirs, and tolerates the older shape", async () => {
  stubFetch(async () => Response.json({ case: FULL_CASE }));
  assert.deepEqual(await fetchCase(signal()), FULL_CASE);
  stubFetch(async () => Response.json({ case: { id: "a", started_at: "t" } }));
  assert.deepEqual(await fetchCase(signal()), {
    id: "a",
    started_at: "t",
    madhab: null,
    deceased: null,
    heirs: [],
    heir_options: { blocked: [], invalid: {} },
  });
  stubFetch(async () =>
    Response.json({
      case: {
        ...CASE,
        deceased: { gender: "other", estate: "5" },
        heirs: [
          { id: "h1", relationship: "cousin", gender: "male", name: null },
          { id: 2, relationship: "son", gender: "male", name: null },
          "text",
          { id: "h3", relationship: "wife", gender: "female", name: 5 },
        ],
      },
    }),
  );
  const tolerated = await fetchCase(signal());
  assert.equal(tolerated?.deceased, null);
  assert.deepEqual(tolerated?.heirs, [{ id: "h3", relationship: "wife", gender: "female", name: null }]);
});

test("saveDeceased puts the fields and the case id to its own URL", async () => {
  const calls = stubFetch(async () => Response.json({ case: FULL_CASE }));
  const result = await saveDeceased(signal(), "abc123", { gender: "male", estate: "5" }, withToken);
  assert.deepEqual(result, { kind: "saved", case: FULL_CASE });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/v1/case/deceased/");
  assert.equal(calls[0].init?.method, "PUT");
  assert.equal(header(calls[0], "X-CSRFToken"), "tok=1");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { gender: "male", estate: "5", case_id: "abc123" });
});

test("addHeir posts, updateHeir puts and removeHeir deletes, each with the case id", async () => {
  const calls = stubFetch(async () => Response.json({ case: FULL_CASE }, { status: 201 }));
  await addHeir(signal(), "abc123", { relationship: "son", name: "A" }, withToken);
  await updateHeir(signal(), "abc123", "h 1", { relationship: "wife", name: null }, withToken);
  await removeHeir(signal(), "abc123", "h1", withToken);
  assert.deepEqual(
    calls.map((call) => [call.init?.method, call.url]),
    [
      ["POST", "/api/v1/case/heirs/"],
      ["PUT", "/api/v1/case/heirs/h%201/"],
      ["DELETE", "/api/v1/case/heirs/h1/?case_id=abc123"],
    ],
  );
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { relationship: "son", name: "A", case_id: "abc123" });
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { relationship: "wife", name: null, case_id: "abc123" });
  assert.equal(calls[2].init?.body, undefined, "a DELETE body may be dropped on the way, so there is none");
});

test("answer writes map 400, 404, 409 and 429", async () => {
  const send = () => addHeir(signal(), "abc123", { relationship: "son", name: null }, withToken);
  stubFetch(async () => Response.json({ errors: { name: "too_long", x: 5 } }, { status: 400 }));
  assert.deepEqual(await send(), { kind: "invalid", errors: { name: "too_long" } });
  stubFetch(async () => Response.json({ detail: "bad" }, { status: 400 }));
  assert.deepEqual(await send(), { kind: "failed" }, "a 400 with no field errors is a failure");
  stubFetch(async () => Response.json({ detail: "x", case: null }, { status: 404 }));
  assert.deepEqual(await send(), { kind: "gone" });
  stubFetch(async () => Response.json({ detail: "x", case: FULL_CASE }, { status: 404 }));
  assert.deepEqual(await send(), { kind: "missing", case: FULL_CASE });
  stubFetch(async () => Response.json({ detail: "x", case: FULL_CASE }, { status: 409 }));
  assert.deepEqual(await send(), { kind: "replaced", case: FULL_CASE });
  stubFetch(async () => Response.json({ detail: "slow" }, { status: 429 }));
  assert.deepEqual(await send(), { kind: "throttled" });
  stubFetch(async () => new Response("", { status: 403 }));
  assert.deepEqual(await send(), { kind: "failed" });
});

test("answer writes make exactly one attempt and report failure", async () => {
  const calls = stubFetch(async () => {
    throw new TypeError("fetch failed");
  });
  assert.deepEqual(await removeHeir(signal(), "abc123", "h1", withToken), { kind: "failed" });
  assert.equal(calls.length, 1);
  stubFetch(
    ({ init }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  );
  assert.deepEqual(
    await saveDeceased(signal(), "abc123", { gender: "male", estate: null }, { ...withToken, timeoutMs: 10 }),
    { kind: "failed" },
  );
});

test("startCase names the case being replaced, and only when replacing", async () => {
  const calls = stubFetch(async () => Response.json({ case: CASE }, { status: 201 }));
  await startCase(signal(), { ...withToken, replace: true, caseId: "abc123" });
  await startCase(signal(), { ...withToken, caseId: "abc123" });
  await startCase(signal(), { ...withToken, replace: true });
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { replace: true, case_id: "abc123" });
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), {});
  assert.deepEqual(JSON.parse(String(calls[2].init?.body)), { replace: true });
});

test("parseCase drops an estate that is not a stored amount, so it never renders as NaN", async () => {
  for (const [estate, expected] of [
    ["NaN", null], ["1e5", null], ["007", null], ["-5", null], ["1.234", null], ["", null],
    ["1234567890123456", null], ["0.50", "0.50"], ["7", "7"], ["999999999999999.99", "999999999999999.99"],
  ] as const) {
    stubFetch(async () => Response.json({ case: { ...CASE, deceased: { gender: "male", estate } } }));
    assert.equal((await fetchCase(signal()))?.deceased?.estate, expected, estate);
  }
});

const BASIS = { madhab: "hanbali", gender: "male", estate: "8000", heirs: [{ id: "a1", relationship: "wife" }] };

const AVAILABLE = {
  status: "available",
  madhab: "hanbali",
  basis: BASIS,
  shares: [{ heir_id: "a1", numerator: 1, denominator: 8, blocked: false, amount: "1000.00" }],
  unallocated: null,
};

test("fetchPreview makes one read with the case id and returns the typed preview", async () => {
  const calls = stubFetch(async () => Response.json(AVAILABLE));
  assert.deepEqual(await fetchPreview(signal(), "a b"), { kind: "preview", preview: AVAILABLE });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/v1/case/preview/?case_id=a%20b");
  assert.equal(calls[0].init?.method, undefined);
  assert.equal(header(calls[0], "X-CSRFToken"), undefined);
});

test("fetchPreview reads each status", async () => {
  const cases: [number, unknown, unknown][] = [
    [200, { status: "not_ready" }, { kind: "preview", preview: { status: "not_ready" } }],
    [
      200,
      { status: "unavailable", madhab: "jafari", reason: "school_not_supported", basis: BASIS },
      {
        kind: "preview",
        preview: { status: "unavailable", madhab: "jafari", reason: "school_not_supported", basis: BASIS },
      },
    ],
    [429, { detail: "x" }, { kind: "throttled" }],
    [404, { detail: "x", case: null }, { kind: "gone" }],
    [409, { detail: "x", case: CASE }, { kind: "replaced" }],
    [500, { detail: "x" }, { kind: "failed" }],
    [503, { detail: "x" }, { kind: "failed" }],
  ];
  for (const [status, body, expected] of cases) {
    stubFetch(async () => Response.json(body, { status }));
    assert.deepEqual(await fetchPreview(signal(), "abc"), expected, String(status));
  }
});

test("fetchPreview never throws: a network error, bad JSON or a bad body is a failure", async () => {
  stubFetch(async () => {
    throw new TypeError("network");
  });
  assert.deepEqual(await fetchPreview(signal(), "abc"), { kind: "failed" });
  stubFetch(async () => new Response("not json"));
  assert.deepEqual(await fetchPreview(signal(), "abc"), { kind: "failed" });
  stubFetch(async () => Response.json({ status: "available" }));
  assert.deepEqual(await fetchPreview(signal(), "abc"), { kind: "failed" });
});

test("a hung preview fails at the timeout, and an aborted one fails at once", async () => {
  const hang = ({ init }: Call) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
  stubFetch(hang);
  assert.deepEqual(await fetchPreview(signal(), "abc", { timeoutMs: 10 }), { kind: "failed" });
  const own = new AbortController();
  stubFetch(hang);
  const pending = fetchPreview(own.signal, "abc", { timeoutMs: 60_000 });
  own.abort();
  assert.deepEqual(await pending, { kind: "failed" });
});

test("parsePreview rejects anything but the exact shape", () => {
  assert.deepEqual(parsePreview(AVAILABLE), AVAILABLE);
  const share = AVAILABLE.shares[0];
  const bad: unknown[] = [
    null,
    "x",
    {},
    { status: "other", madhab: "hanbali" },
    { ...AVAILABLE, madhab: "zaydi" },
    { ...AVAILABLE, madhab: undefined },
    { ...AVAILABLE, shares: "x" },
    { ...AVAILABLE, unallocated: undefined },
    { ...AVAILABLE, unallocated: { numerator: 1 } },
    { ...AVAILABLE, unallocated: { numerator: 5, denominator: 4 } },
    { ...AVAILABLE, shares: [{ ...share, denominator: 0 }] },
    { ...AVAILABLE, shares: [{ ...share, numerator: -1 }] },
    { ...AVAILABLE, shares: [{ ...share, numerator: 9 }] },
    { ...AVAILABLE, shares: [{ ...share, numerator: 0.5 }] },
    { ...AVAILABLE, shares: [{ ...share, numerator: "1" }] },
    { ...AVAILABLE, shares: [{ ...share, blocked: "no" }] },
    { ...AVAILABLE, shares: [{ ...share, heir_id: 5 }] },
    { ...AVAILABLE, shares: [{ ...share, amount: "1000" }] },
    { ...AVAILABLE, shares: [{ ...share, amount: "NaN" }] },
    { ...AVAILABLE, shares: [{ ...share, amount: 1000 }] },
    { ...AVAILABLE, shares: [{ ...share, amount: undefined }] },
    { ...AVAILABLE, basis: undefined },
    { ...AVAILABLE, basis: { ...BASIS, madhab: "zaydi" } },
    { ...AVAILABLE, basis: { ...BASIS, gender: "x" } },
    { ...AVAILABLE, basis: { ...BASIS, estate: "1,5" } },
    { ...AVAILABLE, basis: { ...BASIS, heirs: [{ id: "a1", relationship: "cousin" }] } },
    { ...AVAILABLE, basis: { ...BASIS, heirs: [{ id: 1, relationship: "wife" }] } },
    { status: "unavailable", madhab: "jafari", reason: "", basis: BASIS },
    { status: "unavailable", madhab: "jafari", reason: 5, basis: BASIS },
    { status: "unavailable", madhab: "jafari", reason: "made_up" },
    { status: "unavailable", madhab: "jafari", basis: BASIS },
  ];
  for (const body of bad) assert.equal(parsePreview(body), null, JSON.stringify(body));
  assert.deepEqual(parsePreview({ ...AVAILABLE, shares: [{ ...share, amount: null }] })?.status, "available");
  assert.deepEqual(parsePreview({ ...AVAILABLE, basis: { ...BASIS, estate: null } })?.status, "available");
  // A reason added to the engine later is accepted, and shown with the generic text alone.
  assert.deepEqual(parsePreview({ status: "unavailable", madhab: "jafari", reason: "made_up", basis: BASIS }), {
    status: "unavailable",
    madhab: "jafari",
    reason: "made_up",
    basis: BASIS,
  });
});

test("every locale has the preview text", () => {
  for (const locale of locales) {
    const text = messages[locale].interview;
    assert.ok(text.previewSchool.includes("{school}"), locale);
    for (const key of ["previewHeading", "previewPrompt", "previewWaiting", "previewUpdated", "previewUnavailable", "previewFailed", "previewThrottled", "previewGone", "previewExpired", "previewRetry"] as const) {
      assert.ok(text[key].length > 0, `${locale} ${key}`);
    }
  }
});

test("heir_options is read strictly: anything malformed reads as nothing hidden", async () => {
  const good = { blocked: ["brother", "sister"], invalid: { father: "second_father" } };
  stubFetch(async () => Response.json({ case: { ...CASE, heir_options: good } }));
  assert.deepEqual((await fetchCase(signal()))?.heir_options, good);
  const bad: unknown[] = [
    null,
    "brother",
    [],
    {},
    { blocked: "brother", invalid: {} },
    { blocked: ["cousin"], invalid: {} },
    { blocked: [1], invalid: {} },
    { blocked: ["brother"] },
    { blocked: ["brother"], invalid: [] },
    { blocked: ["brother"], invalid: { cousin: "second_father" } },
    { blocked: ["brother"], invalid: { father: 1 } },
    { blocked: ["brother"], invalid: { father: "" } },
    { blocked: ["brother"], invalid: { father: "second_cousin" } },
    { blocked: ["brother"], invalid: { father: "blocked" } },
    { blocked: ["father"], invalid: { father: "second_father" } },
  ];
  for (const value of bad) {
    stubFetch(async () => Response.json({ case: { ...CASE, heir_options: value } }));
    assert.deepEqual((await fetchCase(signal()))?.heir_options, { blocked: [], invalid: {} }, JSON.stringify(value));
  }
});

test("each read of missing options is a fresh object", async () => {
  stubFetch(async () => Response.json({ case: { ...CASE, heir_options: null } }));
  const first = (await fetchCase(signal()))!.heir_options;
  first.blocked.push("brother");
  const second = (await fetchCase(signal()))!.heir_options;
  assert.deepEqual(second, { blocked: [], invalid: {} });
});

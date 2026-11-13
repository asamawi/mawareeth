import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { locales, messages } from "../i18n/messages.ts";
import {
  addHeir,
  fetchCase,
  fetchPreview,
  markDeceased,
  unmarkDeceased,
  noHeirOptions,
  parseCase,
  parseHeirOptions,
  parsePreview,
  parseQuestions,
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

const CASE = { id: "abc123", started_at: "2026-11-06T10:00:00Z", madhab: null, deceased: null, heirs: [], heir_options: { blocked: [], invalid: {} }, deaths: [] };
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

test("parseCase preserves edit_options on heirs and falls back to noHeirOptions() for malformed ones", () => {
  const validEditOptions = { blocked: [], invalid: { father: "second_father" } };
  const caseWithEditOptions = {
    case: {
      ...CASE,
      heirs: [
        { id: "h1", relationship: "son", gender: "male", name: null, edit_options: validEditOptions },
        { id: "h2", relationship: "daughter", gender: "female", name: null, edit_options: { blocked: ["bad_value"], invalid: {} } },
        { id: "h3", relationship: "mother", gender: "female", name: null },
      ],
    },
  };
  const parsed = parseCase(caseWithEditOptions);
  assert.ok(parsed !== null);
  assert.deepEqual(parsed!.heirs[0].edit_options, validEditOptions);
  // Malformed edit_options (bad blocked value) reads as noHeirOptions().
  assert.deepEqual(parsed!.heirs[1].edit_options, noHeirOptions());
  // Missing edit_options reads as noHeirOptions().
  assert.deepEqual(parsed!.heirs[2].edit_options, noHeirOptions());
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
    // Strings that are only placeholders and punctuation, such as "{label} ({order})",
    // have nothing to translate and may match across locales.
    const translatable = /\p{L}/u.test(String(texts[0]).replace(/\{[^}]*\}/g, ""));
    for (let i = 0; translatable && i < locales.length; i++) {
      for (let j = i + 1; j < locales.length; j++) {
        assert.notEqual(byLocale[i].get(path), byLocale[j].get(path), `${path} [${locales[i]} vs ${locales[j]}]`);
      }
    }
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
  heirs: [{ id: "h1", relationship: "son", gender: "male", name: null, edit_options: noHeirOptions() }],
};

test("parseCase reads deceased and heirs, and tolerates the older shape", async () => {
  stubFetch(async () => Response.json({ case: { ...FULL_CASE, deaths: [{ unknown: true }] } }));
  assert.deepEqual(await fetchCase(signal()), FULL_CASE);
  stubFetch(async () => Response.json({ case: { id: "a", started_at: "t" } }));
  assert.deepEqual(await fetchCase(signal()), {
    id: "a",
    started_at: "t",
    madhab: null,
    deceased: null,
    heirs: [],
    heir_options: { blocked: [], invalid: {} },
    deaths: [],
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
  assert.deepEqual(tolerated?.heirs, [{ id: "h3", relationship: "wife", gender: "female", name: null, edit_options: noHeirOptions() }]);
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

test("fetchPreview makes one read with the case id and returns the typed preview", async () => {
  const calls = stubFetch(async () => Response.json(AVAILABLE));
  assert.deepEqual(await fetchPreview(signal(), "a b"), { kind: "preview", preview: AVAILABLE });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/v1/case/preview/?case_id=a%20b");
  assert.equal(calls[0].init?.method, undefined);
  assert.equal(header(calls[0], "X-CSRFToken"), undefined);
  assert.equal(header(calls[0], "Accept-Language"), undefined);
});

test("fetchPreview asks for the page's language, so labels follow the page and not the browser", async () => {
  const calls = stubFetch(async () => Response.json(AVAILABLE));
  await fetchPreview(signal(), "abc", { locale: "ar" });
  assert.equal(header(calls[0], "Accept-Language"), "ar");
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


test("parsePreview rejects a bad table, never repairs it", () => {
  const two = {
    ...AVAILABLE,
    shares: [
      AVAILABLE.shares[0],
      { heir_id: "a2", numerator: 7, denominator: 8, blocked: false, amount: "7000.00" },
    ],
    basis: { ...BASIS, heirs: [...BASIS.heirs, { id: "a2", relationship: "son" }] },
    proof: { ...AVAILABLE.proof, heirs: [...AVAILABLE.proof.heirs, { ...AVAILABLE.proof.heirs[0], heir: "a2", share: { numerator: 7, denominator: 8 } }] },
  };
  const row = (heir: string, cells: unknown[], extra: object = {}) => ({
    heir, blocked: false, group_span: heir === "a1" ? 2 : 0, prescribed: null, cells, ...extra,
  });
  const base = { code: "base", total: 8, label: "Shares" };
  const good = {
    columns: [base, { code: "correction", total: 24, label: "Correction" }],
    rows: [
      row("a1", [{ value: 7, span: 2 }, { value: 3, span: 1 }]),
      row("a2", [{ value: 7, span: 0 }, { value: 21, span: 1 }]),
    ],
  };
  assert.equal(parsePreview({ ...two, table: good })?.status, "available");
  const only = (patch: object) => ({ ...two, table: { ...good, ...patch } });
  const bad: [string, unknown][] = [
    ["missing group span", only({ rows: [Object.fromEntries(Object.entries(good.rows[0]).filter(([key]) => key !== "group_span")), good.rows[1]] })],
    ["fractional group span", only({ rows: [{ ...good.rows[0], group_span: 1.5 }, good.rows[1]] })],
    ["negative group span", only({ rows: [{ ...good.rows[0], group_span: -1 }, good.rows[1]] })],
    ["string group span", only({ rows: [{ ...good.rows[0], group_span: "2" }, good.rows[1]] })],
    ["first group row covered", only({ rows: [{ ...good.rows[0], group_span: 0 }, good.rows[1]] })],
    ["group exceeds rows", only({ rows: [{ ...good.rows[0], group_span: 3 }, good.rows[1]] })],
    ["group interrupted", only({ rows: [good.rows[0], { ...good.rows[1], group_span: 1 }] })],
    ["extra covered group row", only({ rows: [{ ...good.rows[0], group_span: 1 }, good.rows[1]] })],
    ["different prescribed fractions", only({ rows: [{ ...good.rows[0], prescribed: { numerator: 1, denominator: 8 } }, { ...good.rows[1], prescribed: { numerator: 1, denominator: 4 } }] })],
    ["fraction and residuary in one group", only({ rows: [{ ...good.rows[0], prescribed: { numerator: 1, denominator: 8 } }, good.rows[1]] })],
    ["missing", Object.fromEntries(Object.entries(two).filter(([key]) => key !== "table"))],
    ["null on a single death", { ...two, table: null }],
    ["extra key", only({ extra: 1 })],
    ["unknown column", only({ columns: [base, { code: "bogus", total: 5, label: "x" }] })],
    ["first not base", only({ columns: [{ code: "awl", total: 8, label: "x" }], rows: [] })],
    ["out of order", only({ columns: [{ code: "correction", total: 24, label: "C" }, base] })],
    ["both shortage columns", only({ columns: [base, { code: "radd", total: 8, label: "R" }, { code: "remainder", total: 8, label: "S" }] })],
    ["duplicate column", only({ columns: [base, base] })],
    ["total zero", only({ columns: [{ ...base, total: 0 }, good.columns[1]] })],
    ["total fractional", only({ columns: [{ ...base, total: 2.5 }, good.columns[1]] })],
    ["total string", only({ columns: [{ ...base, total: "8" }, good.columns[1]] })],
    ["empty label", only({ columns: [{ ...base, label: "" }, good.columns[1]] })],
    ["no columns", only({ columns: [], rows: [] })],
    ["fewer rows than shares", only({ rows: [good.rows[0]] })],
    ["unknown heir", only({ rows: [good.rows[0], row("zz", [{ value: 7, span: 0 }, { value: 1, span: 1 }])] })],
    ["duplicate heir", only({ rows: [good.rows[0], { ...good.rows[0] }] })],
    ["wrong cell count", only({ rows: [row("a1", [{ value: 7, span: 2 }]), good.rows[1]] })],
    ["bad prescribed", only({ rows: [{ ...good.rows[0], prescribed: { numerator: 2, denominator: 1 } }, good.rows[1]] })],
    ["negative value", only({ rows: [row("a1", [{ value: -1, span: 2 }, { value: 3, span: 1 }]), good.rows[1]] })],
    ["null value on a live heir", only({ rows: [row("a1", [{ value: null, span: 2 }, { value: 3, span: 1 }]), good.rows[1]] })],
    ["value on a blocked heir", only({ rows: [good.rows[0], { ...good.rows[1], blocked: true }] })],
    ["extra row key", only({ rows: [{ ...good.rows[0], x: 1 }, good.rows[1]] })],
    ["extra cell key", only({ rows: [row("a1", [{ value: 7, span: 2, x: 1 }, { value: 3, span: 1 }]), good.rows[1]] })],
    ["span longer than the rows", only({ rows: [row("a1", [{ value: 7, span: 3 }, { value: 3, span: 1 }]), good.rows[1]] })],
    ["covered row with its own span", only({ rows: [good.rows[0], row("a2", [{ value: 7, span: 1 }, { value: 21, span: 1 }])] })],
    ["covered row with another value", only({ rows: [good.rows[0], row("a2", [{ value: 6, span: 0 }, { value: 21, span: 1 }])] })],
    ["first row covered", only({ rows: [row("a1", [{ value: 7, span: 0 }, { value: 3, span: 1 }]), good.rows[1]] })],
    ["negative span", only({ rows: [row("a1", [{ value: 7, span: -1 }, { value: 3, span: 1 }]), good.rows[1]] })],
  ];
  for (const [name, body] of bad) assert.equal(parsePreview(body), null, name);
  // akdariyya: two heirs keep their own prescribed shares while their share cell is pooled
  const pooled = only({
    rows: [
      { ...good.rows[0], group_span: 1, prescribed: { numerator: 1, denominator: 6 } },
      { ...good.rows[1], group_span: 1, prescribed: { numerator: 1, denominator: 2 } },
    ],
  });
  assert.equal(parsePreview(pooled)?.status, "available");
});

test("parsePreview checks a table against the shares and the columns the engine can give", () => {
  const two = {
    ...AVAILABLE,
    shares: [
      AVAILABLE.shares[0],
      { heir_id: "a2", numerator: 7, denominator: 8, blocked: false, amount: "7000.00" },
    ],
    basis: { ...BASIS, heirs: [...BASIS.heirs, { id: "a2", relationship: "son" }] },
    proof: { ...AVAILABLE.proof, heirs: [...AVAILABLE.proof.heirs, { ...AVAILABLE.proof.heirs[0], heir: "a2", share: { numerator: 7, denominator: 8 } }] },
  };
  // every column totals 8, so each cell is the share in eighths
  const table = (codes: string[], values: [number, number] = [1, 7]) => ({
    columns: codes.map((code) => ({ code, total: 8, label: code })),
    rows: [
      { heir: "a1", blocked: false, group_span: 1, prescribed: null, cells: codes.map(() => ({ value: values[0], span: 1 })) },
      { heir: "a2", blocked: false, group_span: 1, prescribed: null, cells: codes.map(() => ({ value: values[1], span: 1 })) },
    ],
  });
  const ok: string[][] = [
    ["base"], ["base", "awl"], ["base", "radd"], ["base", "remainder"], ["base", "correction"],
    ["base", "radd", "radd_calc", "radd_union", "correction"],
  ];
  for (const codes of ok) assert.equal(parsePreview({ ...two, table: table(codes) })?.status, "available", codes.join());
  const impossible: string[][] = [
    ["base", "awl", "radd"],
    ["base", "awl", "remainder"],
    ["base", "radd", "remainder"],
    ["base", "radd_calc", "radd_union"],
    ["base", "remainder", "radd_calc", "radd_union"],
    ["base", "radd", "radd_calc"],
    ["base", "radd", "radd_union"],
  ];
  for (const codes of impossible) assert.equal(parsePreview({ ...two, table: table(codes) }), null, codes.join());

  // a row is blocked only when the proof says so, and then its share is blocked too
  const nothing = { numerator: 0, denominator: 1 };
  const second = (rule: string, blocked: boolean) => ({
    ...two,
    shares: [two.shares[0], { ...two.shares[1], ...nothing, blocked, amount: "0.00" }],
    proof: {
      ...two.proof,
      heirs: [two.proof.heirs[0], { ...two.proof.heirs[1], rule, share: nothing }],
    },
  });
  const empty = { value: null as never, span: 1 };
  const blockedRow = table(["base"]);
  blockedRow.rows[1] = { ...blockedRow.rows[1], blocked: true, cells: [empty] };
  assert.equal(parsePreview({ ...second("blocked", true), table: blockedRow })?.status, "available");
  for (const group_span of [0, 2]) {
    const rows = [blockedRow.rows[0], { ...blockedRow.rows[1], group_span }];
    assert.equal(parsePreview({ ...second("blocked", true), table: { ...blockedRow, rows } }), null);
  }
  const blockedInGroup = {
    ...blockedRow,
    rows: [{ ...blockedRow.rows[0], group_span: 2 }, { ...blockedRow.rows[1], group_span: 0 }],
  };
  assert.equal(parsePreview({ ...second("blocked", true), table: blockedInGroup }), null);
  // blocked in the table but not in the proof, or the other way round
  assert.equal(parsePreview({ ...second("fixed", true), table: blockedRow }), null);
  assert.equal(parsePreview({ ...second("blocked", true), table: table(["base"], [1, 0]) }), null);
  // a blocked row whose share is not blocked
  assert.equal(parsePreview({ ...second("blocked", false), table: blockedRow }), null);
  // a residuary left nothing: not blocked, share 0, every cell 0
  assert.equal(parsePreview({ ...second("residuary", true), table: table(["base"], [1, 0]) })?.status, "available");
  assert.equal(parsePreview({ ...second("residuary", true), table: table(["base", "correction"], [1, 0]) })?.status, "available");
  assert.equal(parsePreview({ ...second("residuary", true), table: blockedRow }), null);
  const bad = table(["base"], [1, 1]);
  assert.equal(parsePreview({ ...second("residuary", true), table: bad }), null);
  // a share of more than nothing cannot be flagged blocked on a live row
  const flaggedShare = { ...two, shares: [two.shares[0], { ...two.shares[1], blocked: true }] };
  assert.equal(parsePreview({ ...flaggedShare, table: table(["base"]) }), null);

  // the last column is the share, in the column's own total
  assert.equal(parsePreview({ ...two, table: table(["base"], [2, 6]) }), null);
  assert.equal(parsePreview({ ...two, table: table(["base", "correction"], [1, 6]) }), null);
  // a merged final cell is the sum of the rows it covers
  const merged = (value: number) => ({
    columns: [{ code: "base", total: 8, label: "Shares" }],
    rows: [
      { heir: "a1", blocked: false, group_span: 2, prescribed: null, cells: [{ value, span: 2 }] },
      { heir: "a2", blocked: false, group_span: 0, prescribed: null, cells: [{ value, span: 0 }] },
    ],
  });
  assert.equal(parsePreview({ ...two, table: merged(8) })?.status, "available");
  assert.equal(parsePreview({ ...two, table: merged(7) }), null);
  // a spouse alone leaves an unallocated part: 1/4 of the estate is 1 of 4 parts
  const alone = {
    ...AVAILABLE,
    shares: [{ ...AVAILABLE.shares[0], numerator: 1, denominator: 4 }],
    unallocated: { numerator: 3, denominator: 4 },
    proof: { ...AVAILABLE.proof, heirs: [{ ...AVAILABLE.proof.heirs[0], share: { numerator: 1, denominator: 4 } }] },
    table: {
      columns: [{ code: "base", total: 4, label: "Shares" }],
      rows: [{ heir: "a1", blocked: false, group_span: 1, prescribed: { numerator: 1, denominator: 4 }, cells: [{ value: 1, span: 1 }] }],
    },
  };
  assert.equal(parsePreview(alone)?.status, "available");
});

test("layered previews preserve strict death records and require an explicit proof", () => {
  const deaths = [{ heir_id: "a1", order: 2, heirs: [
    { id: "b1", relationship: "son", same_as: "a2" },
    { id: "b2", relationship: "mother" },
  ] }];
  const body = { ...AVAILABLE, proof: null, table: null, basis: { ...BASIS, deaths } };
  assert.equal(parsePreview(body), null);
  assert.equal(parsePreview({ ...body, table: AVAILABLE.table }), null);
  const malformed: unknown[] = [
    null, {}, [], [null], [deaths[0], deaths[0], deaths[0]],
    [{ ...deaths[0], heir_id: 1 }],
    [{ ...deaths[0], order: "2" }],
    [{ ...deaths[0], order: 3 }],
    [{ ...deaths[0], extra: true }],
    [{ ...deaths[0], heirs: null }],
    [{ ...deaths[0], heirs: [null] }],
    [{ ...deaths[0], heirs: [{ id: "b", relationship: "cousin" }] }],
    [{ ...deaths[0], heirs: [{ id: 1, relationship: "son" }] }],
    ...[null, 1, ""].map((same_as) => [{ ...deaths[0], heirs: [{ id: "b", relationship: "son", same_as }] }]),
    [{ ...deaths[0], heirs: [{ id: "b", relationship: "son", extra: true }] }],
  ];
  for (const deaths of malformed) {
    assert.equal(parsePreview({ ...body, basis: { ...BASIS, deaths } }), null, JSON.stringify(deaths));
  }
  const { proof: omitted, ...missing } = body;
  assert.equal(omitted, null);
  assert.equal(parsePreview(missing), null);
  assert.equal(parsePreview({ ...AVAILABLE, proof: null }), null);
  assert.equal(parsePreview({ ...body, proof: { version: 2 } }), null);
  assert.equal(parsePreview({ ...body, proof: AVAILABLE.proof }), null);
  assert.equal(parsePreview({ ...body, shares: [body.shares[0], body.shares[0]] }), null);
  assert.equal(parsePreview({ ...body, shares: [{ ...body.shares[0], heir_id: "missing" }] }), null);
  assert.deepEqual(parsePreview({ ...body, status: "unavailable", reason: "manasikhat_unsupported" }), {
    status: "unavailable", madhab: body.madhab, basis: body.basis, reason: "manasikhat_unsupported",
  });
});

// Story 1.7b: successive deaths

const LAYERED = {
  ...FULL_CASE,
  heirs: [
    { id: "w", relationship: "wife", gender: "female", name: "Amal", edit_options: noHeirOptions() },
    { id: "s1", relationship: "son", gender: "male", name: null, edit_options: noHeirOptions() },
    { id: "s2", relationship: "son", gender: "male", name: null, edit_options: noHeirOptions() },
  ],
  deaths: [
    {
      heir_id: "s1",
      order: 2,
      gender: "male",
      heir_options: { blocked: [], invalid: {} },
      heirs: [
        { id: "r1", relationship: "mother", gender: "female", name: "Amal", same_as: "w", edit_options: noHeirOptions() },
        { id: "r2", relationship: "brother", gender: "male", name: null, same_as: "s2", edit_options: noHeirOptions() },
        { id: "r3", relationship: "wife", gender: "female", name: null, edit_options: noHeirOptions() },
      ],
    },
    {
      heir_id: "w",
      order: 3,
      gender: "female",
      heir_options: { blocked: [], invalid: {} },
      heirs: [{ id: "r4", relationship: "son", gender: "male", name: null, same_as: "s2", edit_options: noHeirOptions() }],
    },
  ],
};

async function parsed(value: unknown) {
  stubFetch(async () => Response.json({ case: value }));
  return fetchCase(signal());
}

test("parseCase reads later deaths with their heirs, links and options", async () => {
  const kase = await parsed(LAYERED);
  assert.equal(kase?.deaths.length, 2);
  assert.deepEqual(kase?.deaths[0].heirs[0], { id: "r1", relationship: "mother", gender: "female", name: "Amal", same_as: "w", edit_options: noHeirOptions() });
  assert.deepEqual(kase?.deaths[0].heirs[2], { id: "r3", relationship: "wife", gender: "female", name: null, edit_options: noHeirOptions() });
  assert.equal(kase?.deaths[1].heir_id, "w");
  assert.deepEqual(kase?.deaths[1].heirs.map((row) => row.same_as), ["s2"]);
});

test("parseCase drops a malformed death or row and parses the rest, never throwing", async () => {
  const death = LAYERED.deaths[0];
  const dropped = [
    { ...death, extra: 1 },
    { ...death, order: 3 },
    { ...death, order: "2" },
    { ...death, heir_id: "nobody" },
    { ...death, heir_id: 5 },
    { ...death, gender: "x" },
    { ...death, heirs: "none" },
    "text",
    null,
  ];
  for (const bad of dropped) {
    const kase = await parsed({ ...LAYERED, deaths: [bad] });
    assert.deepEqual(kase?.deaths, [], JSON.stringify(bad));
    assert.equal(kase?.heirs.length, 3);
  }
  // A row with unknown keys, a bad relationship, a duplicate id, or a link to an unknown row is
  // dropped from its layer; the others stay.
  const rows = [
    { id: "r1", relationship: "mother", gender: "female", name: null, same_as: "w" },
    { id: "x1", relationship: "mother", gender: "female", name: null, extra: 1 },
    { id: "x2", relationship: "cousin", gender: "female", name: null },
    { id: "r1", relationship: "sister", gender: "female", name: null },
    { id: "x3", relationship: "brother", gender: "male", name: null, same_as: "ghost" },
    { id: "x4", relationship: "brother", gender: "male", name: null, same_as: "s1" },
    { id: "x5", relationship: "brother", gender: "male", name: null, same_as: "s2" },
    { id: "x6", relationship: "brother", gender: "male", name: null, same_as: "s2" },
    { id: "s1", relationship: "uncle", gender: "male", name: null },
  ];
  const kase = await parsed({ ...LAYERED, deaths: [{ ...death, heirs: rows }] });
  assert.deepEqual(kase?.deaths[0].heirs.map((row) => row.id), ["r1", "x5"]);
});

test("parseCase refuses a link to a later layer, a third later death and a repeated death", async () => {
  const [first, second] = LAYERED.deaths;
  const forward = { ...first, heirs: [{ id: "r9", relationship: "brother", gender: "male", name: null, same_as: "r3" }] };
  assert.deepEqual((await parsed({ ...LAYERED, deaths: [forward] }))?.deaths[0].heirs, []);
  const third = { ...second, order: 4, heir_id: "r2" };
  assert.equal((await parsed({ ...LAYERED, deaths: [first, second, third] }))?.deaths.length, 2);
  const repeated = { ...second, heir_id: "s1", heirs: [] };
  assert.deepEqual((await parsed({ ...LAYERED, deaths: [first, repeated] }))?.deaths.map((d) => d.heir_id), ["s1"]);
});

test("markDeceased posts the row and the answer to the order question; unmarkDeceased deletes", async () => {
  const calls = stubFetch(async () => Response.json({ case: FULL_CASE }, { status: 201 }));
  assert.deepEqual(await markDeceased(signal(), "abc123", "s1", undefined, withToken), { kind: "saved", case: FULL_CASE });
  assert.equal(calls[0].url, "/api/v1/case/deaths/");
  assert.equal(calls[0].init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { heir_id: "s1", case_id: "abc123" });
  await markDeceased(signal(), "abc123", "s2", "s1", withToken);
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { heir_id: "s2", first: "s1", case_id: "abc123" });
  await unmarkDeceased(signal(), "abc123", "s 1", withToken);
  assert.equal(calls[2].url, "/api/v1/case/deaths/s%201/?case_id=abc123");
  assert.equal(calls[2].init?.method, "DELETE");
  assert.equal(calls[2].init?.body, undefined);
});

test("a refused death comes back as its codes", async () => {
  stubFetch(async () => Response.json({ errors: { death: "order_required" } }, { status: 400 }));
  assert.deepEqual(await markDeceased(signal(), "abc123", "s2", undefined, withToken), {
    kind: "invalid",
    errors: { death: "order_required" },
  });
});


test("a third-death row cannot link to the second deceased", async () => {
  const [first, second] = LAYERED.deaths;
  const kase = await parsed({ ...LAYERED, deaths: [first, { ...second, heirs: [
    ...second.heirs,
    { id: "dead-link", relationship: "son", gender: "male", name: null, same_as: "s1" },
  ] }] });
  assert.deepEqual(kase?.deaths[1].heirs.map((row) => row.id), ["r4"]);
});


test("relative questions reject malformed or unoffered choices", () => {
  const question = { id: "w", person: "w", kind: "relative", options: ["mother", "none"], suggested: "mother" };
  assert.deepEqual(parseQuestions([question]), [question]);
  for (const bad of [null, {}, [null], [{ ...question, kind: "unknown" }],
    [{ ...question, options: ["invented", "none"] }], [{ ...question, suggested: "father" }],
    [question, question], [{ ...question, options: ["mother", "mother"] }]]) {
    assert.equal(parseQuestions(bad), null);
  }
});

test("malformed questions or a non-object 400 body never hide the error codes", async () => {
  for (const body of [{ errors: { relatives: "invalid" }, questions: "oops" }, { errors: { relatives: "invalid" }, questions: [1] }]) {
    stubFetch(async () => new Response(JSON.stringify(body), { status: 400 }));
    const result = await markDeceased(signal(), CASE.id, "s", undefined, { cookie: () => "csrftoken=token" });
    assert.deepEqual(result, { kind: "invalid", errors: { relatives: "invalid" } });
  }
  stubFetch(async () => new Response("null", { status: 400 }));
  assert.deepEqual(await markDeceased(signal(), CASE.id, "s", undefined, { cookie: () => "csrftoken=token" }), { kind: "failed" });
});

test("death writes carry relative answers and parse questions alongside order errors", async () => {
  const questions = [{ id: "w", person: "w", kind: "relative", options: ["mother", "none"], suggested: "mother" }];
  const calls = stubFetch(async () => new Response(JSON.stringify({ errors: { death: "order_required", relatives: "required" }, questions }), { status: 400 }));
  const result = await markDeceased(signal(), CASE.id, "s", "x", { cookie: () => "csrftoken=token" }, { relatives: { w: "mother" }, shared_father: "no" });
  assert.deepEqual(result, { kind: "invalid", errors: { death: "order_required", relatives: "required" }, questions });
  assert.deepEqual(JSON.parse(calls[0].init?.body as string), { case_id: CASE.id, heir_id: "s", first: "x", relatives: { w: "mother" }, shared_father: "no" });
});


test("layered proofs and tables reject malformed data as a whole", async () => {
  const { readFileSync } = await import("node:fs");
  const fixtures = JSON.parse(readFileSync(new URL("../../../api/contracts/preview-fixtures.json", import.meta.url), "utf8")).fixtures;
  const original = fixtures.find((f: { title: string }) => f.title === "Layered three under hanafi").response;
  assert.ok(parsePreview(original));
  const id = original.basis.heirs[0].id;
  const digitId = "12345678901234567890123456789012";
  const numericSession = JSON.parse(JSON.stringify(original, (_key, value) => value === id ? digitId : value));
  assert.ok(parsePreview(numericSession), "all-digit session ids remain valid basis references");
  assert.ok(parsePreview({ ...original, table: null }));
  // Each mutation is independent and must reject the whole response, never silently drop a layer.
  const mutations: [string, (body: typeof original) => void][] = [
    ["unknown proof key", (b) => { b.proof.extra = true; }],
    ["unknown table key", (b) => { b.table.extra = true; }],
    ["unknown layer key", (b) => { b.table.layers[1].extra = true; }],
    ["unknown v2 layer key", (b) => { b.proof.layers[1].extra = true; }],
    ["order gap", (b) => { b.proof.layers[1].order = 4; }],
    ["table order gap", (b) => { b.table.layers[1].order = 4; }],
    ["wrong death heir", (b) => { b.proof.layers[1].heir = "missing"; }],
    ["pk deceased", (b) => { b.proof.layers[1].deceased = 123; }],
    ["unknown final person", (b) => { b.proof.final[0].heir = "missing"; }],
    ["unknown table person", (b) => { b.table.rows[0].heir = "missing"; }],
    ["unknown part person", (b) => { b.table.layers[1].parts[0].heir = "missing"; }],
    ["numeric person", (b) => { b.proof.people[0].person = 123; }],
    ["wrong identity", (b) => { b.proof.people[0].person = "missing"; }],
    ["duplicate person", (b) => { b.table.rows[1] = b.table.rows[0]; }],
    ["duplicate part", (b) => { b.table.layers[1].parts[1] = b.table.layers[1].parts[0]; }],
    ["wrong total", (b) => { b.table.layers[1].jamia++; }],
    ["wrong proof base", (b) => { b.proof.base++; }],
    ["wrong layer proof base", (b) => { b.proof.layers[0].proof.steps[0].value++; }],
    ["wrong final", (b) => { b.proof.final[0].fraction.numerator++; }],
    ["wrong estate", (b) => { b.proof.layers[1].estate.numerator++; }],
    ["wrong p", (b) => { b.table.layers[1].p++; }],
    ["wrong gcd", (b) => { b.table.layers[1].gcd++; }],
    ["wrong multiplier", (b) => { b.table.layers[1].old_multiplier++; }],
    ["wrong relation", (b) => { b.table.layers[1].relation = "unknown"; }],
    ["wrong intermediate parts", (b) => { b.table.layers[1].parts[0].value++; b.table.layers[1].parts[1].value--; }],
    ["wrong remainder", (b) => { b.table.layers[1].unallocated++; }],
    ["unknown nested column", (b) => { b.table.layers[0].table.columns[0].code = "unknown"; }],
    ["missing layer", (b) => { b.table.layers.pop(); }],
    ["unknown fraction key", (b) => { b.proof.layers[0].estate.pk = 1; }],
  ];
  for (const [title, mutate] of mutations) {
    const body = structuredClone(original);
    mutate(body);
    assert.equal(parsePreview(body), null, title);
  }
});

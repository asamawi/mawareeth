import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { locales, messages } from "../i18n/messages.ts";
import { fetchCase, MADHAB_IDS, readCsrfToken, setMadhab, startCase } from "./case.ts";

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

const CASE = { id: "abc123", started_at: "2026-11-06T10:00:00Z", madhab: null };
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

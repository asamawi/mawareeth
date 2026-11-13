import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { locales, messages } from "../i18n/messages.ts";
import { probeSession } from "./session.ts";

const realFetch = globalThis.fetch;

type Call = { url: unknown; init?: RequestInit };

function stubFetch(answer: (init?: RequestInit) => Promise<Response>): { calls: number; last?: Call } {
  const counter: { calls: number; last?: Call } = { calls: 0 };
  globalThis.fetch = ((url: unknown, init?: RequestInit) => {
    counter.calls += 1;
    counter.last = { url, init };
    return answer(init);
  }) as typeof fetch;
  return counter;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const probe = () => probeSession(new AbortController().signal);

test("a reachable API reports connected, asking the same-origin session URL", async () => {
  const counter = stubFetch(async () => Response.json({ authenticated: false }));
  assert.equal(await probe(), "connected");
  assert.equal(counter.last?.url, "/api/v1/session/");
  assert.equal(counter.last?.init?.credentials, "same-origin");
});

function hang(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
}

test("a hung API reports unavailable at the timeout", async () => {
  const counter = stubFetch(hang);
  assert.equal(await probeSession(new AbortController().signal, 10), "unavailable");
  assert.equal(counter.calls, 1);
});

test("aborting the caller's signal ends the probe", async () => {
  stubFetch(hang);
  const controller = new AbortController();
  const result = probeSession(controller.signal);
  controller.abort();
  assert.equal(await result, "unavailable");
});

const failures: Record<string, () => Promise<Response>> = {
  "a network failure": async () => {
    throw new TypeError("fetch failed");
  },
  "a server error": async () => new Response("", { status: 503 }),
  "an HTML answer": async () => new Response("<html></html>"),
  "an unexpected body": async () => Response.json({ authenticated: "yes" }),
};

for (const [name, answer] of Object.entries(failures)) {
  test(`${name} reports unavailable once, without throwing or retrying`, async () => {
    const counter = stubFetch(answer);
    assert.equal(await probe(), "unavailable");
    assert.equal(counter.calls, 1);
  });
}

test("every locale has its own unavailable message", () => {
  const texts = locales.map((locale) => messages[locale].unavailable);
  assert.ok(texts.every((text) => text.length > 0));
  assert.equal(new Set(texts).size, locales.length);
});

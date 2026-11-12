import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { installDom, teardownDom } from "@/test/dom";
import { AuthForm } from "./auth-form";
import { messages, type Locale } from "@/i18n/messages";
import type { AuthAction } from "@/api/auth";

const nativeFetch = globalThis.fetch;
const nativeFormData = globalThis.FormData;
async function mount(action: Exclude<AuthAction, "logout">, locale: Locale = "en", authenticated = false, query = "next=%2Fapp%2Fen%2Fresults%2F%3Fresume%3Dsave", valid = true, probe: "ok" | "slow" | "failed" = "ok", check: "ok" | "slow" | "failed" = "ok") {
  const dom = installDom(`https://localhost/app/${locale}/${action}/?${query}`);
  globalThis.FormData = dom.FormData as unknown as typeof FormData;
  document.cookie = "csrftoken=test-token";
  const posts: { url: string; init: RequestInit }[] = [];
  const redirects: string[] = [];
  window.location.assign = (target: string | URL) => { redirects.push(String(target)); };
  let body: object = { redirect: "/app/en/results/?resume=save" };
  let status = 200;
  let resolveCheck: (response: Response) => void = () => {};
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (init?.method === "POST") {
      posts.push({ url, init });
      return new Response(JSON.stringify(body), { status });
    }
    if (url.includes("/session/")) {
      if (probe === "slow") return new Promise<Response>(() => {});
      if (probe === "failed") throw new Error("offline");
      return new Response(JSON.stringify({ authenticated }));
    }
    if (url.includes("/auth/login/")) return new Response(JSON.stringify({ redirect: "/en/calc/" }));
    if (check === "slow") return new Promise<Response>((resolve) => { resolveCheck = resolve; });
    if (check === "failed") throw new Error("offline");
    return new Response(JSON.stringify(valid ? { valid: true } : { error: "invalid_link" }), { status: valid ? 200 : 400 });
  };
  const node = document.createElement("div"); document.body.append(node);
  const root = createRoot(node);
  await act(async () => { root.render(<AuthForm locale={locale} action={action} />); });
  return { node, posts, redirects,
    async validateToken() { await act(async () => resolveCheck(new Response(JSON.stringify({ valid: true })))); },
    respond(value: object, code = 200) { body = value; status = code; },
    async submit() {
      for (const input of node.querySelectorAll<HTMLInputElement>("input:not([type=hidden])")) input.value = input.name === "email" ? "a@example.com" : "test-value";
      await act(async () => { node.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    },
    async close() { await act(async () => root.unmount()); await teardownDom(dom); globalThis.fetch = nativeFetch; globalThis.FormData = nativeFormData; },
  };
}

for (const action of ["login", "signup", "password-reset", "password-reset/confirm"] as const) {
  test(`${action} submits with CSRF, language and query continuation`, async () => {
    const ui = await mount(action, "fr", false, "next=%2Fapp%2Fen%2Fresults%2F%3Fresume%3Dsave&uid=abc&token=secret");
    try {
      ui.respond(action === "password-reset" ? { sent: true } : action === "password-reset/confirm" ? { complete: true } : { redirect: "/app/en/results/?resume=save" });
      await ui.submit();
      assert.equal(ui.posts.length, 1);
      assert.equal(ui.posts[0].url, `/api/v1/auth/${action}/`);
      const headers = ui.posts[0].init.headers as Record<string, string>;
      assert.equal(headers["X-CSRFToken"], "test-token"); assert.equal(headers["Accept-Language"], "fr");
      const data = JSON.parse(String(ui.posts[0].init.body));
      assert.equal(data.next, "/app/en/results/?resume=save");
      if (action === "password-reset/confirm") { assert.equal(data.uid, "abc"); assert.equal(data.token, "secret"); }
      if (action.startsWith("password-reset")) assert.ok(ui.node.textContent?.includes(action.endsWith("confirm") ? messages.fr.auth.complete : messages.fr.auth.sent));
      else assert.deepEqual(ui.redirects, ["/app/en/results/?resume=save"]);
    } finally { await ui.close(); }
  });
}

test("login clears the password and shows localized form errors and throttling", async () => {
  const ui = await mount("login");
  try {
    ui.respond({ errors: { __all__: ["Wrong credentials"] } }, 400); await ui.submit();
    assert.ok(ui.node.textContent?.includes("Wrong credentials"));
    assert.equal(document.activeElement, ui.node.querySelector("[data-form-error]"));
    assert.equal(ui.node.querySelector<HTMLInputElement>('[name="password"]')!.value, "");
    ui.respond({}, 429); await ui.submit();
    assert.ok(ui.node.textContent?.includes(messages.en.auth.throttled));
  } finally { await ui.close(); }
});

test("signup shows field errors", async () => {
  const ui = await mount("signup");
  try {
    ui.respond({ errors: { username: ["Already exists"], password2: ["Mismatch"] } }, 400); await ui.submit();
    assert.equal(document.activeElement, ui.node.querySelector("#username"));
    assert.ok(ui.node.querySelector("#username-errors")?.textContent?.includes("Already exists"));
    assert.ok(ui.node.querySelector("#password2-errors")?.textContent?.includes("Mismatch"));
  } finally { await ui.close(); }
});

test("used reset token offers another request", async () => {
  const ui = await mount("password-reset/confirm");
  try {
    ui.respond({ error: "invalid_link" }, 400); await ui.submit();
    assert.ok(ui.node.textContent?.includes(messages.en.auth.invalid));
    assert.ok(ui.node.querySelector('a[href^="/app/en/password-reset/?"]'));
    assert.equal(ui.node.querySelector("form"), null);
  } finally { await ui.close(); }
});

for (const action of ["login", "signup"] as const) {
  test(`${action} redirects signed-in visitors using the server destination`, async () => {
    const ui = await mount(action, "en", true, "next=https://evil.example/");
    try { assert.deepEqual(ui.redirects, ["/en/calc/"]); } finally { await ui.close(); }
  });
}

test("Arabic auth forms are RTL and social buttons POST with CSRF and next", async () => {
  const ui = await mount("login", "ar");
  try {
    assert.equal(ui.node.querySelector("main")?.dir, "rtl");
    assert.ok(ui.node.textContent?.includes(messages.ar.auth.login));
    assert.ok(!ui.node.textContent?.includes("Sign in"));
    for (const backend of ["facebook", "linkedin-openidconnect"]) {
      const form = ui.node.querySelector<HTMLFormElement>(`form[action="/social-auth/login/${backend}/"]`)!;
      assert.equal(form.method, "post");
      assert.equal(form.querySelector<HTMLInputElement>('[name="csrfmiddlewaretoken"]')!.value, "test-token");
      assert.equal(form.querySelector<HTMLInputElement>('[name="next"]')!.value, "/app/en/results/?resume=save");
    }
  } finally { await ui.close(); }
});


test("nav logout ends the session and returns to the locale root", async () => {
  const { SiteNav } = await import("./site-nav");
  const dom = installDom("https://localhost/app/en/");
  document.cookie = "csrftoken=nav-token";
  const redirects: string[] = [];
  window.location.assign = (target: string | URL) => { redirects.push(String(target)); };
  const posts: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (init?.method === "POST") { posts.push(String(input)); return new Response(JSON.stringify({ authenticated: false })); }
    return new Response(JSON.stringify({ authenticated: true }));
  };
  const node = document.createElement("div"); document.body.append(node);
  const root = createRoot(node);
  try {
    await act(async () => root.render(<SiteNav locale="en" nav={messages.en.nav} />));
    const button = node.querySelector("button")!;
    assert.equal(button.textContent, messages.en.auth.logout);
    await act(async () => button.click());
    assert.deepEqual(posts, ["/api/v1/auth/logout/"]);
    assert.deepEqual(redirects, ["/app/en/"]);
  } finally { await act(async () => root.unmount()); await teardownDom(dom); globalThis.fetch = nativeFetch; }
});

test("pending login disables submission and reports connection failure", async () => {
  const ui = await mount("login");
  const original = globalThis.fetch;
  let reject: (error: Error) => void = () => {};
  globalThis.fetch = (_input, init) => init?.method === "POST" ? new Promise((_resolve, fail) => { reject = fail; }) : original(_input, init);
  try {
    await ui.submit();
    assert.equal(ui.node.querySelector("button")!.disabled, true);
    assert.ok(ui.node.textContent?.includes(messages.en.auth.pending));
    await act(async () => reject(new Error("offline")));
    assert.equal(ui.node.querySelector("button")!.disabled, false);
    assert.ok(ui.node.textContent?.includes(messages.en.auth.error));
  } finally { await ui.close(); }
});


test("an invalid token is detected before a password is submitted", async () => {
  const ui = await mount("password-reset/confirm", "en", false, "uid=bad&token=bad", false);
  try {
    assert.equal(ui.node.querySelector("form"), null);
    assert.ok(ui.node.textContent?.includes(messages.en.auth.invalid));
    assert.equal(ui.posts.length, 0);
  } finally { await ui.close(); }
});

for (const action of ["signup", "password-reset", "password-reset/confirm"] as const) {
  test(`Arabic ${action} has localized labels and RTL`, async () => {
    const ui = await mount(action, "ar");
    try {
      assert.equal(ui.node.querySelector("main")?.dir, "rtl");
      for (const label of ui.node.querySelectorAll("label")) assert.match(label.textContent ?? "", /[\u0600-\u06ff]/);
      assert.ok(!ui.node.textContent?.includes("????"));
    } finally { await ui.close(); }
  });
}

test("social sign in failures show the localized message", async () => {
  const ui = await mount("login", "fr", false, "error=social");
  try { assert.ok(ui.node.textContent?.includes(messages.fr.auth.socialError)); } finally { await ui.close(); }
});

const continuation = "/app/en/results/?resume=save";
for (const action of ["login", "signup"] as const) {
  for (const probe of ["slow", "failed"] as const) {
    test(`${action} preserves encoded next before a ${probe} session probe completes`, async () => {
      const ui = await mount(action, "en", false, `next=${encodeURIComponent(continuation)}`, true, probe);
      try {
        for (const page of ["login", "signup", "password-reset"]) {
          const link = ui.node.querySelector<HTMLAnchorElement>(`a[href^="/app/en/${page}/?"]`)!;
          assert.equal(link.getAttribute("href"), `/app/en/${page}/?next=${encodeURIComponent(continuation)}`);
        }
        for (const input of ui.node.querySelectorAll<HTMLInputElement>('input[name="next"]')) assert.equal(input.value, continuation);
      } finally { await ui.close(); }
    });
  }
}
for (const action of ["password-reset", "password-reset/confirm"] as const) {
  test(`${action} success offers sign in with the same next`, async () => {
    const ui = await mount(action);
    try {
      ui.respond(action === "password-reset" ? { sent: true } : { complete: true });
      await ui.submit();
      assert.equal(ui.node.querySelector('a[href^="/app/en/login/?"]')?.getAttribute("href"), `/app/en/login/?next=${encodeURIComponent(continuation)}`);
    } finally { await ui.close(); }
  });
}
for (const check of ["slow", "failed"] as const) {
  test(`reset confirmation blocks submission while token check is ${check}`, async () => {
    const ui = await mount("password-reset/confirm", "en", false, "uid=abc&token=secret", true, "ok", check);
    try {
      assert.equal(ui.node.querySelector("button")!.disabled, true);
      await ui.submit();
      assert.equal(ui.posts.length, 0);
      if (check === "slow") {
        await ui.validateToken();
        assert.equal(ui.node.querySelector("button")!.disabled, false);
        ui.respond({ errors: { new_password2: ["Mismatch"] } }, 400);
        await ui.submit();
        assert.equal(document.activeElement, ui.node.querySelector("#new_password2"));
      }
    } finally { await ui.close(); }
  });
}
for (const locale of ["ar", "en", "fr"] as const) {
  for (const action of ["signup", "password-reset/confirm"] as const) {
    test(`${locale} ${action} describes password requirements before submission`, async () => {
      const ui = await mount(action, locale);
      try {
        const field = ui.node.querySelector(action === "signup" ? "#password1" : "#new_password1")!;
        assert.equal(field.getAttribute("aria-describedby"), "password-requirements");
        assert.equal(ui.node.querySelector("#password-requirements")?.textContent, messages[locale].auth.passwordRequirements);
      } finally { await ui.close(); }
    });
  }
}

import { expect, test as base, type Page, type Route } from "@playwright/test";

export type CaseBody = { id: string; started_at: string };

export const CASE: CaseBody = { id: "0123456789abcdef", started_at: "2026-11-13T00:00:00Z" };

type Answer = (route: Route) => Promise<void> | void;

export const json = (status: number, body: unknown): Answer => (route) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

/** A network failure: the browser sees no response at all. */
export const abort: Answer = (route) => route.abort("failed");

/** What the page's API calls answer. Anything left unset fails the test when it is requested. */
export type Stubs = {
  session?: Answer;
  getCase?: Answer;
  postCase?: Answer;
  patchCase?: Answer;
  getPreview?: Answer;
};

export const sessionAnonymous = json(200, { authenticated: false });
export const sessionAuthenticated = json(200, { authenticated: true });
export const noCase = json(200, { case: null });
export const liveCase = (id = CASE.id) => json(200, { case: { ...CASE, id } });
export const startedCase = (id = CASE.id) => json(201, { case: { ...CASE, id } });

/** A case as the API sends it, from a shared fixture's case; it keeps the fixture's ids and school. */
export function fullCase(fixtureCase: Record<string, unknown>, changes: Record<string, unknown> = {}) {
  const options = { blocked: [], invalid: {} };
  const heirs = fixtureCase.heirs as Record<string, unknown>[];
  return { ...fixtureCase, heir_options: options, heirs: heirs.map((heir) => ({ ...heir, edit_options: options })), deaths: [], ...changes };
}

export class Api {
  readonly stubs: Stubs = {};
  readonly unstubbed: string[] = [];
  sessionGets = 0;
  caseGets = 0;
  casePosts: { body: string; csrf: string | undefined }[] = [];
  casePatches: { body: string; csrf: string | undefined }[] = [];
  previewGets = 0;

  set(stubs: Stubs): void {
    Object.assign(this.stubs, stubs);
  }

  async attach(page: Page): Promise<void> {
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const method = request.method();
      if (pathname === "/api/v1/session/" && method === "GET") {
        this.sessionGets += 1;
        return this.answer(route, this.stubs.session, "session");
      }
      if (pathname === "/api/v1/case/" && method === "GET") {
        this.caseGets += 1;
        return this.answer(route, this.stubs.getCase, "get case");
      }
      if (pathname === "/api/v1/case/" && method === "POST") {
        this.casePosts.push({ body: request.postData() ?? "", csrf: request.headers()["x-csrftoken"] });
        return this.answer(route, this.stubs.postCase, "post case");
      }
      if (pathname === "/api/v1/case/" && method === "PATCH") {
        this.casePatches.push({ body: request.postData() ?? "", csrf: request.headers()["x-csrftoken"] });
        return this.answer(route, this.stubs.patchCase, "patch case");
      }
      if (pathname === "/api/v1/case/preview/" && method === "GET") {
        this.previewGets += 1;
        return this.answer(route, this.stubs.getPreview, "get preview");
      }
      this.unstubbed.push(`${method} ${pathname}`);
      await route.abort("failed");
    });
  }

  private async answer(route: Route, stub: Answer | undefined, name: string): Promise<void> {
    if (!stub) {
      this.unstubbed.push(`${name} (no stub set)`);
      return route.abort("failed");
    }
    if (name === "session") {
      // The session endpoint issues the CSRF cookie, so writes reach the POST.
      const original = route.fulfill.bind(route);
      route.fulfill = (options) =>
        original({
          ...options,
          headers: { ...options?.headers, "Set-Cookie": "csrftoken=e2e-token; Path=/; SameSite=Lax" },
        });
    }
    await stub(route);
  }
}

/** A test whose `api` starts empty and fails at the end if the page asked for an unstubbed API. */
export const test = base.extend<{ api: Api }>({
  api: async ({ page }, provide) => {
    const api = new Api();
    await api.attach(page);
    await provide(api);
    expect(api.unstubbed, "unstubbed API requests").toEqual([]);
  },
});

export { expect };

/** Fails the test on any uncaught page error or console error. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

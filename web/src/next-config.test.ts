import assert from "node:assert/strict";
import { test } from "node:test";

import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants.js";

import config from "../next.config.ts";

test("production builds are a static export at the site root with no rewrites", () => {
  const built = config(PHASE_PRODUCTION_BUILD);
  assert.equal(built.output, "export");
  assert.equal(built.basePath, undefined);
  assert.equal(built.rewrites, undefined);
  assert.equal(built.redirects, undefined);
});

test("development sends the site root to the Arabic landing page", async () => {
  const dev = config(PHASE_DEVELOPMENT_SERVER);
  assert.deepEqual(await dev.redirects?.(), [{ source: "/", destination: "/ar/", permanent: false }]);
});

test("development proxies the API to Django", async () => {
  const dev = config(PHASE_DEVELOPMENT_SERVER);
  assert.equal(dev.output, undefined);
  assert.deepEqual(await dev.rewrites?.(), [
    {
      source: "/api/:path*/",
      destination: "http://localhost:8000/api/:path*/",
    },
  ]);
});

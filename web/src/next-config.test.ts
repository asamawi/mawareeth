import assert from "node:assert/strict";
import { test } from "node:test";

import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD } from "next/constants.js";

import config from "../next.config.ts";

test("production builds are a static export under /app with no rewrites", () => {
  const built = config(PHASE_PRODUCTION_BUILD);
  assert.equal(built.output, "export");
  assert.equal(built.basePath, "/app");
  assert.equal(built.rewrites, undefined);
});

test("development proxies the API to Django, outside the base path", async () => {
  const dev = config(PHASE_DEVELOPMENT_SERVER);
  assert.equal(dev.output, undefined);
  assert.deepEqual(await dev.rewrites?.(), [
    {
      source: "/api/:path*/",
      destination: "http://localhost:8000/api/:path*/",
      basePath: false,
    },
  ]);
});

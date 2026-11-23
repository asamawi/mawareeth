// Local-only: runs the `live` Playwright project (next dev + Django on local PostgreSQL).
// Not part of `npm run test:e2e` or CI. See _bmad-output/implementation-artifacts/epic-9-gate-evidence.md.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
// No shell, so arguments such as `-g "a phrase"` reach Playwright unchanged.
const run = spawnSync(process.execPath, [cli, "test", "--project=live", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, E2E_LIVE: "1" },
});
process.exit(run.status ?? 1);

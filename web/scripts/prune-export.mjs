// Next always emits its own not-found pages. WhiteNoise would serve them as normal
// pages with status 200, while a missing path already gets Django's 404.
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "out");

for (const leftover of ["404", "404.html", "_not-found"]) {
  rmSync(join(out, leftover), { recursive: true, force: true });
}

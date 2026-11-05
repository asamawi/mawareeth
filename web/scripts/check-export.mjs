// Fails the build unless the static export has the shape Django serves under /app/.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "out");
const expected = { ar: "rtl", en: "ltr", fr: "ltr" };
const problems = [];

// A root index.html would be served at /app/ and shadow Django's language redirect.
if (existsSync(join(out, "index.html"))) {
  problems.push("out/index.html exists; it would shadow the /app/ language redirect");
}

// WhiteNoise serves every file it finds, so these would answer 200 with no lang or dir.
for (const leftover of ["404", "404.html", "_not-found"]) {
  if (existsSync(join(out, leftover))) {
    problems.push(`out/${leftover} exists; it would be served as a normal page`);
  }
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
}

for (const [locale, dir] of Object.entries(expected)) {
  const page = join(out, locale, "index.html");
  if (!existsSync(page)) {
    problems.push(`out/${locale}/index.html is missing`);
    continue;
  }
  const tag = readFileSync(page, "utf8").match(/<html\b[^>]*>/)?.[0] ?? "";
  if (attribute(tag, "lang") !== locale) {
    problems.push(`out/${locale}/index.html does not have lang="${locale}"`);
  }
  if (attribute(tag, "dir") !== dir) {
    problems.push(`out/${locale}/index.html does not have dir="${dir}"`);
  }
}

for (const problem of problems) {
  console.error(`check-export: ${problem}`);
}
if (problems.length > 0) {
  process.exit(1);
}
console.log("check-export: ok");

// Validates the Locale registry, the fiqh term catalogs, messages.ts, public-pages.ts and the .po files,
// and keeps the generated Next.js module in step. Run with the test loader so it can import .ts files:
//   node --import ./src/test/loader.mjs scripts/i18n.mjs [--write]
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  GENERATED_FILE,
  MESSAGES_FILE,
  PUBLIC_PAGES_FILE,
  catalogFile,
  driftErrors,
  generateModule,
  poFile,
  validateCatalogs,
  validatePo,
  validateRegistry,
  validateTrees,
} from "../src/i18n/validate.ts";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(web, "..");
const write = process.argv.includes("--write");
const read = (...parts) => readFileSync(join(root, ...parts), "utf8").replace(/\r\n/g, "\n");
const fail = (errors) => {
  for (const error of errors) console.error(error);
  console.error(`${errors.length} i18n problem${errors.length === 1 ? "" : "s"}`);
  process.exit(1);
};

let registry;
try {
  registry = JSON.parse(read("i18n", "locales.json"));
} catch (error) {
  fail([`i18n/locales.json: -: cannot read the registry (${error.message})`]);
}
const termsDir = join(root, "i18n", "terms");
const present = existsSync(termsDir) ? readdirSync(termsDir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)) : [];
const errors = validateRegistry(registry, present);
if (errors.length) fail(errors);

const codes = JSON.parse(read("contracts", "codes.json"));
const catalogs = {};
for (const { code } of registry.locales) {
  try {
    catalogs[code] = JSON.parse(read("i18n", "terms", `${code}.json`));
  } catch (error) {
    errors.push(`${catalogFile(code)}: ${code}: cannot read the catalog (${error.message})`);
  }
}
errors.push(...validateCatalogs(catalogs, registry, codes));
if (errors.length) fail(errors);

// The generated module comes first: messages.ts imports it.
const generated = generateModule(registry, catalogs);
const generatedPath = join(root, GENERATED_FILE);
if (write) {
  writeFileSync(generatedPath, generated, "utf8");
} else {
  const drift = driftErrors(existsSync(generatedPath) ? readFileSync(generatedPath, "utf8") : null, generated);
  if (drift.length) fail(drift);
}

const href = (path) => pathToFileURL(join(web, "src", "i18n", path)).href;
const { messages } = await import(href("messages.ts"));
const { publicText } = await import(href("public-pages.ts"));
errors.push(...validateTrees(MESSAGES_FILE, messages, registry));
errors.push(...validateTrees(PUBLIC_PAGES_FILE, publicText, registry));
const po = {};
for (const { code, published } of registry.locales) {
  if (!published) continue;
  try {
    po[code] = read("locale", code, "LC_MESSAGES", "django.po");
  } catch (error) {
    errors.push(`${poFile(code)}: ${code}: cannot read the gettext catalog (${error.message})`);
  }
}
errors.push(...validatePo(po, registry));
if (errors.length) fail(errors);
console.log(`i18n ok: ${registry.locales.filter((l) => l.published).map((l) => l.code).join(", ")}`);

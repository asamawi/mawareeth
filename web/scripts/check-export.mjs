// Fails the build unless the static export has the shape Django serves from the site root.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "out");
const expected = { ar: "rtl", en: "ltr", fr: "ltr" };
// Every page under a locale that Django links to; each must exist in every locale.
const pages = ["", "interview", "results", "about", "terms", "privacy"];
// Crawler files that must sit at the root of the export.
// Only these pages are indexable; every other page must carry a robots noindex.
const publicPages = ["", "about", "terms", "privacy"];
// Text that belongs to the public pages and must not ship to the private pages' client chunks.
const publicOnlyText = ["webste", "Privacy Policy for Mawareeth 2.0", "الأسئلة الشائعة", "Questions fréquentes"];
const rootFiles = ["robots.txt", "sitemap.xml", "llms.txt"];
const problems = [];

// A root index.html would be served at / and shadow Django's language redirect.
if (existsSync(join(out, "index.html"))) {
  problems.push("out/index.html exists; it would shadow the / language redirect");
}

for (const file of rootFiles) {
  if (!existsSync(join(out, file))) {
    problems.push(`out/${file} is missing`);
  } else if (readFileSync(join(out, file), "utf8").trim() === "") {
    problems.push(`out/${file} is empty`);
  }
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
  for (const route of pages) {
    const name = [locale, route, "index.html"].filter(Boolean).join("/");
    const page = join(out, ...name.split("/"));
    if (!existsSync(page)) {
      problems.push(`out/${name} is missing`);
      continue;
    }
    const tag = readFileSync(page, "utf8").match(/<html\b[^>]*>/)?.[0] ?? "";
    if (attribute(tag, "lang") !== locale) {
      problems.push(`out/${name} does not have lang="${locale}"`);
    }
    if (attribute(tag, "dir") !== dir) {
      problems.push(`out/${name} does not have dir="${dir}"`);
    }
  }
}

function html(locale, route) {
  const file = join(out, locale, ...(route ? [route] : []), "index.html");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function robotsMeta(markup) {
  return markup.split("<meta ").find((tag) => tag.startsWith("name=\"robots\"") || tag.slice(0, tag.indexOf(">")).includes("name=\"robots\"")) ?? "";
}

function scriptsOf(markup) {
  return markup.split("\"").filter((token) => token.startsWith("/_next/static/") && token.endsWith(".js"));
}

for (const locale of Object.keys(expected)) {
  for (const route of publicPages) {
    const markup = html(locale, route);
    const name = `out/${locale}/${route ? `${route}/` : ""}index.html`;
    if (!markup.includes("rel=\"canonical\"")) problems.push(`${name} has no canonical link`);
    if (/noindex/.test(robotsMeta(markup))) problems.push(`${name} has a noindex robots meta`);
  }
  const interview = html(locale, "interview");
  if (!/noindex/.test(robotsMeta(interview))) problems.push(`out/${locale}/interview/index.html has no noindex robots meta`);
  // The private pages' scripts must not carry the public pages' text.
  for (const script of new Set(scriptsOf(interview))) {
    const file = join(out, ...script.slice(1).split("/"));
    if (!existsSync(file)) continue;
    const code = readFileSync(file, "utf8");
    for (const marker of publicOnlyText) {
      if (code.includes(marker)) problems.push(`out${script} is loaded by /${locale}/interview/ and contains public-page text "${marker}"`);
    }
  }
}

for (const problem of problems) {
  console.error(`check-export: ${problem}`);
}
if (problems.length > 0) {
  process.exit(1);
}
console.log("check-export: ok");

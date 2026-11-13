import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { locales, messages } from "@/i18n/messages";
import { publicText } from "@/i18n/public-pages";

import robots from "../app/robots.ts";
import sitemap from "../app/sitemap.ts";
import { landingJsonLd, serializeJsonLd } from "./json-ld.ts";
import { SITE_URL, canonicalUrl, pageMetadata, publicPages, publicUrls } from "./site.ts";

test("the public set is the landing, about, terms and privacy pages in three languages", () => {
  const urls = publicUrls().map((entry) => entry.url);
  assert.equal(urls.length, 12);
  assert.equal(new Set(urls).size, 12);
  assert.ok(urls.includes("https://www.mawareeth.com/en/"));
  assert.ok(urls.includes("https://www.mawareeth.com/ar/about/"));
  assert.ok(urls.includes("https://www.mawareeth.com/fr/privacy/"));
  assert.deepEqual([...publicPages], ["", "about", "terms", "privacy"]);
});

test("each public page is indexable with a canonical URL and hreflang alternates", () => {
  for (const locale of locales) {
    for (const page of publicPages) {
      const metadata = pageMetadata(locale, page, { title: "T", description: "D" });
      assert.deepEqual(metadata.robots, { index: true, follow: true });
      assert.equal(metadata.alternates?.canonical, canonicalUrl(locale, page));
      const languages = metadata.alternates?.languages as Record<string, string>;
      for (const other of locales) assert.equal(languages[other], canonicalUrl(other, page));
      assert.equal(languages["x-default"], page === "" ? `${SITE_URL}/` : undefined);
    }
  }
});

test("JSON-LD never carries a raw less-than sign and stays parseable", () => {
  const data = { text: "</script><script>alert(1)</script>" };
  const serialized = serializeJsonLd(data);
  assert.ok(!serialized.includes("<"));
  assert.deepEqual(JSON.parse(serialized), data);
});

test("landing JSON-LD describes the organization, the web app and the visible FAQ", () => {
  for (const locale of locales) {
    const graph = landingJsonLd(locale, messages[locale].title, publicText[locale])["@graph"];
    assert.deepEqual(graph.map((node) => node["@type"]), ["Organization", "WebApplication", "FAQPage"]);
    const faq = graph[2] as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    assert.deepEqual(
      faq.mainEntity.map((entry) => [entry.name, entry.acceptedAnswer.text]),
      publicText[locale].faq.items.map((item) => [item.q, item.a]),
    );
  }
});

test("robots.txt allows the public pages, blocks the private ones and names the sitemap", () => {
  const rules = robots().rules as { userAgent: string; allow: string[]; disallow: string[] };
  assert.equal(rules.userAgent, "*");
  for (const locale of locales) {
    assert.ok(rules.allow.includes(`/${locale}/$`));
    for (const page of ["about", "terms", "privacy"]) assert.ok(rules.allow.includes(`/${locale}/${page}/`));
    for (const page of ["interview", "results", "cases", "login", "signup", "shared", "invite", "received"]) {
      assert.ok(rules.disallow.includes(`/${locale}/${page}/`), `${locale}/${page}`);
    }
  }
  assert.ok(rules.disallow.includes("/api/"));
  assert.ok(rules.disallow.includes("/accounts/"));
  assert.equal(robots().sitemap, "https://www.mawareeth.com/sitemap.xml");
});

test("the sitemap lists the 12 public URLs with hreflang alternates", () => {
  const entries = sitemap();
  assert.deepEqual(entries.map((entry) => entry.url).sort(), publicUrls().map((entry) => entry.url).sort());
  for (const entry of entries) {
    const languages = entry.alternates?.languages as Record<string, string>;
    assert.deepEqual(Object.keys(languages).sort(), ["ar", "en", "fr"]);
    assert.ok(Object.values(languages).includes(entry.url));
  }
});

test("llms.txt links every public page and states what the tool does not do", () => {
  const text = readFileSync(new URL("../../public/llms.txt", import.meta.url), "utf8");
  for (const entry of publicUrls()) assert.ok(text.includes(`(${entry.url})`), entry.url);
  assert.match(text, /not a fatwa/i);
  assert.match(text, /does not support Jafari/i);
});

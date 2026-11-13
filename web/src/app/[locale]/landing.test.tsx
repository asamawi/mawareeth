import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";

import { installDom, teardownDom } from "@/test/dom";
import { locales, messages } from "@/i18n/messages";
import { publicText } from "@/i18n/public-pages";

import AboutPage, { generateMetadata as aboutMetadata } from "./about/page.tsx";
import { LandingRedirect } from "./landing-redirect.tsx";
import LandingPage, { generateMetadata as landingMetadata } from "./page.tsx";
import PrivacyPage, { generateMetadata as privacyMetadata } from "./privacy/page.tsx";
import { SiteFooter } from "./site-footer.tsx";
import TermsPage, { generateMetadata as termsMetadata } from "./terms/page.tsx";

const params = (locale: string) => ({ params: Promise.resolve({ locale }) });

async function html(page: (props: { params: Promise<{ locale: string }> }) => Promise<React.ReactElement>, locale: string) {
  return renderToStaticMarkup(await page(params(locale)));
}

test("landing metadata is indexable with canonical, hreflang and x-default", async () => {
  const metadata = await landingMetadata(params("en"));
  assert.deepEqual(metadata.robots, { index: true, follow: true });
  assert.equal(metadata.title, publicText.en.landing.metaTitle);
  assert.equal(metadata.description, publicText.en.landing.metaDescription);
  assert.equal(metadata.alternates?.canonical, "https://www.mawareeth.com/en/");
  assert.deepEqual(metadata.alternates?.languages, {
    ar: "https://www.mawareeth.com/ar/",
    en: "https://www.mawareeth.com/en/",
    fr: "https://www.mawareeth.com/fr/",
    "x-default": "https://www.mawareeth.com/",
  });
});

test("about, terms and privacy are indexable with their own canonical URLs", async () => {
  for (const [page, metadataOf] of [["about", aboutMetadata], ["terms", termsMetadata], ["privacy", privacyMetadata]] as const) {
    for (const locale of locales) {
      const metadata = await metadataOf(params(locale));
      assert.deepEqual(metadata.robots, { index: true, follow: true });
      assert.equal(metadata.alternates?.canonical, `https://www.mawareeth.com/${locale}/${page}/`);
    }
  }
});

test("the landing page has one h1, the CTA to the interview, the visible FAQ and parseable JSON-LD", async () => {
  for (const locale of locales) {
    const markup = await html(LandingPage, locale);
    assert.equal(markup.match(/<h1\b/g)?.length, 1);
    assert.ok(markup.includes(`href="/${locale}/interview/"`));
    for (const item of publicText[locale].faq.items) {
      assert.ok(markup.includes(item.q.replace(/'/g, "&#x27;")) || markup.includes(item.q), item.q);
    }
    assert.ok(markup.includes(publicText[locale].landing.disclaimer));
    const open = '<script type="application/ld+json">';
    const start = markup.indexOf(open) + open.length;
    const script = markup.slice(start, markup.indexOf("</script>", start));
    assert.ok(script);
    const data = JSON.parse(script.replace(/&quot;/g, '"').replace(/&#x27;/g, "'"));
    assert.equal(data["@graph"].length, 3);
    assert.ok(!script.includes("<"));
  }
});

test("a locale outside ar, en and fr is not found", async () => {
  await assert.rejects(LandingPage(params("de")), { message: "notFound" });
});

test("terms and privacy keep every source block and the about page has its sections", async () => {
  for (const locale of locales) {
    const terms = await html(TermsPage, locale);
    assert.ok(terms.includes(publicText[locale].terms.title));
    assert.equal(terms.match(/<p>/g)?.length, publicText[locale].terms.blocks.filter((block) => block.kind === "p").length);
    const privacy = await html(PrivacyPage, locale);
    assert.equal(privacy.match(/<h2\b/g)?.length, publicText[locale].privacy.blocks.filter((block) => block.kind === "h2").length);
    const about = await html(AboutPage, locale);
    assert.ok(about.includes(publicText[locale].about.limitsBody));
  }
});

test("the footer links to about, terms and privacy in each language", () => {
  for (const locale of locales) {
    const markup = renderToStaticMarkup(<SiteFooter locale={locale} footer={messages[locale].footer} />);
    for (const page of ["about", "terms", "privacy"]) assert.ok(markup.includes(`href="/${locale}/${page}/"`), `${locale}/${page}`);
    assert.ok(markup.includes(messages[locale].footer.note));
  }
});

const nativeFetch = globalThis.fetch;

async function visit(authenticated: boolean | "failed") {
  const dom = installDom("https://localhost/en/");
  const replaced: string[] = [];
  window.location.replace = (target: string | URL) => { replaced.push(String(target)); };
  globalThis.fetch = async () => {
    if (authenticated === "failed") throw new Error("offline");
    return new Response(JSON.stringify({ authenticated }));
  };
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  await act(async () => { root.render(<LandingRedirect locale="en" />); });
  await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 20)); });
  await act(async () => root.unmount());
  await teardownDom(dom);
  globalThis.fetch = nativeFetch;
  return replaced;
}

test("a signed-in visitor on the landing page is sent to My saved cases", async () => {
  assert.deepEqual(await visit(true), ["/en/cases/"]);
});

test("anonymous visitors and failed checks stay on the landing page", async () => {
  assert.deepEqual(await visit(false), []);
  assert.deepEqual(await visit("failed"), []);
});

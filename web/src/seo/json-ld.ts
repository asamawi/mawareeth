import type { Locale } from "../i18n/messages.ts";
import type { PublicPageText } from "../i18n/public-pages.ts";
import { SITE_URL, canonicalUrl } from "./site.ts";

/** JSON for a script tag: `<` is escaped so the data can never close the tag. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** Organization and WebApplication for the landing page, plus its visible FAQ. */
export function landingJsonLd(locale: Locale, title: string, text: PublicPageText) {
  const url = canonicalUrl(locale, "");
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE_URL}/#organization`,
        name: "Mawareeth",
        url: `${SITE_URL}/`,
        sameAs: ["https://github.com/asamawi/mawareeth"],
      },
      {
        "@type": "WebApplication",
        "@id": `${url}#app`,
        name: title,
        url,
        description: text.landing.metaDescription,
        inLanguage: locale,
        applicationCategory: "UtilitiesApplication",
        operatingSystem: "Any",
        browserRequirements: "Requires JavaScript",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        publisher: { "@id": `${SITE_URL}/#organization` },
      },
      {
        "@type": "FAQPage",
        "@id": `${url}#faq`,
        inLanguage: locale,
        mainEntity: text.faq.items.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
    ],
  };
}

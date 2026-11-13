import type { MetadataRoute } from "next";

import { locales } from "@/i18n/messages";
import { SITE_URL } from "@/seo/site";

export const dynamic = "force-static";

// Pages that need an account, a case in progress or a token. They also answer
// with X-Robots-Tag: noindex, which crawlers only see for pages they may fetch.
const privatePages = [
  "interview", "results", "cases", "login", "signup", "password-reset", "password-change",
  "invite", "received", "shared", "calc", "new", "profile", "admin",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: [
        ...locales.map((locale) => `/${locale}/$`),
        ...locales.flatMap((locale) => ["about", "terms", "privacy"].map((page) => `/${locale}/${page}/`)),
      ],
      disallow: [
        ...locales.flatMap((locale) => privatePages.map((page) => `/${locale}/${page}/`)),
        "/api/",
        "/accounts/",
        "/social-auth/",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

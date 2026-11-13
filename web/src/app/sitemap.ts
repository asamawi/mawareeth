import type { MetadataRoute } from "next";

import { languageAlternates, publicUrls } from "@/seo/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  return publicUrls().map(({ page, url }) => ({
    url,
    changeFrequency: "monthly",
    priority: page === "" ? 1 : 0.5,
    alternates: { languages: languageAlternates(page) },
  }));
}

import type { MetadataRoute } from "next";
import {
  getCachedSitemapPayload,
  SITEMAP_MAX_URLS_PER_FILE,
} from "../lib/sitemapCache";
import { getSiteBaseUrl } from "../lib/siteUrl";

export const revalidate = 3600;

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = getSiteBaseUrl();
  const host = (() => {
    try {
      return new URL(base).host;
    } catch {
      return undefined;
    }
  })();

  const { staticEntries, adEntries } = await getCachedSitemapPayload();
  const total = staticEntries.length + adEntries.length;
  const sitemapUrls: string[] =
    total <= SITEMAP_MAX_URLS_PER_FILE
      ? [`${base}/sitemap/0.xml`]
      : [
          `${base}/sitemap/0.xml`,
          ...Array.from(
            { length: Math.ceil(adEntries.length / SITEMAP_MAX_URLS_PER_FILE) },
            (_, i) => `${base}/sitemap/${i + 1}.xml`,
          ),
        ];

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/"],
    },
    sitemap: sitemapUrls.length === 1 ? sitemapUrls[0]! : sitemapUrls,
    ...(host ? { host } : {}),
  };
}

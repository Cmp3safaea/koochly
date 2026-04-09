import type { MetadataRoute } from "next";
import {
  getCachedSitemapPayload,
  SITEMAP_MAX_URLS_PER_FILE,
} from "../lib/sitemapCache";
import { getSiteBaseUrlFromRequest } from "../lib/siteUrl";
import { locales } from "@koochly/shared";

export const revalidate = 3600;

function toAbsoluteUrl(path: string, base: string): string {
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function withLocalePrefixes(path: string): string[] {
  return locales.map((loc) => (path === "/" ? `/${loc}` : `/${loc}${path}`));
}

function expandForAllLocales(
  entries: { path: string; lastModified?: Date }[],
): { path: string; lastModified?: Date }[] {
  const out: { path: string; lastModified?: Date }[] = [];
  for (const e of entries) {
    for (const p of withLocalePrefixes(e.path)) {
      out.push({ path: p, lastModified: e.lastModified });
    }
  }
  return out;
}

function mapEntries(
  entries: { path: string; lastModified?: Date }[],
  priority: number,
  base: string,
): MetadataRoute.Sitemap {
  return entries.map((e) => ({
    url: toAbsoluteUrl(e.path, base),
    lastModified: e.lastModified,
    changeFrequency: "weekly",
    priority,
  }));
}

/**
 * Single sitemap at `/sitemap.xml`.
 *
 * We avoid `generateSitemaps()` here: with that API, Next.js 16 serves chunk URLs at
 * `/sitemap/[id].xml` and `/sitemap.xml` may not resolve as users expect. If you ever
 * exceed Google's per-file limit (~50k URLs), split via multiple route handlers or
 * revisit the multi-sitemap API.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = await getSiteBaseUrlFromRequest();
  const { staticEntries, adEntries } = await getCachedSitemapPayload();
  const staticUrls = mapEntries(expandForAllLocales(staticEntries), 0.9, base);
  const adUrls = mapEntries(expandForAllLocales(adEntries), 0.6, base);
  const merged = [...staticUrls, ...adUrls];
  if (merged.length > SITEMAP_MAX_URLS_PER_FILE) {
    return merged.slice(0, SITEMAP_MAX_URLS_PER_FILE);
  }
  return merged;
}

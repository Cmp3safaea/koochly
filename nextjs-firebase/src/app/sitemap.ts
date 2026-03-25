import type { MetadataRoute } from "next";
import {
  getCachedSitemapPayload,
  SITEMAP_MAX_URLS_PER_FILE,
} from "../lib/sitemapCache";
import { getSiteBaseUrl } from "../lib/siteUrl";
import { locales } from "../i18n/config";

export const revalidate = 3600;

function toAbsoluteUrl(path: string): string {
  const base = getSiteBaseUrl();
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
): MetadataRoute.Sitemap {
  return entries.map((e) => ({
    url: toAbsoluteUrl(e.path),
    lastModified: e.lastModified,
    changeFrequency: "weekly",
    priority,
  }));
}

export async function generateSitemaps() {
  const { staticEntries, adEntries } = await getCachedSitemapPayload();
  const total =
    expandForAllLocales(staticEntries).length + expandForAllLocales(adEntries).length;
  if (total <= SITEMAP_MAX_URLS_PER_FILE) {
    return [{ id: 0 }];
  }
  const adChunks = Math.ceil(adEntries.length / SITEMAP_MAX_URLS_PER_FILE);
  return [
    { id: 0 },
    ...Array.from({ length: adChunks }, (_, i) => ({ id: i + 1 })),
  ];
}

export default async function sitemap(props: {
  id: Promise<string>;
}): Promise<MetadataRoute.Sitemap> {
  const { staticEntries, adEntries } = await getCachedSitemapPayload();
  const staticUrls = mapEntries(expandForAllLocales(staticEntries), 0.9);
  const adUrls = mapEntries(expandForAllLocales(adEntries), 0.6);
  const total = staticUrls.length + adUrls.length;

  if (total <= SITEMAP_MAX_URLS_PER_FILE) {
    return [...staticUrls, ...adUrls];
  }

  const idNum = Number(await props.id);
  if (idNum === 0) return staticUrls;
  const start = (idNum - 1) * SITEMAP_MAX_URLS_PER_FILE;
  return adUrls.slice(start, start + SITEMAP_MAX_URLS_PER_FILE);
}

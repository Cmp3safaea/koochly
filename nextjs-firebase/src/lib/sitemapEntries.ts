import type { MetadataRoute } from "next";
import {
  getCachedSitemapPayload,
  SITEMAP_MAX_URLS_PER_FILE,
} from "./sitemapCache";
import { locales } from "@koochly/shared";

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

export async function buildSitemapEntries(base: string): Promise<MetadataRoute.Sitemap> {
  const { staticEntries, adEntries } = await getCachedSitemapPayload();
  const staticUrls = mapEntries(expandForAllLocales(staticEntries), 0.9, base);
  const adUrls = mapEntries(expandForAllLocales(adEntries), 0.6, base);
  const merged = [...staticUrls, ...adUrls];
  if (merged.length > SITEMAP_MAX_URLS_PER_FILE) {
    return merged.slice(0, SITEMAP_MAX_URLS_PER_FILE);
  }
  return merged;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function lastModElement(v: string | Date | undefined): string {
  if (v == null) return "";
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return `<lastmod>${xmlEscape(d.toISOString())}</lastmod>`;
}

export function sitemapEntriesToXml(entries: MetadataRoute.Sitemap): string {
  const lines = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
  ];
  for (const e of entries) {
    const loc = xmlEscape(e.url);
    const lm = lastModElement(e.lastModified);
    const cf = e.changeFrequency
      ? `<changefreq>${xmlEscape(String(e.changeFrequency))}</changefreq>`
      : "";
    const pr =
      typeof e.priority === "number"
        ? `<priority>${e.priority.toFixed(1)}</priority>`
        : "";
    lines.push(`<url><loc>${loc}</loc>${lm}${cf}${pr}</url>`);
  }
  lines.push(`</urlset>`);
  return lines.join("\n");
}

import { unstable_cache } from "next/cache";
import {
  buildSitemapEntries,
  type SitemapSourceEntry,
} from "./sitemapFirestore";

export const SITEMAP_MAX_URLS_PER_FILE = 49_000;

const getLiveCachedSitemapPayload = unstable_cache(
  () => buildSitemapEntries(),
  ["koochly-sitemap-v1"],
  { revalidate: 3600 },
);

/**
 * During `docker build` / Cloud Build there is no GCP ADC; Dockerfile sets
 * `NEXT_SITEMAP_BUILD_OFFLINE=1` for the builder only. We must not call
 * Firestore or populate `unstable_cache` for production keys with empty data.
 */
export function getCachedSitemapPayload() {
  if (process.env.NEXT_SITEMAP_BUILD_OFFLINE === "1") {
    return Promise.resolve({
      staticEntries: [{ path: "/" }],
      adEntries: [] as SitemapSourceEntry[],
    });
  }
  return getLiveCachedSitemapPayload();
}

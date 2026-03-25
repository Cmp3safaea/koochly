import { unstable_cache } from "next/cache";
import { buildSitemapEntries } from "./sitemapFirestore";

export const SITEMAP_MAX_URLS_PER_FILE = 49_000;

export const getCachedSitemapPayload = unstable_cache(
  () => buildSitemapEntries(),
  ["koochly-sitemap-v1"],
  { revalidate: 3600 },
);

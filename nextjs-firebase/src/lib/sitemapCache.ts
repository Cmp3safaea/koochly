import fs from "node:fs";
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

/** Created only during `docker build` (see root Dockerfile). */
const DOCKER_OFFLINE_SITEMAP_MARKER = "/tmp/koochly-offline-sitemap-build";

function isDockerImageBuildWithoutFirestore(): boolean {
  try {
    return fs.existsSync(DOCKER_OFFLINE_SITEMAP_MARKER);
  } catch {
    return false;
  }
}

/**
 * During `docker build` there is no GCP ADC. Next may run sitemap data
 * collection in a worker where `process.env` from the Dockerfile is missing
 * or inlined wrong, so we key off a marker file in `/tmp` instead.
 */
export function getCachedSitemapPayload() {
  if (
    isDockerImageBuildWithoutFirestore() ||
    process.env.NEXT_SITEMAP_BUILD_OFFLINE === "1"
  ) {
    return Promise.resolve({
      staticEntries: [{ path: "/" }],
      adEntries: [] as SitemapSourceEntry[],
    });
  }
  return getLiveCachedSitemapPayload();
}

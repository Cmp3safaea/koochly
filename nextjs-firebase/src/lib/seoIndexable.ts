/**
 * Indexable URL policy (sitemap + robots) for Persiana.
 *
 * **Included in sitemap**
 * - `/` — home
 * - `/{country_eng}/{city_eng}/` — city hub pages (only cities with both fields;
 *   see `isCityDocIndexable`)
 * - `/b/{seq}` — ad detail pages with a numeric `seq`, not explicitly rejected
 *
 * **Excluded**
 * - `/api/*` — disallow in robots.txt (not crawled as public HTML)
 * - `/city/{cityId}` — reachable for users/deep links but omitted from sitemap; canonical
 *   URL is the `/{country_eng}/{city_eng}/` hub when those fields exist
 * - Query-only variants (`?cat=&dept=`) — not listed; canonical hub is the bare city URL
 * - Ads with `approved === false`
 * - Ads without a usable numeric `seq`
 * - Cities with `active === false`
 * - Cities missing `country_eng` or `city_eng` (no stable hub path)
 *
 * **Notes**
 * - Treat missing `approved` as publishable (legacy documents).
 * - `active === true` matches the homepage listing; unset `active` is treated like active
 *   for hubs so legitimate cities are not dropped from discovery.
 */

/**
 * City listing pages (`/city/...`, `/{country}/{city}`, category hubs) should not be shown when
 * the city doc is explicitly deactivated. Missing `active` stays visible (legacy data).
 */
export function isCityActiveForPublicPages(data: Record<string, unknown>): boolean {
  return data.active !== false;
}

export function isCityDocIndexable(data: Record<string, unknown>): boolean {
  if (data.active === false) return false;
  const country =
    typeof data.country_eng === "string" ? data.country_eng.trim() : "";
  const city = typeof data.city_eng === "string" ? data.city_eng.trim() : "";
  return Boolean(country && city);
}

export function isAdDocIndexable(data: Record<string, unknown>): boolean {
  if (data.approved === false) return false;
  const seqRaw = data.seq;
  let seq: number | null = null;
  if (typeof seqRaw === "number" && Number.isFinite(seqRaw)) seq = seqRaw;
  else if (typeof seqRaw === "string") {
    const n = Number(seqRaw);
    if (Number.isFinite(n)) seq = n;
  }
  if (seq === null) return false;
  return seq > 0;
}

export function hubPathForCityDoc(data: Record<string, unknown>): string | null {
  if (!isCityDocIndexable(data)) return null;
  const country =
    typeof data.country_eng === "string" ? data.country_eng.trim() : "";
  const city = typeof data.city_eng === "string" ? data.city_eng.trim() : "";
  if (!country || !city) return null;
  return `/${encodeURIComponent(country)}/${encodeURIComponent(city)}/`;
}

/** Normalized listing `seq` for URLs (Firestore may store number or numeric string). */
export function coerceAdSeq(seq: unknown): number | null {
  if (typeof seq === "number" && Number.isFinite(seq) && seq > 0) {
    return Math.floor(seq);
  }
  if (typeof seq === "string") {
    const n = Number(seq.trim());
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return null;
}

function matchBPathSegment(haystack: string): string | null {
  const m = haystack.match(/\/b\/(\d+)/);
  return m?.[1] ?? null;
}

/**
 * Internal path for city listing cards (App Router navigation only).
 * Never returns external URLs.
 */
export function adListingPathFromAd(ad: {
  id?: string;
  url?: string;
  website?: string;
  seq?: unknown;
}): string | null {
  const url = typeof ad.url === "string" ? ad.url.trim() : "";
  if (url) {
    const n = matchBPathSegment(url);
    if (n) return `/b/${n}`;
  }
  const sn = coerceAdSeq(ad.seq);
  if (sn !== null) return `/b/${sn}`;
  const web = typeof ad.website === "string" ? ad.website.trim() : "";
  if (web) {
    const n = matchBPathSegment(web);
    if (n) return `/b/${n}`;
  }
  const id = typeof ad.id === "string" ? ad.id.trim() : "";
  if (id.length > 0 && !id.includes("/")) {
    return `/ad/${encodeURIComponent(id)}`;
  }
  return null;
}

import { FieldPath, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { unstable_cache } from "next/cache";
import { getFirestoreAdmin } from "./firebaseAdmin";

const ZW_RE = /[\u200B-\u200D\u2060\uFEFF]/g;

export function sanitizeCityKeyToken(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(ZW_RE, "").trim();
}

/** Every distinct `city_eng` / `city_fa` on approved ads (trimmed). */
export async function approvedAdCityKeySet(): Promise<Set<string>> {
  const db = getFirestoreAdmin();
  const keys = new Set<string>();
  const PAGE = 450;

  const ingestApproved = (data: Record<string, unknown>) => {
    if (data.approved !== true) return;
    const ce = sanitizeCityKeyToken(data.city_eng);
    const cf = sanitizeCityKeyToken(data.city_fa);
    if (ce) keys.add(ce);
    if (cf) keys.add(cf);
  };

  // Paginate the whole collection by document id (no composite index). Skipping ads without
  // `dateTime` — as in an `orderBy("dateTime")` scan — drops city keys and empties the home
  // city list when `onlyWithAds` filters Firestore cities.
  let last: QueryDocumentSnapshot | null = null;
  for (;;) {
    let q = db.collection("ad").orderBy(FieldPath.documentId()).limit(PAGE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) ingestApproved(d.data() as Record<string, unknown>);
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }

  return keys;
}

export function cityDocHasApprovedAds(
  cityData: Record<string, unknown>,
  adCityKeys: Set<string>,
): boolean {
  const fa = sanitizeCityKeyToken(cityData.city_fa);
  const en = sanitizeCityKeyToken(cityData.city_eng);
  if (en && adCityKeys.has(en)) return true;
  if (fa && adCityKeys.has(fa)) return true;
  return false;
}

/** Cached list for API + server pages (string[] is JSON-safe for unstable_cache). */
const readApprovedAdCityKeys = unstable_cache(
  async () => {
    const s = await approvedAdCityKeySet();
    return Array.from(s);
  },
  ["approved-ad-city-key-tokens-v2"],
  { revalidate: 300 },
);

export async function getApprovedAdCityKeysCached(): Promise<Set<string>> {
  const arr = await readApprovedAdCityKeys();
  return new Set(arr);
}

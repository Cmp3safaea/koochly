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

export type PublicCityRow = Record<string, unknown> & { id: string };

/** Shared by GET /api/cities and the home page RSC. */
export async function listPublicCities(options: {
  onlyWithAds: boolean;
}): Promise<{ cities: PublicCityRow[] }> {
  const { onlyWithAds } = options;
  const cityLimit = onlyWithAds ? 500 : 100;
  const db = getFirestoreAdmin();
  let snap;
  try {
    snap = await db.collection("cities").orderBy("order").limit(cityLimit).get();
  } catch {
    snap = await db.collection("cities").limit(cityLimit).get();
  }

  const cities: PublicCityRow[] = snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    if (typeof data.results === "string") {
      try {
        data.results = JSON.parse(data.results);
      } catch {
        // keep string
      }
    }
    const normalizedCurrencySymbol =
      typeof data.currency_symbol === "string" && data.currency_symbol.trim()
        ? data.currency_symbol.trim()
        : typeof data.currencySymbol === "string" && data.currencySymbol.trim()
          ? data.currencySymbol.trim()
          : typeof data.currency === "string" && data.currency.trim()
            ? data.currency.trim()
            : "";
    return { id: d.id, ...data, currency_symbol: normalizedCurrencySymbol };
  });

  cities.sort((a, b) => {
    const aoRaw = (a.order as unknown) ?? null;
    const boRaw = (b.order as unknown) ?? null;
    const ao =
      aoRaw === null ? Infinity : (() => {
        const n = Number(aoRaw);
        return Number.isFinite(n) ? n : Infinity;
      })();
    const bo =
      boRaw === null ? Infinity : (() => {
        const n = Number(boRaw);
        return Number.isFinite(n) ? n : Infinity;
      })();
    return ao - bo;
  });

  let out = cities.filter((c) => c.active !== false);
  if (onlyWithAds) {
    const adKeys = await getApprovedAdCityKeysCached();
    out = out.filter((c) => cityDocHasApprovedAds(c as Record<string, unknown>, adKeys));
  }
  return { cities: out };
}

export type PublicEventRow = {
  id: string;
  event: string;
  desc: string;
  event_image: string;
};

function titleFromEventDesc(desc: string): string {
  const lines = desc.split(/\r?\n/).map((l) => l.trim());
  const hit = lines.find((l) => l.length > 0);
  if (!hit) return "";
  return hit.length > 200 ? `${hit.slice(0, 197)}...` : hit;
}

/** Shared by GET /api/events and the home page RSC. */
export async function listPublicEvents(): Promise<{ events: PublicEventRow[] }> {
  const db = getFirestoreAdmin();
  const snap = await db.collection("events").get();
  const events = snap.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const desc =
      typeof data.desc === "string" && data.desc.trim() ? data.desc.trim() : "";
    const title =
      (typeof data.event === "string" && data.event.trim()) ||
      (typeof data.EventTitle === "string" && data.EventTitle.trim()) ||
      (typeof data.title === "string" && data.title.trim()) ||
      titleFromEventDesc(desc);
    const imageFromArray =
      Array.isArray(data.eventImage) &&
      typeof data.eventImage[0] === "string" &&
      data.eventImage[0].trim()
        ? data.eventImage[0].trim()
        : "";
    const imageFromScalar =
      (typeof data.event_image === "string" && data.event_image.trim()) ||
      (typeof data.eventImage === "string" && data.eventImage.trim()) ||
      "";
    return {
      id: doc.id,
      event: title,
      desc,
      event_image: imageFromArray || imageFromScalar,
    };
  });
  return { events };
}

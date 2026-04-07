import { NextResponse } from "next/server";
import { getFirestoreAdmin } from "../../../../lib/firebaseAdmin";

export const runtime = "nodejs";
const SCAN_CAP = 1200;

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeSubcats(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => asString(v))
    .filter((v, i, arr) => v.length > 0 && arr.indexOf(v) === i)
    .slice(0, 12);
}

function normalizeImages(data: Record<string, unknown>): string[] {
  const imgs = data.images;
  if (Array.isArray(imgs)) {
    return imgs
      .map((v) => asString(v))
      .filter((v) => v.length > 0)
      .slice(0, 12);
  }
  const single = asString(data.image);
  return single ? [single] : [];
}

function normalizeLocation(value: unknown): { lat: number; lng: number } | null {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const lat = asNumber(raw.__lat__ ?? raw.lat ?? raw.latitude);
  const lng = asNumber(raw.__lon__ ?? raw.lng ?? raw.lon ?? raw.longitude);
  if (lat === null || lng === null) return null;
  return { lat, lng };
}

function toMs(value: unknown): number {
  if (!value) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof value === "object") {
    const v = value as any;
    if (typeof v.toDate === "function") {
      const d = v.toDate();
      const t = d instanceof Date ? d.getTime() : Date.parse(String(d));
      return Number.isFinite(t) ? t : 0;
    }
    if (typeof v._seconds === "number") return v._seconds * 1000;
    if (typeof v.seconds === "number") return v.seconds * 1000;
  }
  return 0;
}

export async function GET(request: Request) {
  try {
    const db = getFirestoreAdmin();
    const { searchParams } = new URL(request.url);
    const q = asString(searchParams.get("q") ?? "");
    const qLower = q.toLowerCase();
    const seq = asNumber(searchParams.get("seq"));
    const limitRaw = asNumber(searchParams.get("limit"));
    const limit =
      limitRaw === null ? 200 : Math.max(1, Math.min(200, Math.floor(limitRaw)));
    const SCAN_CAP_FOR_SEARCH = 20000;
    const wantsSearchScan = !!qLower && seq === null;

    let docs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    if (seq !== null) {
      const bySeq = await db.collection("ad").where("seq", "==", seq).limit(30).get();
      docs = bySeq.docs;
    } else {
      // For dashboard/manage use-cases, prefer ordering by Firestore timestamp.
      // Fallback to scanning if an index is missing.
      let snap:
        | FirebaseFirestore.QuerySnapshot<FirebaseFirestore.DocumentData>
        | null = null;
      const dbQueryLimit = wantsSearchScan ? Math.max(limit, SCAN_CAP_FOR_SEARCH) : limit;
      const fallbackCap = wantsSearchScan ? dbQueryLimit : Math.max(limit, Math.min(SCAN_CAP, 1200));
      try {
        snap = await db.collection("ad").orderBy("dateTime", "desc").limit(dbQueryLimit).get();
      } catch {
        snap = await db.collection("ad").limit(fallbackCap).get();
      }
      docs = snap.docs;
    }

    const rows = docs
      .map((doc) => {
        const data = doc.data() as Record<string, unknown>;
        const images = normalizeImages(data);
        const subcat = normalizeSubcats(data.subcat).length
          ? normalizeSubcats(data.subcat)
          : normalizeSubcats(data.selectedCategoryTags);
        return {
          id: doc.id,
          seq: asNumber(data.seq),
          title: asString(data.title),
          engName: asString(data.engName),
          details: asString(data.details),
          address: asString(data.address),
          phone: asString(data.phone),
          website: asString(data.website),
          instagram: asString(data.instagram) || asString(data.instorgam),
          cat: asString(data.cat),
          cat_code: asString(data.cat_code),
          dept: asString(data.dept),
          city: asString(data.city),
          city_eng: asString(data.city_eng),
          approved: data.approved === true,
          paidAds: data.paidAds === true,
          paidAdsExpiresAtMs: data.paidAdsExpiresAt ? toMs(data.paidAdsExpiresAt) || null : null,
          subcat,
          images,
          image: images[0] ?? null,
          location: normalizeLocation(data.location),
          createdAtMs: toMs(data.dateTime),
        };
      })
      .filter((row) => {
        if (!qLower) return true;
        return (
          row.id.toLowerCase().includes(qLower) ||
          (row.title || "").toLowerCase().includes(qLower) ||
          (row.engName || "").toLowerCase().includes(qLower) ||
          (row.city_eng || "").toLowerCase().includes(qLower) ||
          (row.city || "").toLowerCase().includes(qLower) ||
          (row.cat || "").toLowerCase().includes(qLower) ||
          (row.cat_code || "").toLowerCase().includes(qLower) ||
          (row.dept || "").toLowerCase().includes(qLower) ||
          (row.phone || "").toLowerCase().includes(qLower) ||
          (row.seq !== null ? String(row.seq).includes(qLower) : false)
        );
      })
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .slice(0, limit);

    return NextResponse.json({ ads: rows });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

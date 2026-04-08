import { NextResponse } from "next/server";
import { getFirestoreAdmin } from "../../../../../lib/firebaseAdmin";

export const runtime = "nodejs";

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
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

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeLocation(value: unknown): { lat: number; lng: number } | null {
  const raw = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const lat = asNumber(raw.__lat__ ?? raw.lat ?? raw.latitude);
  const lng = asNumber(raw.__lon__ ?? raw.lng ?? raw.lon ?? raw.longitude);
  if (lat === null || lng === null) return null;
  return { lat, lng };
}

export async function GET() {
  try {
    const db = getFirestoreAdmin();
    // `where("approved","==",false)` misses docs with no `approved` field (treated as pending).
    const snap = await db.collection("ad").limit(1200).get();
    const ads = snap.docs
      .filter((doc) => {
        const d = doc.data() as Record<string, unknown>;
        return d.approved !== true;
      })
      .map((doc) => {
        const data = doc.data() as Record<string, unknown>;
        const images = normalizeImages(data);
        const subcatRaw = Array.isArray(data.subcat)
          ? data.subcat
          : Array.isArray(data.selectedCategoryTags)
            ? data.selectedCategoryTags
            : [];
        const subcat = (subcatRaw as unknown[])
          .map((v) => asString(v))
          .filter((v, i, arr) => v.length > 0 && arr.indexOf(v) === i)
          .slice(0, 8);
        return {
          id: doc.id,
          title: asString(data.title) || asString(data.engName) || doc.id,
          city: asString(data.city_eng) || asString(data.city) || "",
          dept: asString(data.dept),
          cat: asString(data.cat),
          subcat,
          phone: asString(data.phone),
          details: asString(data.details),
          paidAds: data.paidAds === true,
          paidAdsExpiresAtMs: data.paidAdsExpiresAt ? toMs(data.paidAdsExpiresAt) || null : null,
          seq: typeof data.seq === "number" ? data.seq : null,
          createdAtMs: toMs(data.dateTime),
          images,
          image: images[0] ?? null,
          location: normalizeLocation(data.location),
          address: asString(data.address),
          website: asString(data.website),
          instagram: asString(data.instagram) || asString(data.instorgam),
          engName: asString(data.engName),
          cat_code: asString(data.cat_code),
          city_eng: asString(data.city_eng),
        };
      })
      .sort((a, b) => b.createdAtMs - a.createdAtMs)
      .slice(0, 400);
    return NextResponse.json({ ads });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

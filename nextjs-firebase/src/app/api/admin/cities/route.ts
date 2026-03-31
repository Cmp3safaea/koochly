import { NextResponse } from "next/server";
import { FieldValue, GeoPoint } from "firebase-admin/firestore";
import { getFirestoreAdmin } from "../../../../lib/firebaseAdmin";

export const runtime = "nodejs";
const ADS_SCAN_CAP = 20000;

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asBoolean(v: unknown, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  return fallback;
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function sanitizeToken(value: string): string {
  return value.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim();
}

function toGeoPoint(value: unknown): GeoPoint | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const lat = asNumber(v.lat ?? v.latitude ?? v.__lat__);
  const lng = asNumber(v.lng ?? v.lon ?? v.longitude ?? v.__lon__);
  if (lat === null || lng === null) return null;
  return new GeoPoint(lat, lng);
}

export async function GET() {
  try {
    const db = getFirestoreAdmin();
    const [citySnap, adsSnap] = await Promise.all([
      db.collection("cities").limit(500).get(),
      db.collection("ads").limit(ADS_SCAN_CAP).get(),
    ]);

    const usageMap = new Map<string, number>();
    adsSnap.docs.forEach((doc) => {
      const ad = doc.data() as Record<string, unknown>;
      const cityEng = sanitizeToken(asString(ad.city_eng));
      if (!cityEng) return;
      usageMap.set(cityEng.toLowerCase(), (usageMap.get(cityEng.toLowerCase()) ?? 0) + 1);
    });

    const cities = citySnap.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const cityEng = sanitizeToken(asString(data.city_eng));
      const ll = (data.latlng ?? null) as
        | { latitude?: number; longitude?: number; lat?: number; lng?: number; __lat__?: number; __lon__?: number }
        | null;
      const lat = asNumber(ll?.latitude ?? ll?.lat ?? ll?.__lat__);
      const lng = asNumber(ll?.longitude ?? ll?.lng ?? ll?.__lon__);
      return {
        id: doc.id,
        active: asBoolean(data.active, false),
        city_eng: cityEng,
        city_fa: asString(data.city_fa),
        country_eng: asString(data.country_eng),
        country_fa: asString(data.country_fa),
        flag_url: asString(data.flag_url),
        currency_symbol: asString(data.currency_symbol),
        order: asNumber(data.order),
        latlng: lat !== null && lng !== null ? { lat, lng } : null,
        usageCount: usageMap.get(cityEng.toLowerCase()) ?? 0,
      };
    });

    cities.sort((a, b) => {
      const ao = a.order ?? Number.MAX_SAFE_INTEGER;
      const bo = b.order ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return a.city_eng.localeCompare(b.city_eng);
    });

    return NextResponse.json({ cities });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const cityEng = sanitizeToken(asString(body.city_eng));
    const cityFa = asString(body.city_fa);
    const countryEng = asString(body.country_eng);
    const countryFa = asString(body.country_fa);
    const flagUrl = asString(body.flag_url);
    const currencySymbol = asString(body.currency_symbol);
    const active = asBoolean(body.active, false);
    const order = asNumber(body.order);
    const requestedId = asString(body.id);
    const latlng = toGeoPoint(body.latlng);

    if (!cityEng && !cityFa) {
      return NextResponse.json(
        { error: "city_eng or city_fa is required" },
        { status: 400 },
      );
    }

    const db = getFirestoreAdmin();
    const ref = requestedId ? db.collection("cities").doc(requestedId) : db.collection("cities").doc();
    const payload: Record<string, unknown> = {
      active,
      city_eng: cityEng,
      city_fa: cityFa,
      country_eng: countryEng,
      country_fa: countryFa,
      flag_url: flagUrl,
      currency_symbol: currencySymbol,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    };
    if (order !== null) payload.order = order;
    if (latlng) payload.latlng = latlng;

    await ref.set(payload, { merge: true });
    return NextResponse.json({ ok: true, id: ref.id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

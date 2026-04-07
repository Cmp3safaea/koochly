import { NextResponse } from "next/server";
import { FieldValue, GeoPoint } from "firebase-admin/firestore";
import { getFirestoreAdmin } from "../../../../../lib/firebaseAdmin";

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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ cityId: string }> },
) {
  try {
    const { cityId: rawId } = await context.params;
    const cityId = asString(rawId);
    if (!cityId) return NextResponse.json({ error: "Invalid city id" }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const cityEng = sanitizeToken(asString(body.city_eng));
    const cityFa = asString(body.city_fa);
    if (!cityEng && !cityFa) {
      return NextResponse.json(
        { error: "city_eng or city_fa is required" },
        { status: 400 },
      );
    }
    const db = getFirestoreAdmin();
    const payload: Record<string, unknown> = {
      active: asBoolean(body.active, false),
      city_eng: cityEng,
      city_fa: cityFa,
      country_eng: asString(body.country_eng),
      country_fa: asString(body.country_fa),
      flag_url: asString(body.flag_url),
      currency_symbol: asString(body.currency_symbol),
      updatedAt: FieldValue.serverTimestamp(),
    };
    const order = asNumber(body.order);
    if (order !== null) payload.order = order;
    const latlng = toGeoPoint(body.latlng);
    if (latlng) payload.latlng = latlng;

    await db.collection("cities").doc(cityId).set(payload, { merge: true });
    return NextResponse.json({ ok: true, id: cityId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ cityId: string }> },
) {
  try {
    const { cityId: rawId } = await context.params;
    const cityId = asString(rawId);
    if (!cityId) return NextResponse.json({ error: "Invalid city id" }, { status: 400 });

    const db = getFirestoreAdmin();
    const cityDoc = await db.collection("cities").doc(cityId).get();
    if (!cityDoc.exists) return NextResponse.json({ error: "City not found" }, { status: 404 });

    const data = cityDoc.data() as Record<string, unknown>;
    const cityEng = sanitizeToken(asString(data.city_eng));
    const cityFa = asString(data.city_fa);

    const adsSnap = await db.collection("ad").limit(ADS_SCAN_CAP).get();
    const used = adsSnap.docs.some((doc) => {
      const ad = doc.data() as Record<string, unknown>;
      const adCityEng = sanitizeToken(asString(ad.city_eng));
      const adCityFa = asString(ad.city_fa);
      if (cityEng && adCityEng && adCityEng.toLowerCase() === cityEng.toLowerCase()) return true;
      if (cityFa && adCityFa && adCityFa === cityFa) return true;
      return false;
    });
    if (used) {
      return NextResponse.json(
        { error: "Cannot delete this city because it is used by ads." },
        { status: 409 },
      );
    }

    await db.collection("cities").doc(cityId).delete();
    return NextResponse.json({ ok: true, id: cityId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

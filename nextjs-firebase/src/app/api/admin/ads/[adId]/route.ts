import { NextResponse } from "next/server";
import { GeoPoint } from "firebase-admin/firestore";
import { getFirestoreAdmin } from "../../../../../lib/firebaseAdmin";

export const runtime = "nodejs";

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asBoolean(v: unknown, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  return fallback;
}

function normalizeSubcats(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => asString(v))
    .filter((v, i, arr) => v.length > 0 && arr.indexOf(v) === i)
    .slice(0, 12);
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeImages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => asString(v))
    .filter((v) => v.length > 0)
    .slice(0, 12);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ adId: string }> },
) {
  try {
    const { adId: raw } = await context.params;
    const adId = asString(raw);
    if (!adId) return NextResponse.json({ error: "Invalid ad id" }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const db = getFirestoreAdmin();
    const ref = db.collection("ad").doc(adId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Ad not found" }, { status: 404 });

    const payload: Record<string, unknown> = {
      title: asString(body.title),
      engName: asString(body.engName),
      details: asString(body.details),
      address: asString(body.address),
      phone: asString(body.phone),
      website: asString(body.website),
      instagram: asString(body.instagram),
      cat: asString(body.cat),
      cat_code: asString(body.cat_code),
      dept: asString(body.dept),
      city: asString(body.city),
      city_eng: asString(body.city_eng),
      approved: asBoolean(body.approved, false),
      paidAds: asBoolean(body.paidAds, false),
    };
    const loc = (body.location && typeof body.location === "object"
      ? body.location
      : {}) as Record<string, unknown>;
    const lat = asNumber(loc.lat ?? loc.latitude ?? loc.__lat__);
    const lng = asNumber(loc.lng ?? loc.lon ?? loc.longitude ?? loc.__lon__);
    payload.location =
      lat !== null && lng !== null
        ? new GeoPoint(lat, lng)
        : null;

    const expMs = asNumber(body.paidAdsExpiresAtMs);
    payload.paidAdsExpiresAt = payload.paidAds === true && expMs !== null ? new Date(expMs) : null;
    const images = normalizeImages(body.images);
    if (images.length > 0) {
      payload.images = images;
      payload.image = images[0];
    } else {
      payload.images = [];
      payload.image = "";
    }
    const subcat = normalizeSubcats(body.subcat);
    payload.subcat = subcat;
    payload.selectedCategoryTags = subcat;

    await ref.set(payload, { merge: true });
    return NextResponse.json({ ok: true, id: adId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ adId: string }> },
) {
  try {
    const { adId: raw } = await context.params;
    const adId = asString(raw);
    if (!adId) return NextResponse.json({ error: "Invalid ad id" }, { status: 400 });
    const db = getFirestoreAdmin();
    await db.collection("ad").doc(adId).delete();
    return NextResponse.json({ ok: true, id: adId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import { FieldValue, GeoPoint } from "firebase-admin/firestore";
import { getFirebaseAuthAdmin, getFirestoreAdmin } from "../../../../lib/firebaseAdmin";

export const runtime = "nodejs";

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

function toGeoPoint(value: unknown): GeoPoint {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const lat = asNumber(v.lat ?? v.latitude ?? v.__lat__) ?? 0;
  const lng = asNumber(v.lng ?? v.lon ?? v.longitude ?? v.__lon__) ?? 0;
  return new GeoPoint(lat, lng);
}

async function uidFromRequest(request: Request): Promise<string | null> {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!token) return null;
  try {
    const auth = getFirebaseAuthAdmin();
    const decoded = await auth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

function normalizeBookmarkIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of value) {
    const s = typeof x === "string" ? x.trim() : String(x).trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 500) break;
  }
  return out;
}

async function resolveCityFromCollection(db: FirebaseFirestore.Firestore, rawCity: unknown): Promise<string> {
  const city = asString(rawCity);
  if (!city) return "";
  const byFa = await db.collection("cities").where("city_fa", "==", city).limit(1).get();
  if (!byFa.empty) {
    const d = byFa.docs[0].data() as Record<string, unknown>;
    return asString(d.city_fa) || asString(d.city_eng) || city;
  }
  const byEng = await db.collection("cities").where("city_eng", "==", city).limit(1).get();
  if (!byEng.empty) {
    const d = byEng.docs[0].data() as Record<string, unknown>;
    return asString(d.city_fa) || asString(d.city_eng) || city;
  }
  throw new Error("Selected city is invalid");
}

export async function GET(request: Request) {
  try {
    const uid = await uidFromRequest(request);
    if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const db = getFirestoreAdmin();
    const ref = db.collection("users").doc(uid);
    const snap = await ref.get();
    const data = snap.exists ? (snap.data() as Record<string, unknown>) : {};
    const rawLoc = (data.location ?? null) as
      | { latitude?: number; longitude?: number; lat?: number; lng?: number; __lat__?: number; __lon__?: number }
      | null;
    const lat = asNumber(rawLoc?.latitude ?? rawLoc?.lat ?? rawLoc?.__lat__) ?? 0;
    const lng = asNumber(rawLoc?.longitude ?? rawLoc?.lng ?? rawLoc?.__lon__) ?? 0;
    return NextResponse.json({
      profile: {
        uid,
        display_name: asString(data.display_name),
        email: asString(data.email),
        phone_number: asString(data.phone_number),
        city: asString(data.city),
        address: asString(data.address),
        website: asString(data.website),
        instogram: asString(data.instogram),
        isBusiness: asBoolean(data.isBusiness, false),
        photo_url: asString(data.photo_url),
        url: asString(data.url),
        location: { lat, lng },
        bookmarkedAdIds: normalizeBookmarkIds(data.bookmarkedAdIds),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const uid = await uidFromRequest(request);
    if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const db = getFirestoreAdmin();
    const ref = db.collection("users").doc(uid);
    const existing = await ref.get();
    const prev = existing.exists ? (existing.data() as Record<string, unknown>) : {};

    const city = await resolveCityFromCollection(db, body.city);

    await ref.set(
      {
        uid,
        display_name: asString(body.display_name),
        phone_number: asString(body.phone_number),
        city,
        address: asString(body.address),
        website: asString(body.website),
        instogram: asString(body.instogram),
        isBusiness: asBoolean(body.isBusiness, false),
        photo_url: asString(body.photo_url) || asString(prev.photo_url),
        email: asString(prev.email),
        url: asString(prev.url),
        location: toGeoPoint(body.location),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

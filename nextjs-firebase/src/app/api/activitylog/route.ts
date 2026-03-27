import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAuthAdmin, getFirestoreAdmin } from "../../../lib/firebaseAdmin";

export const runtime = "nodejs";

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asStringList(v: unknown, max = 20): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => asString(x))
    .filter((x, i, arr) => x.length > 0 && arr.indexOf(x) === i)
    .slice(0, max);
}

async function uidFromBearer(request: Request): Promise<string | null> {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!token) return null;
  try {
    const decoded = await getFirebaseAuthAdmin().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  try {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const uid = (await uidFromBearer(request)) ?? (asString(b.uid) || null);
    const anonId = asString(b.anonId).slice(0, 120);
    if (!uid && !anonId) return NextResponse.json({ ok: true, skipped: "no_actor" });

    const db = getFirestoreAdmin();
    const page = asString(b.page).slice(0, 120);
    const city = asString(b.city).slice(0, 120);
    const adId = asString(b.adId).slice(0, 120);
    const departmentIds = asStringList(b.departmentIds, 12);
    const categoryCodes = asStringList(b.categoryCodes, 16);
    const pathname = asString(b.pathname).slice(0, 240);

    // Very lightweight write: one small document per activity event.
    await db.collection("activitylog").add({
      uid: uid || null,
      anonId: anonId || null,
      actorId: uid || `anon:${anonId}`,
      isAnonymous: !uid,
      page,
      pathname,
      city,
      adId: adId || null,
      departmentIds,
      categoryCodes,
      at: FieldValue.serverTimestamp(),
      day: new Date().toISOString().slice(0, 10),
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}


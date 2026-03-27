import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAuthAdmin, getFirestoreAdmin } from "../../../../lib/firebaseAdmin";

export const runtime = "nodejs";

const MAX_BOOKMARKS = 500;

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

async function uidFromRequest(request: Request): Promise<string | null> {
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

function normalizeBookmarkIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of value) {
    const s = typeof x === "string" ? x.trim() : String(x).trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= MAX_BOOKMARKS) break;
  }
  return out;
}

/**
 * POST body: { adId: string, bookmark: boolean }
 * Updates `users/{uid}.bookmarkedAdIds` (array of ad document IDs).
 */
export async function POST(request: Request) {
  try {
    const uid = await uidFromRequest(request);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const adId = asString(body.adId);
    const bookmark = body.bookmark === true;
    if (!adId) {
      return NextResponse.json({ error: "adId is required" }, { status: 400 });
    }

    const db = getFirestoreAdmin();
    const ref = db.collection("users").doc(uid);

    const bookmarkedAdIds = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const prev = snap.exists ? (snap.data() as Record<string, unknown>).bookmarkedAdIds : [];
      const arr = normalizeBookmarkIds(prev);
      const set = new Set(arr);
      if (bookmark) {
        set.add(adId);
      } else {
        set.delete(adId);
      }
      const next = Array.from(set).slice(0, MAX_BOOKMARKS);
      tx.set(
        ref,
        {
          uid,
          bookmarkedAdIds: next,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      return next;
    });

    return NextResponse.json({ ok: true, bookmarkedAdIds });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

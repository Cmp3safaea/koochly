import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getFirebaseAuthAdmin, getFirestoreAdmin } from "../../../../../lib/firebaseAdmin";
import { reviewSummaryFromAdData } from "../../../../../lib/adReviewSummary";

export const runtime = "nodejs";

const MAX_TEXT = 2000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

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

function displayNameFromToken(decoded: {
  name?: string;
  email?: string;
}): string {
  const n = typeof decoded.name === "string" ? decoded.name.trim() : "";
  if (n) return n.slice(0, 120);
  const email = typeof decoded.email === "string" ? decoded.email.trim() : "";
  if (email && email.includes("@")) return email.split("@")[0]!.slice(0, 120);
  return "User";
}

function serializeReview(
  id: string,
  data: Record<string, unknown> | undefined,
): {
  id: string;
  rating: number;
  text: string;
  displayName: string;
  createdAt: number | null;
  updatedAt: number | null;
} | null {
  if (!data) return null;
  const rating = typeof data.rating === "number" && Number.isFinite(data.rating) ? Math.round(data.rating) : 0;
  if (rating < 1 || rating > 5) return null;
  const text = typeof data.text === "string" ? data.text : "";
  const displayName = typeof data.displayName === "string" ? data.displayName : "";
  const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : null;
  const updatedAt = data.updatedAt instanceof Timestamp ? data.updatedAt.toMillis() : null;
  return { id, rating, text, displayName, createdAt, updatedAt };
}

function parseCursor(raw: string | null): { t: number; id: string } | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const json = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as unknown;
    if (!json || typeof json !== "object") return null;
    const o = json as Record<string, unknown>;
    const t = typeof o.t === "number" && Number.isFinite(o.t) ? o.t : null;
    const id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : null;
    if (t === null || !id) return null;
    return { t, id };
  } catch {
    return null;
  }
}

function encodeCursor(t: number, id: string): string {
  return Buffer.from(JSON.stringify({ t, id }), "utf8").toString("base64url");
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const adId = typeof rawId === "string" ? rawId.trim() : "";
  if (!adId || adId.length > 512) {
    return NextResponse.json({ error: "invalid_ad_id" }, { status: 400 });
  }

  const url = new URL(request.url);
  const limitRaw = url.searchParams.get("limit");
  let limit = DEFAULT_LIMIT;
  if (limitRaw) {
    const n = Number(limitRaw);
    if (Number.isFinite(n)) limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
  }
  const cursor = parseCursor(url.searchParams.get("cursor"));

  try {
    const db = getFirestoreAdmin();
    const adRef = db.collection("ads").doc(adId);
    const adSnap = await adRef.get();
    if (!adSnap.exists) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const adData = adSnap.data() as Record<string, unknown>;
    if (adData.approved !== true) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }

    const summary = reviewSummaryFromAdData(adData);

    let q = adRef
      .collection("reviews")
      .orderBy("createdAt", "desc")
      .orderBy(FieldPath.documentId(), "desc")
      .limit(limit + 1);

    if (cursor) {
      q = q.startAfter(Timestamp.fromMillis(cursor.t), cursor.id);
    }

    const snap = await q.get();
    const docs = snap.docs;
    const hasMore = docs.length > limit;
    const pageDocs = hasMore ? docs.slice(0, limit) : docs;

    const reviews = pageDocs
      .map((d) => serializeReview(d.id, d.data()))
      .filter((r): r is NonNullable<typeof r> => r !== null);

    const last = pageDocs[pageDocs.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor(
            last.data().createdAt instanceof Timestamp
              ? (last.data().createdAt as Timestamp).toMillis()
              : 0,
            last.id,
          )
        : null;

    let myReview: (typeof reviews)[0] | null = null;
    const uid = await uidFromRequest(request);
    if (uid) {
      const mine = await adRef.collection("reviews").doc(uid).get();
      if (mine.exists) {
        myReview = serializeReview(mine.id, mine.data());
      }
    }

    return NextResponse.json({
      summary,
      reviews,
      nextCursor,
      myReview,
    });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const adId = typeof rawId === "string" ? rawId.trim() : "";
  if (!adId || adId.length > 512) {
    return NextResponse.json({ error: "invalid_ad_id" }, { status: 400 });
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let uid: string;
  let displayName: string;
  try {
    const auth = getFirebaseAuthAdmin();
    const decoded = await auth.verifyIdToken(token);
    uid = decoded.uid;
    displayName = displayNameFromToken(decoded);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const o = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const ratingRaw = o.rating;
  const rating =
    typeof ratingRaw === "number" && Number.isFinite(ratingRaw)
      ? Math.round(ratingRaw)
      : typeof ratingRaw === "string" && ratingRaw.trim()
        ? Math.round(Number(ratingRaw))
        : NaN;
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "invalid_rating" }, { status: 400 });
  }

  let text = typeof o.text === "string" ? o.text.trim() : "";
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT);

  const db = getFirestoreAdmin();
  const adRef = db.collection("ads").doc(adId);
  const revRef = adRef.collection("reviews").doc(uid);

  try {
    await db.runTransaction(async (tx) => {
      const adSnap = await tx.get(adRef);
      if (!adSnap.exists) throw new Error("not_found");
      const adData = adSnap.data() as Record<string, unknown>;
      if (adData.approved !== true) throw new Error("not_found");

      let sum =
        typeof adData.reviewRatingSum === "number" && Number.isFinite(adData.reviewRatingSum)
          ? adData.reviewRatingSum
          : 0;
      let count =
        typeof adData.reviewCount === "number" && Number.isFinite(adData.reviewCount)
          ? Math.max(0, Math.floor(adData.reviewCount))
          : 0;

      const prevSnap = await tx.get(revRef);
      const had = prevSnap.exists;
      const prevData = prevSnap.data() as Record<string, unknown> | undefined;
      const oldR =
        prevData && typeof prevData.rating === "number" && Number.isFinite(prevData.rating)
          ? Math.round(prevData.rating)
          : 0;

      if (had) {
        sum = sum - oldR + rating;
      } else {
        sum += rating;
        count += 1;
      }

      const now = FieldValue.serverTimestamp();
      if (had) {
        tx.update(revRef, {
          rating,
          text,
          displayName,
          updatedAt: now,
        });
      } else {
        tx.set(revRef, {
          rating,
          text,
          displayName,
          createdAt: now,
          updatedAt: now,
        });
      }

      tx.update(adRef, {
        reviewRatingSum: sum,
        reviewCount: count,
      });
    });

    const freshAd = await adRef.get();
    const summary = reviewSummaryFromAdData(freshAd.data() as Record<string, unknown>);
    const revSnap = await revRef.get();
    const saved = serializeReview(revSnap.id, revSnap.data());

    return NextResponse.json({ ok: true, summary, review: saved });
  } catch (e) {
    if (e instanceof Error && e.message === "not_found") {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    console.error(e);
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

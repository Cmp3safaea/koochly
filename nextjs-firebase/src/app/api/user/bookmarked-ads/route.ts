import { NextResponse } from "next/server";
import { getFirebaseAuthAdmin, getFirestoreAdmin } from "../../../../lib/firebaseAdmin";
import { firstAdImageUrl } from "@koochly/shared";

export const runtime = "nodejs";

const MAX_LIST = 100;

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

function atToMs(at: unknown): number {
  if (!at) return 0;
  if (typeof at === "object" && at !== null && typeof (at as { toDate?: () => Date }).toDate === "function") {
    const d = (at as { toDate: () => Date }).toDate();
    return d instanceof Date ? d.getTime() : 0;
  }
  const v = at as Record<string, unknown>;
  if (typeof v._seconds === "number") return v._seconds * 1000;
  if (typeof v.seconds === "number") return v.seconds * 1000;
  return 0;
}

function normalizeSubcats(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v, i, arr) => v.length > 0 && arr.indexOf(v) === i)
    .slice(0, 8);
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

/**
 * GET saved ads for the signed-in user (`users/{uid}.bookmarkedAdIds`).
 * Most recently bookmarked first (Firestore array order: last added wins visual order).
 */
export async function GET(request: Request) {
  try {
    const uid = await uidFromRequest(request);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = getFirestoreAdmin();
    const userSnap = await db.collection("users").doc(uid).get();
    const bookmarkedAdIds = userSnap.exists
      ? normalizeBookmarkIds((userSnap.data() as Record<string, unknown>).bookmarkedAdIds)
      : [];

    const ordered = [...bookmarkedAdIds].reverse().slice(0, MAX_LIST);

    const ads = await Promise.all(
      ordered.map(async (adId) => {
        const adSnap = await db.collection("ad").doc(adId).get();
        let seq: number | null = null;
        let title = "";
        let engName: string | null = null;
        let category: string | null = null;
        let description: string | null = null;
        let subcats: string[] = [];
        let image: string | null = null;
        let phone: string | null = null;
        let city = "";
        let hrefPath: string | null = null;
        let approved = false;
        let paidAds = false;
        let paidAdsExpiresAtMs: number | null = null;

        if (adSnap.exists) {
          const data = adSnap.data() as Record<string, unknown>;
          seq = asNumber(data.seq);
          const titleRaw =
            asString(data.title) ||
            asString(data.engName) ||
            (typeof seq === "number" ? `#${seq}` : adId);
          title = titleRaw;
          const engRaw = asString(data.engName);
          engName = engRaw && engRaw !== titleRaw ? engRaw : null;
          const catV = asString(data.cat);
          const deptV = asString(data.dept);
          category = catV || deptV || null;
          const det = asString(data.details);
          description = det.length > 0 ? det : null;
          subcats = normalizeSubcats(data.subcat).length
            ? normalizeSubcats(data.subcat)
            : normalizeSubcats(data.selectedCategoryTags);
          image = firstAdImageUrl({
            images: data.images,
            image: data.image,
          });
          const ph = asString(data.phone);
          phone = ph.length > 0 ? ph : null;
          city = asString(data.city_eng) || asString(data.city_fa) || asString(data.city) || "";
          if (seq !== null) hrefPath = `/b/${seq}`;
          approved = data.approved === true;
          paidAds = data.paidAds === true;
          const exp = atToMs(data.paidAdsExpiresAt);
          paidAdsExpiresAtMs = paidAds && exp > 0 ? exp : null;
        }

        return {
          adId,
          seq,
          title,
          engName,
          category,
          description,
          subcats,
          image,
          phone,
          city,
          hrefPath,
          missing: !adSnap.exists,
          approved,
          paidAds,
          paidAdsExpiresAtMs,
        };
      }),
    );

    return NextResponse.json({ ads });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

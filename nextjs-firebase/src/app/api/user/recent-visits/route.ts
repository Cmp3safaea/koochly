import type { QuerySnapshot } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getFirebaseAuthAdmin, getFirestoreAdmin } from "../../../../lib/firebaseAdmin";

export const runtime = "nodejs";

const SCAN_LIMIT = 400;

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

function hrefFromPathname(pathname: string): string | null {
  const m = pathname.match(/\/b\/(\d+)/);
  return m?.[1] ? `/b/${m[1]}` : null;
}

function normalizeSubcats(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v, i, arr) => v.length > 0 && arr.indexOf(v) === i)
    .slice(0, 8);
}

function getFirstImage(data: Record<string, unknown>): string | null {
  const imgs = data.images;
  if (Array.isArray(imgs) && imgs.length > 0 && typeof imgs[0] === "string") {
    const u = imgs[0].trim();
    return u.length > 0 ? u : null;
  }
  const single = asString(data.image);
  return single || null;
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
 * GET recent unique ad detail views for the signed-in user (from `activitylog`).
 * Requires Firestore composite index: collection `activitylog` — fields `uid` (Asc), `at` (Desc).
 */
export async function GET(request: Request) {
  try {
    const uid = await uidFromRequest(request);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = getFirestoreAdmin();
    let snap: QuerySnapshot;
    try {
      snap = await db
        .collection("activitylog")
        .where("uid", "==", uid)
        .orderBy("at", "desc")
        .limit(SCAN_LIMIT)
        .get();
    } catch {
      return NextResponse.json(
        {
          error:
            "activitylog query failed. Add a Firestore composite index: activitylog — uid Asc, at Desc.",
        },
        { status: 500 },
      );
    }

    type Pick = { adId: string; viewedAtMs: number; pathname: string };
    const seen = new Set<string>();
    const picks: Pick[] = [];

    for (const doc of snap.docs) {
      const d = doc.data() as Record<string, unknown>;
      if (asString(d.page) !== "ad_detail") continue;
      const adId = asString(d.adId);
      if (!adId || seen.has(adId)) continue;
      seen.add(adId);
      const viewedAtMs = atToMs(d.at);
      if (!viewedAtMs) continue;
      picks.push({
        adId,
        viewedAtMs,
        pathname: asString(d.pathname).slice(0, 240),
      });
      if (picks.length >= 10) break;
    }

    const visits = await Promise.all(
      picks.map(async ({ adId, viewedAtMs, pathname }) => {
        const adSnap = await db.collection("ads").doc(adId).get();
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
          image = getFirstImage(data);
          const ph = asString(data.phone);
          phone = ph.length > 0 ? ph : null;
          city = asString(data.city_eng) || asString(data.city) || "";
          if (seq !== null) hrefPath = `/b/${seq}`;
          approved = data.approved === true;
          paidAds = data.paidAds === true;
          const exp = atToMs(data.paidAdsExpiresAt);
          paidAdsExpiresAtMs = paidAds && exp > 0 ? exp : null;
        }

        if (!hrefPath) hrefPath = hrefFromPathname(pathname);

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
          viewedAtMs,
          hrefPath,
          missing: !adSnap.exists,
          approved,
          paidAds,
          paidAdsExpiresAtMs,
        };
      }),
    );

    return NextResponse.json({ visits });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

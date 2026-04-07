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
 * List ads owned by the signed-in user (`ads.user` == users/{uid}).
 */
export async function GET(request: Request) {
  try {
    const uid = await uidFromRequest(request);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const db = getFirestoreAdmin();
    const userRef = db.collection("users").doc(uid);
    const snap = await db.collection("ad").where("user", "==", userRef).limit(200).get();

    const rows = snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return { id: d.id, data, at: atToMs(data.dateTime) };
    });
    rows.sort((a, b) => b.at - a.at);
    const sliced = rows.slice(0, MAX_LIST);

    const ads = sliced.map(({ id, data }) => {
      const seq = asNumber(data.seq);
      const titleRaw =
        asString(data.title) ||
        asString(data.engName) ||
        (typeof seq === "number" ? `#${seq}` : id);
      const city =
        asString(data.city_eng) || asString(data.city_fa) || asString(data.city) || "";
      return {
        adId: id,
        seq,
        title: titleRaw,
        approved: data.approved === true,
        image: firstAdImageUrl({
          images: data.images,
          image: data.image,
        }),
        city,
      };
    });

    return NextResponse.json({ ads });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

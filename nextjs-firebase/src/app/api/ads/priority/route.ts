import { NextResponse } from "next/server";
import { getFirestoreAdmin } from "../../../../lib/firebaseAdmin";
import { isAdDocIndexable } from "../../../../lib/seoIndexable";

/** Max ads returned for mobile “priority” carousel */
const LIMIT = 35;
/** Scan cap (same order of magnitude as city page fallback) */
const SCAN_CAP = 800;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function getFirstImage(data: Record<string, unknown>): string | null {
  const imgs = data.images;
  if (Array.isArray(imgs) && imgs.length > 0 && typeof imgs[0] === "string") {
    return imgs[0];
  }
  if (typeof data.image === "string") return data.image;
  return null;
}

/** Higher = more important: boolean `priority`, or numeric `priority` */
function priorityScore(data: Record<string, unknown>): number {
  const p = data.priority;
  if (p === true) return 1_000_000;
  if (typeof p === "number" && Number.isFinite(p) && p > 0) return Math.min(p, 999_999);
  if (typeof p === "string") {
    const n = Number(p);
    if (Number.isFinite(n) && n > 0) return Math.min(n, 999_999);
  }
  return 0;
}

function visitsNum(data: Record<string, unknown>): number {
  const v = data.visits;
  if (typeof v === "number" && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  return 0;
}

function seqNum(data: Record<string, unknown>): number {
  const s = data.seq;
  if (typeof s === "number" && Number.isFinite(s)) return s;
  if (typeof s === "string") {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  return Number.MAX_SAFE_INTEGER;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET() {
  try {
    const db = getFirestoreAdmin();
    const snap = await db.collection("ads").limit(SCAN_CAP).get();

    const rows: Array<Record<string, unknown> & { id: string }> = snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return { ...data, id: d.id };
    });

    const eligible = rows.filter((row) => isAdDocIndexable(row));

    eligible.sort((a, b) => {
      const p = priorityScore(b) - priorityScore(a);
      if (p !== 0) return p;
      const v = visitsNum(b) - visitsNum(a);
      if (v !== 0) return v;
      return seqNum(a) - seqNum(b);
    });

    const top = eligible.slice(0, LIMIT);

    const ads = top.map((data) => {
      const title =
        typeof data.title === "string" && data.title.trim()
          ? data.title.trim()
          : typeof data.engName === "string" && data.engName.trim()
            ? data.engName.trim()
            : String(data.id);

      const category =
        (typeof data.cat === "string" && data.cat.trim()) ||
        (typeof data.dept === "string" && data.dept.trim()) ||
        "";

      return {
        id: data.id,
        seq: seqNum(data),
        title,
        category,
        cityFa: typeof data.city_fa === "string" ? data.city_fa : "",
        cityEng: typeof data.city_eng === "string" ? data.city_eng : "",
        image: getFirstImage(data),
        isPriority: priorityScore(data) > 0,
      };
    });

    return NextResponse.json({ ads }, { headers: corsHeaders });
  } catch (e) {
    console.error(e);
    return NextResponse.json(
      { error: "Failed to load priority ads" },
      { status: 500, headers: corsHeaders },
    );
  }
}

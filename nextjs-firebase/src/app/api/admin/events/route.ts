import { NextResponse } from "next/server";
import { requireAdminRequest } from "../../../../lib/adminAuth";
import { getFirestoreAdmin } from "../../../../lib/firebaseAdmin";

export const runtime = "nodejs";

type EventRow = {
  id: string;
  event: string;
  desc: string;
  event_image: string;
  city: string;
  city_eng: string;
  venue: string;
  link: string;
  startAtMs: number | null;
  endAtMs: number | null;
  createdAtMs: number;
};

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

function toMs(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === "object") {
    const v = value as Record<string, unknown> & {
      toDate?: () => Date;
      _seconds?: number;
      seconds?: number;
    };
    if (typeof v.toDate === "function") {
      const d = v.toDate();
      return d instanceof Date ? d.getTime() : null;
    }
    if (typeof v._seconds === "number") return v._seconds * 1000;
    if (typeof v.seconds === "number") return v.seconds * 1000;
  }
  return null;
}

/** First non-empty line of description (legacy events often have no `event` field). */
function titleFromDesc(desc: string): string {
  const lines = desc.split(/\r?\n/).map((l) => l.trim());
  const hit = lines.find((l) => l.length > 0);
  if (!hit) return "";
  return hit.length > 200 ? `${hit.slice(0, 197)}…` : hit;
}

export async function GET(request: Request) {
  const deny = await requireAdminRequest(request);
  if (deny) return deny;
  try {
    const db = getFirestoreAdmin();
    const { searchParams } = new URL(request.url);
    const q = asString(searchParams.get("q")).toLowerCase();
    const city = asString(searchParams.get("city")).toLowerCase();
    const limitRaw = asNumber(searchParams.get("limit"));
    const limit = limitRaw === null ? 150 : Math.max(1, Math.min(300, Math.floor(limitRaw)));

    // Do not use orderBy("startAt") — documents without that field would be omitted entirely.
    const snap = await db.collection("events").limit(1000).get();

    const events = snap.docs
      .map((doc): EventRow => {
        const data = doc.data() as Record<string, unknown>;
        const desc = asString(data.desc);
        const event =
          asString(data.event) ||
          asString(data.EventTitle) ||
          asString(data.title) ||
          titleFromDesc(desc) ||
          doc.id;
        const imageFromArray =
          Array.isArray(data.eventImage) && typeof data.eventImage[0] === "string"
            ? asString(data.eventImage[0])
            : "";
        const event_image =
          imageFromArray || asString(data.event_image) || asString(data.image) || "";
        const startAtMs =
          toMs(data.eventDateFrom) ?? toMs(data.startAt) ?? toMs(data.startDate);
        const endAtMs =
          toMs(data.eventDateTo) ?? toMs(data.endAt) ?? toMs(data.endDate);
        return {
          id: doc.id,
          event,
          desc,
          event_image,
          city: asString(data.city),
          city_eng: asString(data.city_eng),
          venue: asString(data.venue),
          link: asString(data.link) || asString(data.url),
          startAtMs,
          endAtMs,
          createdAtMs: toMs(data.createdAt) ?? toMs(data.dateTime) ?? 0,
        };
      })
      .filter((row) => {
        if (city) {
          const cityFa = row.city.toLowerCase();
          const cityEn = row.city_eng.toLowerCase();
          if (!cityFa.includes(city) && !cityEn.includes(city)) return false;
        }
        if (!q) return true;
        return (
          row.id.toLowerCase().includes(q) ||
          row.event.toLowerCase().includes(q) ||
          row.desc.toLowerCase().includes(q) ||
          row.city.toLowerCase().includes(q) ||
          row.city_eng.toLowerCase().includes(q) ||
          row.venue.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const ao = a.startAtMs ?? a.createdAtMs;
        const bo = b.startAtMs ?? b.createdAtMs;
        return bo - ao;
      })
      .slice(0, limit);

    return NextResponse.json({ events });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const deny = await requireAdminRequest(request);
  if (deny) return deny;
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const event =
      asString(body.event) || titleFromDesc(asString(body.desc));
    if (!event) return NextResponse.json({ error: "Event title is required" }, { status: 400 });

    const startAtMs = asNumber(body.startAtMs);
    const endAtMs = asNumber(body.endAtMs);
    const dateTime =
      startAtMs !== null ? new Date(startAtMs) : new Date();

    const payload: Record<string, unknown> = {
      event,
      EventTitle: event,
      desc: asString(body.desc),
      event_image: asString(body.event_image),
      eventImage: asString(body.event_image) ? [asString(body.event_image)] : [],
      city: asString(body.city),
      city_eng: asString(body.city_eng),
      venue: asString(body.venue),
      link: asString(body.link),
      url: asString(body.link),
      eventDateFrom: startAtMs !== null ? new Date(startAtMs) : null,
      eventDateTo: endAtMs !== null ? new Date(endAtMs) : null,
      dateTime,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const db = getFirestoreAdmin();
    const ref = await db.collection("events").add(payload);
    return NextResponse.json({ ok: true, id: ref.id });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

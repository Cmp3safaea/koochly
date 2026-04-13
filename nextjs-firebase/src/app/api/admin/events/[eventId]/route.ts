import { NextResponse } from "next/server";
import { requireAdminRequest } from "../../../../../lib/adminAuth";
import { getFirestoreAdmin } from "../../../../../lib/firebaseAdmin";

export const runtime = "nodejs";

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

function titleFromDesc(desc: string): string {
  const lines = desc.split(/\r?\n/).map((l) => l.trim());
  const hit = lines.find((l) => l.length > 0);
  if (!hit) return "";
  return hit.length > 200 ? `${hit.slice(0, 197)}…` : hit;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) {
  const deny = await requireAdminRequest(request);
  if (deny) return deny;
  try {
    const { eventId: raw } = await context.params;
    const eventId = asString(raw);
    if (!eventId) return NextResponse.json({ error: "Invalid event id" }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const title =
      asString(body.event) || titleFromDesc(asString(body.desc));
    if (!title) return NextResponse.json({ error: "Event title is required" }, { status: 400 });

    const startAtMs = asNumber(body.startAtMs);
    const endAtMs = asNumber(body.endAtMs);
    const image = asString(body.event_image);

    const db = getFirestoreAdmin();
    const ref = db.collection("events").doc(eventId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const link = asString(body.link);
    const payload: Record<string, unknown> = {
      event: title,
      EventTitle: title,
      desc: asString(body.desc),
      event_image: image,
      eventImage: image ? [image] : [],
      city: asString(body.city),
      city_eng: asString(body.city_eng),
      venue: asString(body.venue),
      link,
      url: link,
      eventDateFrom: startAtMs !== null ? new Date(startAtMs) : null,
      eventDateTo: endAtMs !== null ? new Date(endAtMs) : null,
      updatedAt: new Date(),
    };
    if (startAtMs !== null) {
      payload.dateTime = new Date(startAtMs);
    }

    await ref.set(payload, { merge: true });
    return NextResponse.json({ ok: true, id: eventId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ eventId: string }> },
) {
  const deny = await requireAdminRequest(request);
  if (deny) return deny;
  try {
    const { eventId: raw } = await context.params;
    const eventId = asString(raw);
    if (!eventId) return NextResponse.json({ error: "Invalid event id" }, { status: 400 });
    const db = getFirestoreAdmin();
    await db.collection("events").doc(eventId).delete();
    return NextResponse.json({ ok: true, id: eventId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

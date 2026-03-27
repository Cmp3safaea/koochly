import { NextResponse } from "next/server";
import { getFirestoreAdmin } from "../../../lib/firebaseAdmin";

export const runtime = "nodejs";

export async function GET() {
  try {
    const db = getFirestoreAdmin();
    const snap = await db.collection("events").get();
    function titleFromDesc(desc: string): string {
      const lines = desc.split(/\r?\n/).map((l) => l.trim());
      const hit = lines.find((l) => l.length > 0);
      if (!hit) return "";
      return hit.length > 200 ? `${hit.slice(0, 197)}…` : hit;
    }

    const events = snap.docs.map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const desc =
        typeof data.desc === "string" && data.desc.trim() ? data.desc.trim() : "";
      const title =
        (typeof data.event === "string" && data.event.trim()) ||
        (typeof data.EventTitle === "string" && data.EventTitle.trim()) ||
        (typeof data.title === "string" && data.title.trim()) ||
        titleFromDesc(desc);
      const imageFromArray =
        Array.isArray(data.eventImage) &&
        typeof data.eventImage[0] === "string" &&
        data.eventImage[0].trim()
          ? data.eventImage[0].trim()
          : "";
      const imageFromScalar =
        (typeof data.event_image === "string" && data.event_image.trim()) ||
        (typeof data.eventImage === "string" && data.eventImage.trim()) ||
        "";
      return {
        id: doc.id,
        event: title,
        desc,
        event_image: imageFromArray || imageFromScalar,
      };
    });

    return NextResponse.json(
      { events },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load events" },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MEDIA_BASE = "https://places.googleapis.com/v1/";

function placesApiKey(): string {
  return (
    process.env.GOOGLE_PLACES_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    ""
  );
}

function clampWidth(raw: string | null): number {
  const n = raw ? Number(raw) : 800;
  if (!Number.isFinite(n)) return 800;
  return Math.min(1600, Math.max(100, Math.floor(n)));
}

/**
 * Proxy Google Places photo media so browser `<img>` never sees the API key.
 * Query: `name` = full photo resource name (e.g. `places/ChIJ…/photos/AZLasH…`).
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get("name")?.trim() || "";
  if (!name || !name.startsWith("places/") || name.includes("..")) {
    return NextResponse.json({ error: "نام تصویر نامعتبر است" }, { status: 400 });
  }

  const key = placesApiKey();
  if (!key) {
    return NextResponse.json({ error: "سرور پیکربندی نشده است" }, { status: 500 });
  }

  const maxWidthPx = clampWidth(searchParams.get("maxWidthPx"));
  const url = `${MEDIA_BASE}${name}/media?maxWidthPx=${maxWidthPx}`;

  const upstream = await fetch(url, {
    headers: { "X-Goog-Api-Key": key },
    next: { revalidate: 86_400 },
  });

  if (!upstream.ok) {
    const errText = await upstream.text();
    return NextResponse.json(
      { error: "بارگذاری تصویر ناموفق بود", detail: errText.slice(0, 200) },
      { status: upstream.status === 404 ? 404 : 502 },
    );
  }

  const contentType = upstream.headers.get("Content-Type") || "image/jpeg";
  const body = upstream.body;
  if (!body) {
    return NextResponse.json({ error: "پاسخ خالی بود" }, { status: 502 });
  }

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}

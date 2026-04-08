import { NextResponse } from "next/server";
import { listPublicEvents } from "../../../lib/citiesWithApprovedAds";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { events } = await listPublicEvents();

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

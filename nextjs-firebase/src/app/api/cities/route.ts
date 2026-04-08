import { type NextRequest, NextResponse } from "next/server";
import { listPublicCities } from "../../../lib/citiesWithApprovedAds";

export async function GET(req: NextRequest) {
  try {
    const onlyWithAds =
      req.nextUrl.searchParams.get("onlyWithAds") === "1" ||
      req.nextUrl.searchParams.get("onlyWithAds") === "true";
    const { cities } = await listPublicCities({ onlyWithAds });

    return NextResponse.json(
      { cities },
      {
        headers: {
          "Cache-Control": onlyWithAds
            ? "public, s-maxage=180, stale-while-revalidate=360"
            : "public, s-maxage=300, stale-while-revalidate=600",
        },
      },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

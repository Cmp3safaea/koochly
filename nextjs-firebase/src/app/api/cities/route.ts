import { type NextRequest, NextResponse } from "next/server";
import {
  cityDocHasApprovedAds,
  getApprovedAdCityKeysCached,
} from "../../../lib/citiesWithApprovedAds";
import { getFirestoreAdmin } from "../../../lib/firebaseAdmin";

export async function GET(req: NextRequest) {
  try {
    const onlyWithAds =
      req.nextUrl.searchParams.get("onlyWithAds") === "1" ||
      req.nextUrl.searchParams.get("onlyWithAds") === "true";
    const cityLimit = onlyWithAds ? 500 : 100;

    const db = getFirestoreAdmin();
    // Ordered fetch; filter `active !== false` in-memory so city docs without `active`
    // (legacy) still appear — same rule as `isCityActiveForPublicPages`.
    let snap;
    try {
      snap = await db
        .collection("cities")
        .orderBy("order")
        .limit(cityLimit)
        .get();
    } catch {
      snap = await db.collection("cities").limit(cityLimit).get();
    }

    const cities = snap.docs.map((d): Record<string, unknown> & { id: string } => {
      const data = d.data() as Record<string, unknown>;

      // In your export, `results` is a string containing JSON.
      // Convert it to an actual array/object for easier frontend usage.
      if (typeof data.results === "string") {
        try {
          data.results = JSON.parse(data.results);
        } catch {
          // Keep original string if parsing fails.
        }
      }

      const normalizedCurrencySymbol =
        typeof data.currency_symbol === "string" && data.currency_symbol.trim()
          ? data.currency_symbol.trim()
          : typeof data.currencySymbol === "string" && data.currencySymbol.trim()
            ? data.currencySymbol.trim()
            : typeof data.currency === "string" && data.currency.trim()
              ? data.currency.trim()
              : "";

      return { id: d.id, ...data, currency_symbol: normalizedCurrencySymbol };
    });

    // Sort by `order` (if present). Use dynamic access to avoid TS schema mismatches.
    cities.sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
      const aoRaw = (a.order as unknown) ?? null;
      const boRaw = (b.order as unknown) ?? null;

      const ao =
        aoRaw === null ? Infinity : (() => {
          const n = Number(aoRaw);
          return Number.isFinite(n) ? n : Infinity;
        })();
      const bo =
        boRaw === null ? Infinity : (() => {
          const n = Number(boRaw);
          return Number.isFinite(n) ? n : Infinity;
        })();

      return ao - bo;
    });

    let out = cities.filter((c) => c.active !== false);
    if (onlyWithAds) {
      const adKeys = await getApprovedAdCityKeysCached();
      out = out.filter((c) => cityDocHasApprovedAds(c as Record<string, unknown>, adKeys));
    }

    return NextResponse.json(
      { cities: out },
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


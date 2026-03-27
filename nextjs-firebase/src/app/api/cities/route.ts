import { NextResponse } from "next/server";
import { getFirestoreAdmin } from "../../../lib/firebaseAdmin";

export async function GET() {
  try {
    const db = getFirestoreAdmin();
    // Fast path: only active cities, ordered by `order`.
    // Falls back for legacy schemas without `active`/`order`.
    let snap;
    try {
      snap = await db
        .collection("cities")
        .where("active", "==", true)
        .orderBy("order")
        .limit(100)
        .get();
    } catch {
      try {
        snap = await db.collection("cities").orderBy("order").limit(100).get();
      } catch {
        snap = await db.collection("cities").limit(100).get();
      }
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

      return { id: d.id, ...data };
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

    return NextResponse.json(
      { cities: cities.filter((c) => c.active === true) },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
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


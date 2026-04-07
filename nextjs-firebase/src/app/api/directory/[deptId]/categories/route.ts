import { NextResponse } from "next/server";
import { resolveDirectoryCategoriesForAdmin } from "../../../../../lib/directoryCategoriesAdmin";
import { getFirestoreAdmin } from "../../../../../lib/firebaseAdmin";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ deptId: string }> },
) {
  try {
    const { searchParams } = new URL(request.url);
    const locale = searchParams.get("locale") === "en" ? "en" : "fa";
    const { deptId: raw } = await context.params;
    const deptId = typeof raw === "string" ? decodeURIComponent(raw.trim()) : "";
    if (!deptId) {
      return NextResponse.json({ error: "شناسه بخش نامعتبر است" }, { status: 400 });
    }

    const db = getFirestoreAdmin();
    const snap = await db.collection("dir").doc(deptId).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "بخش پیدا نشد" }, { status: 404 });
    }

    const data = snap.data() as Record<string, unknown>;
    const base = await resolveDirectoryCategoriesForAdmin(db, deptId, data, locale);
    const sub = await db.collection("dir").doc(deptId).collection("categories").limit(500).get();

    if (!sub.empty) {
      const byId = new Map(
        sub.docs.map((d) => [d.id, d.data() as Record<string, unknown>] as const),
      );
      const categories = base.map((c) => {
        const row = byId.get(c.code);
        const rawTags = row?.subcategories;
        const subcategories =
          Array.isArray(rawTags)
            ? rawTags
                .map((v) => (typeof v === "string" ? v.trim() : ""))
                .filter((v) => v.length > 0)
            : [];
        return { ...c, subcategories };
      });
      return NextResponse.json(
        { categories },
        {
          headers: {
            "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1200",
          },
        },
      );
    }

    return NextResponse.json(
      {
        categories: base.map((c) => ({ ...c, subcategories: [] as string[] })),
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1200",
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

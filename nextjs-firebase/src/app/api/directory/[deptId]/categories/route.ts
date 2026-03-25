import { NextResponse } from "next/server";
import { resolveDirectoryCategoriesForAdmin } from "../../../../../lib/directoryCategoriesAdmin";
import { getFirestoreAdmin } from "../../../../../lib/firebaseAdmin";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ deptId: string }> },
) {
  try {
    const { deptId: raw } = await context.params;
    const deptId = typeof raw === "string" ? decodeURIComponent(raw.trim()) : "";
    if (!deptId) {
      return NextResponse.json({ error: "شناسه بخش نامعتبر است" }, { status: 400 });
    }

    const db = getFirestoreAdmin();
    const snap = await db.collection("directory").doc(deptId).get();
    if (!snap.exists) {
      return NextResponse.json({ error: "بخش پیدا نشد" }, { status: 404 });
    }

    const data = snap.data() as Record<string, unknown>;
    const categories = await resolveDirectoryCategoriesForAdmin(db, deptId, data);
    return NextResponse.json({ categories });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

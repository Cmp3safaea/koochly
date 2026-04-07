import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";
import { getFirestoreAdmin } from "../../../../../lib/firebaseAdmin";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (typeof id !== "string" || !id.trim() || id.length > 512) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }

  try {
    const db = getFirestoreAdmin();
    await db.collection("ad").doc(id.trim()).update({
      visits: FieldValue.increment(1),
    });
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const code =
      e && typeof e === "object" && "code" in e
        ? (e as { code?: number }).code
        : undefined;
    if (code === 5) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getFirestoreAdmin } from "../../../../../../lib/firebaseAdmin";

export const runtime = "nodejs";

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function PATCH(
  _request: Request,
  context: { params: Promise<{ adId: string }> },
) {
  try {
    const { adId: raw } = await context.params;
    const adId = asString(raw);
    if (!adId) return NextResponse.json({ error: "Invalid ad id" }, { status: 400 });
    const db = getFirestoreAdmin();
    const ref = db.collection("ads").doc(adId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Ad not found" }, { status: 404 });
    await ref.set(
      {
        approved: true,
        approvedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return NextResponse.json({ ok: true, id: adId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

import { NextResponse } from "next/server";
import { getFirestoreAdmin } from "../../../lib/firebaseAdmin";

export async function GET() {
  try {
    const db = getFirestoreAdmin();

    // Lists top-level collections in the default database.
    // Note: Firestore Admin SDK supports `listCollections`.
    const refs = await db.listCollections();

    const collections = refs.map((r) => r.id);
    collections.sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ collections });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}


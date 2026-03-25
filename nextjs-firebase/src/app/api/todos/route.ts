import { NextResponse } from "next/server";
import { getFirestoreAdmin } from "../../../lib/firebaseAdmin";

export async function GET() {
  try {
    const db = getFirestoreAdmin();
    const snap = await db
      .collection("todos")
      .orderBy("createdAt", "desc")
      .limit(20)
      .get();

    const todos = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as { text?: string; createdAt?: string }),
    }));

    return NextResponse.json({ todos });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const { text } = (await req.json()) as { text?: string };
    if (!text || !text.trim()) {
      return NextResponse.json({ error: "Missing `text`" }, { status: 400 });
    }

    const db = getFirestoreAdmin();
    const doc = await db.collection("todos").add({
      text: text.trim(),
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ ok: true, id: doc.id }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}


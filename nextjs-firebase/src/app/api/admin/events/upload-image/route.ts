import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getFirebaseStorageBucket } from "../../../../../lib/firebaseAdmin";

export const runtime = "nodejs";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 1 * 1024 * 1024;

function safeBase(name: string): string {
  const base = name.trim().replace(/\.[^.]+$/, "");
  const cleaned = base.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "event-image";
}

function extFromMime(mime: string): string {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  return ".bin";
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file" }, { status: 400 });
    }
    if (!ALLOWED_MIME.has(file.type)) {
      return NextResponse.json({ error: "Unsupported image type" }, { status: 400 });
    }
    if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: "Image must be between 1B and 1MB" }, { status: 413 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const bucket = getFirebaseStorageBucket();
    const token = randomUUID();
    const ext = extFromMime(file.type);
    const base = safeBase(file.name);
    const objectPath = `events/images/${Date.now()}_${randomUUID().slice(0, 8)}_${base}${ext}`;
    const gcsFile = bucket.file(objectPath);
    await gcsFile.save(buffer, {
      resumable: false,
      metadata: {
        contentType: file.type,
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });
    const encodedPath = encodeURIComponent(objectPath);
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;
    return NextResponse.json({ ok: true, url });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

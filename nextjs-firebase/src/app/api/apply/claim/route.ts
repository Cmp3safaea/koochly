import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import {
  getFirebaseAuthAdmin,
  getFirebaseStorageBucket,
  getFirestoreAdmin,
} from "../../../../lib/firebaseAdmin";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024; // 5 MiB decoded
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

function safeFileBase(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "upload";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return cleaned || "upload";
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "بدنه درخواست نامعتبر است" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;
  const idToken = typeof b.idToken === "string" ? b.idToken.trim() : "";
  const adId = typeof b.adId === "string" ? b.adId.trim() : "";
  const comment = typeof b.comment === "string" ? b.comment.trim().slice(0, 2000) : "";
  let docsBase64 = typeof b.docsBase64 === "string" ? b.docsBase64.trim() : "";
  const docsMimeType =
    typeof b.docsMimeType === "string" ? b.docsMimeType.trim().toLowerCase() : "";
  const docsFileName = typeof b.docsFileName === "string" ? b.docsFileName : "document";

  if (!idToken || !adId || !docsBase64) {
    return NextResponse.json(
      { error: "شناسه آگهی، احراز هویت و فایل الزامی است" },
      { status: 400 },
    );
  }

  docsBase64 = docsBase64.replace(/^data:[^;]+;base64,/i, "");

  let buffer: Buffer;
  try {
    buffer = Buffer.from(docsBase64, "base64");
  } catch {
    return NextResponse.json({ error: "فایل به‌صورت base64 نامعتبر است" }, { status: 400 });
  }

  if (buffer.length > MAX_BYTES) {
    return NextResponse.json(
      { error: "حجم فایل زیاد است (حداکثر ۵ مگابایت)" },
      { status: 413 },
    );
  }
  if (buffer.length < 32) {
    return NextResponse.json({ error: "فایل خیلی کوچک است" }, { status: 400 });
  }

  if (!ALLOWED_MIME.has(docsMimeType)) {
    return NextResponse.json(
      { error: "فقط تصویر (JPEG، PNG، WebP) یا PDF مجاز است" },
      { status: 400 },
    );
  }

  const auth = getFirebaseAuthAdmin();
  let uid: string;
  try {
    const decoded = await auth.verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: "نشست نامعتبر است؛ دوباره وارد شوید" }, { status: 401 });
  }

  const db = getFirestoreAdmin();
  const adSnap = await db.collection("ad").doc(adId).get();
  if (!adSnap.exists) {
    return NextResponse.json({ error: "آگهی پیدا نشد" }, { status: 404 });
  }

  const bucket = getFirebaseStorageBucket();
  const ext =
    docsMimeType === "image/jpeg"
      ? ".jpg"
      : docsMimeType === "image/png"
        ? ".png"
        : docsMimeType === "image/webp"
          ? ".webp"
          : ".pdf";
  const base = safeFileBase(docsFileName).replace(/\.[^.]+$/, "");
  const objectPath = `users/${uid}/uploads/${Date.now()}_${randomUUID().slice(0, 8)}_${base}${ext}`;
  const token = randomUUID();
  const file = bucket.file(objectPath);

  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: docsMimeType,
      metadata: {
        firebaseStorageDownloadTokens: token,
      },
    },
  });

  const encodedPath = encodeURIComponent(objectPath);
  const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`;

  const applyRef = db.collection("apply").doc();
  const adRef = db.collection("ad").doc(adId);
  const userRef = db.collection("users").doc(uid);

  await applyRef.set({
    appliedAdsID: adRef,
    approved: false,
    comment: comment || "",
    dateTime: FieldValue.serverTimestamp(),
    docs: downloadUrl,
    userid: userRef,
  });

  return NextResponse.json({ ok: true, id: applyRef.id });
}

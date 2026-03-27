import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAuthAdmin, getFirebaseStorageBucket, getFirestoreAdmin } from "../../../../lib/firebaseAdmin";
import { resolveDirectoryCategoriesForAdmin } from "../../../../lib/directoryCategoriesAdmin";
import { getSiteBaseUrl } from "../../../../lib/siteUrl";

export const runtime = "nodejs";

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 100 * 1024;
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function safeFileBase(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "image";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return cleaned || "image";
}

function normalizeExternalUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

function stripDataUrlBase64(s: string): string {
  return s.replace(/^data:[^;]+;base64,/i, "").trim();
}

type ImageUploadSpec = { base64Raw: string; mime: string; fileName: string };

function parseImageUploadSpecs(b: Record<string, unknown>): { error?: string; specs: ImageUploadSpec[] } {
  if ("images" in b && Array.isArray(b.images)) {
    const rawArr = b.images;
    if (rawArr.length > MAX_IMAGES) {
      return { error: "حداکثر ۴ تصویر مجاز است", specs: [] };
    }
    const specs: ImageUploadSpec[] = [];
    for (let i = 0; i < rawArr.length; i++) {
      const row = rawArr[i];
      if (typeof row !== "object" || row === null) continue;
      const r = row as Record<string, unknown>;
      let b64 = typeof r.imageBase64 === "string" ? r.imageBase64.trim() : "";
      if (!b64) continue;
      b64 = stripDataUrlBase64(b64);
      const mime = typeof r.imageMimeType === "string" ? r.imageMimeType.trim().toLowerCase() : "";
      const fileName =
        typeof r.imageFileName === "string" && r.imageFileName.trim()
          ? r.imageFileName.trim()
          : `photo_${i + 1}.jpg`;
      specs.push({ base64Raw: b64, mime, fileName });
    }
    return { specs };
  }

  let imageBase64 = typeof b.imageBase64 === "string" ? b.imageBase64.trim() : "";
  if (!imageBase64) return { specs: [] };
  imageBase64 = stripDataUrlBase64(imageBase64);
  const imageMime =
    typeof b.imageMimeType === "string" ? b.imageMimeType.trim().toLowerCase() : "";
  const imageFileName =
    typeof b.imageFileName === "string" ? b.imageFileName : "photo.jpg";
  return {
    specs: [{ base64Raw: imageBase64, mime: imageMime, fileName: imageFileName }],
  };
}

async function nextAdSeq(): Promise<number> {
  const db = getFirestoreAdmin();
  try {
    const snap = await db.collection("ads").orderBy("seq", "desc").limit(1).get();
    if (snap.empty) return 10000;
    const s = snap.docs[0].data().seq;
    return typeof s === "number" && Number.isFinite(s) ? Math.floor(s) + 1 : 10000;
  } catch {
    return Math.floor(Date.now() / 1000);
  }
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
  const cityId = typeof b.cityId === "string" ? b.cityId.trim() : "";
  const departmentId = typeof b.departmentId === "string" ? b.departmentId.trim() : "";
  const catCode = typeof b.catCode === "string" ? b.catCode.trim() : "";
  const title = typeof b.title === "string" ? b.title.trim() : "";
  const engName = typeof b.engName === "string" ? b.engName.trim() : "";
  const details = typeof b.details === "string" ? b.details.trim() : "";
  const address = typeof b.address === "string" ? b.address.trim() : "";
  const phone = typeof b.phone === "string" ? b.phone.trim() : "";
  const websiteRaw = typeof b.website === "string" ? b.website.trim() : "";
  const instagram = typeof b.instagram === "string" ? b.instagram.trim() : "";
  const selectedTagsRaw = Array.isArray(b.selectedTags) ? b.selectedTags : [];
  const selectedTags = selectedTagsRaw
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v, i, arr) => v.length > 0 && arr.indexOf(v) === i)
    .slice(0, 2);
  const lat =
    typeof b.lat === "number" && Number.isFinite(b.lat) ? b.lat : null;
  const lon =
    typeof b.lon === "number" && Number.isFinite(b.lon) ? b.lon : null;

  if (!idToken || !cityId || !departmentId || !catCode || title.length < 2) {
    return NextResponse.json(
      { error: "عنوان، شهر، بخش، دسته و ورود به سیستم الزامی است" },
      { status: 400 },
    );
  }

  const auth = getFirebaseAuthAdmin();
  let uid: string;
  try {
    const decoded = await auth.verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: "نشست نامعتبر است" }, { status: 401 });
  }

  const db = getFirestoreAdmin();

  const citySnap = await db.collection("cities").doc(cityId).get();
  if (!citySnap.exists) {
    return NextResponse.json({ error: "شهر پیدا نشد" }, { status: 404 });
  }
  const cityData = citySnap.data() as Record<string, unknown>;
  const cityFa =
    typeof cityData.city_fa === "string" && cityData.city_fa.trim()
      ? cityData.city_fa.trim()
      : "";
  const cityEng =
    typeof cityData.city_eng === "string" && cityData.city_eng.trim()
      ? cityData.city_eng.trim()
      : "";

  const dirSnap = await db.collection("directory").doc(departmentId).get();
  if (!dirSnap.exists) {
    return NextResponse.json({ error: "بخش پیدا نشد" }, { status: 404 });
  }
  const dirData = dirSnap.data() as Record<string, unknown>;
  const deptLabel =
    (typeof dirData.department === "string" && dirData.department.trim()) ||
    (typeof dirData.engName === "string" && dirData.engName.trim()) ||
    departmentId;

  const cats = await resolveDirectoryCategoriesForAdmin(db, departmentId, dirData);
  const catRow = cats.find((c) => c.code === catCode);
  if (!catRow) {
    return NextResponse.json(
      { error: "دسته انتخاب‌شده با این بخش سازگار نیست" },
      { status: 400 },
    );
  }

  const catDoc = await db
    .collection("directory")
    .doc(departmentId)
    .collection("categories")
    .doc(catCode)
    .get();
  const allowedTagsRaw = catDoc.exists
    ? (((catDoc.data() as Record<string, unknown>).subcategories as unknown[]) ?? [])
    : [];
  const allowedTags = Array.isArray(allowedTagsRaw)
    ? allowedTagsRaw
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .filter((v) => v.length > 0)
    : [];
  const allowedSet = new Set(allowedTags.map((t) => t.toLowerCase()));
  const selectedCategoryTags =
    allowedSet.size === 0
      ? []
      : selectedTags.filter((t) => allowedSet.has(t.toLowerCase()));

  const parsedImages = parseImageUploadSpecs(b);
  if (parsedImages.error) {
    return NextResponse.json({ error: parsedImages.error }, { status: 400 });
  }
  const imageSpecs = parsedImages.specs;

  const images: string[] = [];
  const bucket = getFirebaseStorageBucket();

  for (let i = 0; i < imageSpecs.length; i++) {
    const { base64Raw, mime: imageMime, fileName: imageFileName } = imageSpecs[i];
    if (!IMAGE_MIME.has(imageMime)) {
      return NextResponse.json(
        { error: "تصویر باید JPEG، PNG یا WebP باشد" },
        { status: 400 },
      );
    }
    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64Raw, "base64");
    } catch {
      return NextResponse.json({ error: "تصویر نامعتبر است" }, { status: 400 });
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "هر تصویر حداکثر ۱۰۰ کیلوبایت باشد" },
        { status: 413 },
      );
    }
    if (buffer.length < 32) {
      return NextResponse.json({ error: "تصویر خیلی کوچک است" }, { status: 400 });
    }

    const ext =
      imageMime === "image/jpeg" ? ".jpg" : imageMime === "image/png" ? ".png" : ".webp";
    const base = safeFileBase(imageFileName).replace(/\.[^.]+$/, "");
    const objectPath = `users/${uid}/uploads/${Date.now()}_${i}_${randomUUID().slice(0, 8)}_${base}${ext}`;
    const token = randomUUID();
    const file = bucket.file(objectPath);
    await file.save(buffer, {
      resumable: false,
      metadata: {
        contentType: imageMime,
        metadata: { firebaseStorageDownloadTokens: token },
      },
    });
    const encodedPath = encodeURIComponent(objectPath);
    images.push(
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`,
    );
  }

  const seq = await nextAdSeq();
  const baseUrl = getSiteBaseUrl();
  const url = `${baseUrl}/b/${seq}`;

  const adsRef = db.collection("ads").doc();
  const dirRef = db.collection("directory").doc(departmentId);
  const userRef = db.collection("users").doc(uid);

  const location =
    lat !== null && lon !== null
      ? { lat, lon }
      : null;

  await adsRef.set({
    GoogleRate: null,
    address: address || "",
    approved: false,
    cat: catRow.label,
    cat_code: catCode,
    city: cityFa || cityEng || "",
    city_eng: cityEng || cityFa || "",
    dateTime: FieldValue.serverTimestamp(),
    departmentID: dirRef,
    dept: deptLabel,
    details: details || "",
    engName: engName || "",
    images,
    instorgam: instagram || "N/A",
    location,
    phone: phone || "",
    seq,
    subcat: selectedCategoryTags,
    selectedCategoryTags,
    title,
    url,
    user: userRef,
    visits: 0,
    website: websiteRaw ? normalizeExternalUrl(websiteRaw) : "",
  });

  return NextResponse.json({ ok: true, id: adsRef.id, seq, url });
}

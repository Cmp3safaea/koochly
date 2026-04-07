import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { FieldValue, type DocumentReference, type Firestore } from "firebase-admin/firestore";
import { getFirebaseAuthAdmin, getFirebaseStorageBucket, getFirestoreAdmin } from "../../../../../lib/firebaseAdmin";
import { resolveDirectoryCategoriesForAdmin } from "../../../../../lib/directoryCategoriesAdmin";
import { getSiteBaseUrl } from "../../../../../lib/siteUrl";

export const runtime = "nodejs";

const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 100 * 1024;
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeExternalUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

function parsePriceFromBody(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string") {
    const t = value.trim().replace(/[,\s\u066C]/g, "");
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  return null;
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
  return { specs: [] };
}

function safeFileBase(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "image";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  return cleaned || "image";
}

function isUsersDocRef(uid: string, ref: unknown): boolean {
  if (!ref || typeof ref !== "object") return false;
  const r = ref as DocumentReference;
  return typeof r.path === "string" && r.path === `users/${uid}`;
}

function departmentIdFromAd(data: Record<string, unknown>): string | null {
  const d = data.departmentID;
  if (d && typeof d === "object" && d !== null && "id" in d) {
    const id = (d as { id: unknown }).id;
    return typeof id === "string" && id.trim() ? id.trim() : null;
  }
  return null;
}

async function uidFromRequest(request: Request): Promise<string | null> {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!token) return null;
  try {
    const decoded = await getFirebaseAuthAdmin().verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

async function resolveCityId(db: Firestore, data: Record<string, unknown>): Promise<string | null> {
  const fa = asString(data.city_fa);
  const en = asString(data.city_eng);
  if (en) {
    const s = await db.collection("cities").where("city_eng", "==", en).limit(1).get();
    if (!s.empty) return s.docs[0].id;
  }
  if (fa) {
    const s = await db.collection("cities").where("city_fa", "==", fa).limit(1).get();
    if (!s.empty) return s.docs[0].id;
  }
  const legacy = asString(data.city);
  if (legacy) {
    const byFa = await db.collection("cities").where("city_fa", "==", legacy).limit(1).get();
    if (!byFa.empty) return byFa.docs[0].id;
    const byEng = await db.collection("cities").where("city_eng", "==", legacy).limit(1).get();
    if (!byEng.empty) return byEng.docs[0].id;
  }
  return null;
}

function normalizeSubcats(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v, i, arr) => v.length > 0 && arr.indexOf(v) === i)
    .slice(0, 8);
}

async function loadOwnedAd(db: Firestore, uid: string, adId: string) {
  const ref = db.collection("ad").doc(adId);
  const snap = await ref.get();
  if (!snap.exists) return { error: "آگهی پیدا نشد" as const, status: 404 as const };
  const data = snap.data() as Record<string, unknown>;
  if (!isUsersDocRef(uid, data.user)) {
    return { error: "دسترسی ندارید" as const, status: 403 as const };
  }
  return { ref, data };
}

type RouteCtx = { params: Promise<{ adId: string }> };

export async function GET(request: Request, context: RouteCtx) {
  try {
    const uid = await uidFromRequest(request);
    if (!uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { adId: rawId } = await context.params;
    const adId = typeof rawId === "string" ? rawId.trim() : "";
    if (!adId) {
      return NextResponse.json({ error: "شناسه نامعتبر" }, { status: 400 });
    }

    const db = getFirestoreAdmin();
    const loaded = await loadOwnedAd(db, uid, adId);
    if ("error" in loaded && loaded.status) {
      return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    }
    const { data } = loaded;

    const departmentId = departmentIdFromAd(data);
    const catCode = asString(data.cat_code);
    const loc = data.location as Record<string, unknown> | null | undefined;
    let lat: number | null = null;
    let lon: number | null = null;
    if (loc && typeof loc === "object") {
      const la = loc.lat;
      const lo = loc.lon ?? loc.lng;
      if (typeof la === "number" && Number.isFinite(la)) lat = la;
      if (typeof lo === "number" && Number.isFinite(lo)) lon = lo;
    }

    const mainRaw = asString(data.mainCategory).toLowerCase();
    const mainCategory: "goods" | "services" = mainRaw === "services" ? "services" : "goods";
    const inst = asString(data.instagram);
    const instLegacy = asString(data.instorgam);
    const instagram =
      inst && inst !== "N/A"
        ? inst
        : instLegacy && instLegacy !== "N/A"
          ? instLegacy
          : "";

    const imgs = Array.isArray(data.images)
      ? data.images.filter((u): u is string => typeof u === "string" && u.trim().length > 0)
      : [];

    const tags =
      normalizeSubcats(data.selectedCategoryTags).length > 0
        ? normalizeSubcats(data.selectedCategoryTags)
        : normalizeSubcats(data.subcat);

    const cityId = await resolveCityId(db, data);

    const price = data.price;
    const isFree = data.isFree === true;
    const isNewItem = data.isNewItem === true;
    const exchangeable = data.exchangeable === true;
    const negotiable = data.negotiable === true;

    return NextResponse.json({
      adId,
      cityId: cityId ?? "",
      departmentId: departmentId ?? "",
      catCode,
      title: asString(data.title),
      engName: asString(data.engName),
      details: asString(data.details),
      address: asString(data.address),
      phone: asString(data.phone),
      website: asString(data.website),
      instagram,
      lat,
      lon,
      selectedTags: tags.slice(0, 2),
      mainCategory,
      services: asString(data.services),
      price: typeof price === "number" && Number.isFinite(price) ? price : null,
      isFree,
      isNewItem,
      exchangeable,
      negotiable,
      images: imgs.slice(0, MAX_IMAGES),
      approved: data.approved === true,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, context: RouteCtx) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "بدنه درخواست نامعتبر است" }, { status: 400 });
  }

  const uid = await uidFromRequest(request);
  if (!uid) {
    return NextResponse.json({ error: "نشست نامعتبر است" }, { status: 401 });
  }

  const { adId: rawId } = await context.params;
  const adId = typeof rawId === "string" ? rawId.trim() : "";
  if (!adId) {
    return NextResponse.json({ error: "شناسه نامعتبر" }, { status: 400 });
  }

  const db = getFirestoreAdmin();
  const loaded = await loadOwnedAd(db, uid, adId);
  if ("error" in loaded && loaded.status) {
    return NextResponse.json({ error: loaded.error }, { status: loaded.status });
  }
  const { ref: adRef, data: prev } = loaded;

  const prevImages = Array.isArray(prev.images)
    ? prev.images.filter((u): u is string => typeof u === "string" && u.trim().length > 0)
    : [];
  const prevSet = new Set(prevImages);

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

  const mainCategoryRaw =
    typeof b.mainCategory === "string" ? b.mainCategory.trim().toLowerCase() : "";
  if (mainCategoryRaw !== "goods" && mainCategoryRaw !== "services") {
    return NextResponse.json(
      { error: "نوع آگهی باید کالا یا خدمات باشد" },
      { status: 400 },
    );
  }
  const mainCategory = mainCategoryRaw as "goods" | "services";
  const services = typeof b.services === "string" ? b.services.trim() : "";

  let isFree = b.isFree === true;
  let isNewItem = b.isNewItem === true;
  let exchangeable = b.exchangeable === true;
  let negotiable = b.negotiable === true;

  let price: number | null;
  if (mainCategory === "services") {
    isFree = false;
    isNewItem = false;
    exchangeable = false;
    negotiable = false;
    price = null;
  } else if (isFree) {
    price = null;
  } else {
    price = parsePriceFromBody(b.price);
  }

  const existingRaw = Array.isArray(b.existingImageUrls) ? b.existingImageUrls : [];
  const keptExisting = existingRaw
    .map((u) => (typeof u === "string" ? u.trim() : ""))
    .filter((u) => u.length > 0 && prevSet.has(u))
    .slice(0, MAX_IMAGES);

  if (!idToken || !cityId || !departmentId || !catCode || title.length < 2) {
    return NextResponse.json(
      { error: "عنوان، شهر، بخش، دسته و ورود به سیستم الزامی است" },
      { status: 400 },
    );
  }

  const auth = getFirebaseAuthAdmin();
  try {
    const decoded = await auth.verifyIdToken(idToken);
    if (decoded.uid !== uid) {
      return NextResponse.json({ error: "نشست نامعتبر است" }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ error: "نشست نامعتبر است" }, { status: 401 });
  }

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

  const dirSnap = await db.collection("dir").doc(departmentId).get();
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
    .collection("dir")
    .doc(departmentId)
    .collection("categories")
    .doc(catCode)
    .get();
  const catDocData = catDoc.exists
    ? (catDoc.data() as Record<string, unknown>)
    : null;
  const slugFromDoc =
    catDocData && typeof catDocData.slug === "string" ? catDocData.slug.trim() : "";
  const dirCategorySlug = slugFromDoc || catCode;
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
  const room = MAX_IMAGES - keptExisting.length;
  if (imageSpecs.length > room) {
    return NextResponse.json(
      { error: "حداکثر ۴ تصویر مجاز است" },
      { status: 400 },
    );
  }

  const newImages: string[] = [];
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
    newImages.push(
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodedPath}?alt=media&token=${token}`,
    );
  }

  const images = [...keptExisting, ...newImages];
  if (images.length < 1) {
    return NextResponse.json(
      { error: "حداقل یک تصویر لازم است" },
      { status: 400 },
    );
  }

  const dirRef = db.collection("dir").doc(departmentId);
  const location =
    lat !== null && lon !== null
      ? { lat, lon }
      : null;

  const seq = asNumber(prev.seq);
  const baseUrl = getSiteBaseUrl();
  const url =
    typeof prev.url === "string" && prev.url.trim()
      ? prev.url.trim()
      : seq !== null
        ? `${baseUrl}/b/${seq}`
        : "";

  await adRef.update({
    address: address || "",
    approved: false,
    cat: catRow.label,
    cat_code: catCode,
    dir_id: departmentId,
    dir_department_slug: departmentId,
    dir_category_slug: dirCategorySlug,
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
    mainCategory,
    services: services || "",
    price,
    isFree,
    isNewItem,
    exchangeable,
    negotiable,
    subcat: selectedCategoryTags,
    selectedCategoryTags,
    title,
    website: websiteRaw ? normalizeExternalUrl(websiteRaw) : "",
    ...(url ? { url } : {}),
  });

  return NextResponse.json({ ok: true, id: adId, seq, url, pendingApproval: true });
}

export async function DELETE(request: Request, context: RouteCtx) {
  try {
    const uid = await uidFromRequest(request);
    if (!uid) {
      return NextResponse.json({ error: "نشست نامعتبر است" }, { status: 401 });
    }

    const { adId: rawId } = await context.params;
    const adId = typeof rawId === "string" ? rawId.trim() : "";
    if (!adId) {
      return NextResponse.json({ error: "شناسه نامعتبر" }, { status: 400 });
    }

    const db = getFirestoreAdmin();
    const loaded = await loadOwnedAd(db, uid, adId);
    if ("error" in loaded && loaded.status) {
      return NextResponse.json({ error: loaded.error }, { status: loaded.status });
    }

    await loaded.ref.delete();
    return NextResponse.json({ ok: true, id: adId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Unknown error" },
      { status: 500 },
    );
  }
}

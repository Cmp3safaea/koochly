// Backfill empty dir_id, dir_department_slug and dir_category_slug on ad (Firestore dir + directory).
/**
 * Backfill `dir_id` (dir collection doc id), `dir_department_slug` and `dir_category_slug` on `ad` when empty,
 * using Firestore `dir` (and legacy `directory` id to dir slug and category maps).
 * `cat_code` alone can resolve the department (exact key, unique dept prefix like beauty→beauty_personal_care, or `cat` label match).
 *
 * Usage:
 *   node ./scripts/backfill-ad-dir-slugs.mjs --dry-run
 *   node ./scripts/backfill-ad-dir-slugs.mjs
 *   node ./scripts/backfill-ad-dir-slugs.mjs --limit 500
 *   node ./scripts/backfill-ad-dir-slugs.mjs --collection ad --dir dir
 *   node ./scripts/backfill-ad-dir-slugs.mjs --only-category-slug   (only fill empty dir_category_slug; uses cat_code + dir/dept)
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  asString,
  norm,
  loadDirDepartmentsState,
  buildCatCodeToDeptSlug,
  matchDirCategoryInDept,
  resolveCategorySlug,
  resolveDeptSlugByCatPrefix,
  resolveDeptSlugFromAdLabels,
} from "./lib/adDirFirestoreTaxonomy.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadDotEnv() {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}

async function initFirestore() {
  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  if (getApps().length > 0) return getFirestore();

  const json = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
  if (json) {
    initializeApp({ credential: cert(JSON.parse(json)) });
    return getFirestore();
  }
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64?.trim();
  if (b64) {
    const decoded = Buffer.from(b64, "base64").toString("utf8");
    initializeApp({ credential: cert(JSON.parse(decoded)) });
    return getFirestore();
  }
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim();
  if (path && existsSync(path)) {
    const raw = readFileSync(path, "utf8");
    initializeApp({ credential: cert(JSON.parse(raw)) });
    return getFirestore();
  }
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  if (projectId) initializeApp({ projectId });
  else initializeApp();
  return getFirestore();
}

function departmentIdFromAd(data) {
  const direct = asString(data.departmentID);
  if (direct) {
    const parts = direct.split("/").filter(Boolean);
    return parts.length > 0 ? parts[parts.length - 1] : direct;
  }
  const maybeRef = data.departmentID;
  if (maybeRef && typeof maybeRef === "object") {
    const refId = asString(maybeRef.id);
    if (refId) return refId;
    const path = asString(maybeRef.path);
    if (path) {
      const parts = path.split("/").filter(Boolean);
      return parts.length > 0 ? parts[parts.length - 1] : null;
    }
    const ref = asString(maybeRef.__ref__);
    if (ref) {
      const parts = ref.split("/").filter(Boolean);
      return parts.length > 0 ? parts[parts.length - 1] : null;
    }
  }
  return null;
}

function categoryLabelFromDoc(data, fallbackId) {
  return (
    asString(data.category) ||
    asString(data.Category) ||
    asString(data.label) ||
    asString(data.name) ||
    asString(data.title) ||
    fallbackId
  );
}

async function readDirectoryDepartmentCategories(db, deptId, deptData) {
  const sub = await db.collection("directory").doc(deptId).collection("categories").limit(500).get();
  if (!sub.empty) {
    return sub.docs.map((d) => {
      const dt = d.data();
      return {
        code: d.id,
        label: categoryLabelFromDoc(dt, d.id),
        engName: asString(dt.engName),
      };
    });
  }
  const names = [
    "categories",
    "category",
    "subcategories",
    "subcategory",
    "Categories",
    "Category",
    "all_categories",
    "tags",
    "types",
  ];
  for (const name of names) {
    const s2 = await db.collection("directory").doc(deptId).collection(name).limit(400).get();
    if (s2.empty) continue;
    return s2.docs.map((d) => {
      const dt = d.data();
      return {
        code: d.id,
        label: categoryLabelFromDoc(dt, d.id),
        engName: asString(dt.engName),
      };
    });
  }
  return [];
}

function matchDirectoryDeptToDirSlug(depts, directoryId, engName, faName) {
  if (depts.has(directoryId)) return directoryId;

  const ne = norm(engName);
  const nf = norm(faName);
  for (const [slug, st] of depts) {
    if (ne && norm(st.department_en) === ne) return slug;
    if (nf && norm(st.department_fa) === nf) return slug;
  }
  if (ne) {
    for (const [slug, st] of depts) {
      if (norm(st.department_fa) === ne) return slug;
    }
  }
  if (nf) {
    for (const [slug, st] of depts) {
      if (norm(st.department_en) === nf) return slug;
    }
  }
  return null;
}

function parseArgs(argv) {
  let dryRun = false;
  let limit = null;
  let dirCollection = "dir";
  let adCollection = "ad";
  let onlyCategorySlug = false;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--limit") limit = Math.max(1, Number(argv[++i]) || 0);
    else if (a === "--dir") dirCollection = asString(argv[++i]) || "dir";
    else if (a === "--collection") adCollection = asString(argv[++i]) || "ad";
    else if (a === "--only-category-slug") onlyCategorySlug = true;
    else if (a === "--help" || a === "-h") {
      console.log(`backfill-ad-dir-slugs.mjs

  --dry-run
  --limit N
  --dir NAME       (default: dir)
  --collection NAME (default: ad)
  --only-category-slug   Only fill empty dir_category_slug; may also set dir_id / dir_department_slug if missing
`);
      process.exit(0);
    }
  }
  return { dryRun, limit, dirCollection, adCollection, onlyCategorySlug };
}

function resolveDeptSlug(data, depts, deptToDirSlug, preferStoredDirSlug, catCodeToDeptSlug) {
  if (preferStoredDirSlug) {
    const stored = asString(data.dir_id) || asString(data.dir_department_slug);
    if (stored && depts.has(stored)) return stored;
  }
  const key = departmentIdFromAd(data);
  if (key && depts.has(key)) return key;
  if (key && deptToDirSlug.has(key)) return deptToDirSlug.get(key);
  const fallback = asString(data.dir_id) || asString(data.dir_department_slug);
  if (fallback && depts.has(fallback)) return fallback;
  const catRaw =
    asString(data.cat_code) || asString(data.catCode) || asString(data.category_code);
  if (catRaw && catCodeToDeptSlug && catCodeToDeptSlug.has(catRaw)) {
    const s = catCodeToDeptSlug.get(catRaw);
    if (s && depts.has(s)) return s;
  }
  const byPrefix = resolveDeptSlugByCatPrefix(catRaw, depts);
  if (byPrefix) return byPrefix;
  const byLabels = resolveDeptSlugFromAdLabels(data, depts);
  if (byLabels) return byLabels;
  return null;
}

async function main() {
  loadDotEnv();
  const { dryRun, limit, dirCollection, adCollection, onlyCategorySlug } = parseArgs(process.argv);
  const db = await initFirestore();
  const { FieldPath } = await import("firebase-admin/firestore");

  const depts = await loadDirDepartmentsState(db, dirCollection);
  console.log(`Loaded ${depts.size} department(s) from "${dirCollection}".`);

  const catCodeToDeptSlug = buildCatCodeToDeptSlug(depts);
  console.log(`Built cat_code → dir id map: ${catCodeToDeptSlug.size} key(s).`);

  const deptToDirSlug = new Map();
  const catKeyToDirCat = new Map();

  const directorySnap = await db.collection("directory").limit(400).get();
  for (const dDoc of directorySnap.docs) {
    const dId = dDoc.id;
    const data = dDoc.data();
    const engName = asString(data.engName);
    const faName = asString(data.department);
    const slug = matchDirectoryDeptToDirSlug(depts, dId, engName, faName);
    if (slug) deptToDirSlug.set(dId, slug);
  }
  console.log(`Mapped ${deptToDirSlug.size} legacy directory dept id(s) to dir slug.`);

  for (const dDoc of directorySnap.docs) {
    const dId = dDoc.id;
    const slug = deptToDirSlug.get(dId);
    if (!slug) continue;
    const deptState = depts.get(slug);
    if (!deptState) continue;

    const cats = await readDirectoryDepartmentCategories(db, dId, dDoc.data());
    for (const c of cats) {
      const dirCat = matchDirCategoryInDept(deptState, c);
      if (dirCat?.slug) {
        catKeyToDirCat.set(`${dId}|${c.code}`, {
          slug: dirCat.slug,
          name_en: dirCat.name_en,
          name_fa: dirCat.name_fa,
        });
      }
    }
  }
  console.log(`Category key mappings (directory id|code): ${catKeyToDirCat.size}.`);

  const pageSize = limit ? Math.min(limit, 500) : 500;
  let lastAdDoc = null;
  let totalScanned = 0;

  let patched = 0;
  let skippedComplete = 0;
  let skippedNoDept = 0;
  let skippedNoCat = 0;
  const BATCH = 400;
  let batch = db.batch();
  let ops = 0;

  async function commitBatch() {
    if (ops === 0) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  }

  for (;;) {
    let q = db.collection(adCollection).orderBy(FieldPath.documentId()).limit(pageSize);
    if (lastAdDoc) q = q.startAfter(lastAdDoc);
    const adsSnap = await q.get();
    if (adsSnap.empty) break;

    for (const adDoc of adsSnap.docs) {
      totalScanned++;
      if (limit && totalScanned > limit) {
        lastAdDoc = null;
        break;
      }

      const data = adDoc.data();
      const hasDirId = !!asString(data.dir_id);
      const hasDeptSlugField = !!asString(data.dir_department_slug);
      const hasCatSlug = !!asString(data.dir_category_slug);

      if (onlyCategorySlug) {
        if (hasCatSlug) {
          skippedComplete++;
          continue;
        }
      } else if (hasDirId && hasDeptSlugField && hasCatSlug) {
        skippedComplete++;
        continue;
      }

      const deptSlug = resolveDeptSlug(
        data,
        depts,
        deptToDirSlug,
        onlyCategorySlug,
        catCodeToDeptSlug,
      );
      if (!deptSlug) {
        skippedNoDept++;
        continue;
      }

      const deptState = depts.get(deptSlug);
      const directoryDeptId = departmentIdFromAd(data);
      const legacyId =
        directoryDeptId && deptToDirSlug.has(directoryDeptId) ? directoryDeptId : null;

      const categorySlug = resolveCategorySlug(data, deptState, legacyId, catKeyToDirCat);

      const patch = {};
      if (deptSlug) {
        if (!hasDirId) patch.dir_id = deptSlug;
        if (!hasDeptSlugField) patch.dir_department_slug = deptSlug;
      }
      if (!hasCatSlug && categorySlug) patch.dir_category_slug = categorySlug;

      if (Object.keys(patch).length === 0) {
        if (!hasCatSlug && !categorySlug) skippedNoCat++;
        continue;
      }

      if (!dryRun) {
        batch.update(adDoc.ref, patch);
        ops++;
        patched++;
        if (ops >= BATCH) {
          await commitBatch();
          console.log(`Committed batch (through ${adDoc.id})`);
        }
      } else {
        patched++;
        if (patched <= 30) {
          console.log(`[dry-run] ${adDoc.id} -> ${JSON.stringify(patch)}`);
        }
      }
    }

    if (limit && totalScanned > limit) break;
    lastAdDoc = adsSnap.docs[adsSnap.docs.length - 1];
    if (adsSnap.size < pageSize) break;
  }

  console.log(`Scanned ${totalScanned} document(s) from "${adCollection}".`);

  if (!dryRun) await commitBatch();

  console.log(
    `${dryRun ? "[dry-run] " : ""}done. patched=${patched}, skippedComplete=${skippedComplete}, skippedNoDept=${skippedNoDept}, skippedNoCat=${skippedNoCat}`,
  );
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});

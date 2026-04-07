#!/usr/bin/env node
/**
 * Build `myads` from `ads`, aligned with Firestore `dir` taxonomy.
 *
 * Reads each `dir/{deptSlug}` document plus:
 *   - `dir/{deptSlug}/categories/{catSlug}` (optional)
 *   - `dir/{deptSlug}/categories/{catSlug}/subcategories/{subSlug}` (optional)
 * and merges with the embedded `categories[]` array on the department doc (import JSON shape).
 *
 * Uses `directory` (legacy) to map Firestore department ids + category doc ids → dir slugs when possible.
 * When a department / category / subcategory tag from an ad is not in `dir`, this script **creates**
 * the missing `dir` doc, `categories` subdoc, and `subcategories` subdocs, and keeps the parent
 * `categories` array updated so it stays in sync with subcollections.
 *
 * myads fields:
 *   - departmentID → ref `dir/{deptSlug}`
 *   - cat_code     → category slug
 *   - subcat       → array of **subcategory slugs** (aligned); labels in dir subdocs
 *   - dir_subcategory_slugs — same as subcat (explicit alias)
 *   - dir_aligned / dir_align_notes / dir_department_slug / dir_category_slug / myads_syncedAt
 *
 * Copies `ads/{id}/promotions/*` → `myads/{id}/promotions/*`.
 *
 * Usage:
 *   node ./scripts/sync-myads-from-ads.mjs --dry-run   (no writes)
 *   node ./scripts/sync-myads-from-ads.mjs
 *   node ./scripts/sync-myads-from-ads.mjs --no-extend-dir   (only map; do not write new dir docs)
 *   node ./scripts/sync-myads-from-ads.mjs --limit 200
 */

import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const DIR_ICON_BASE = "/department-icons";

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
  if (projectId) {
    initializeApp({ projectId });
  } else {
    initializeApp();
  }
  return getFirestore();
}

function asString(v) {
  return typeof v === "string" ? v.trim() : "";
}

function norm(s) {
  return asString(s)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\u200c\u200f]/g, "")
    .trim();
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

function normalizeSubcatsFromAd(data) {
  const out = [];
  const pushArr = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const x of arr) {
      if (typeof x === "string" && x.trim()) out.push(x.trim());
    }
  };
  pushArr(data.subcat);
  if (out.length === 0) pushArr(data.selectedCategoryTags);
  const seen = new Set();
  const dedup = [];
  for (const t of out) {
    const k = norm(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    dedup.push(t);
  }
  return dedup.slice(0, 16);
}

function slugifyAscii(s) {
  const t = asString(s)
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (t.length >= 2) return t.slice(0, 72);
  return "";
}

function slugFromLabel(label) {
  const a = slugifyAscii(label);
  if (a) return a;
  const h = createHash("sha1").update(label).digest("hex").slice(0, 12);
  return `t_${h}`;
}

/** @param {import('firebase-admin/firestore').Firestore} db */
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

/**
 * @typedef {{ slug: string, name_en: string, name_fa: string, tags_en?: string[], tags_fa?: string[] }} DirCatRow
 * @typedef {{ slug: string, name_en: string, name_fa: string }} DirSubRow
 * @typedef {{ department_en: string, department_fa: string, categories: Map<string, DirCatRow & { subcategories: Map<string, DirSubRow> }> }} DirDeptState
 */

/** Build merged view: embedded categories[] + categories subcollection + subcategories subcollection. */
async function loadDirDepartmentsState(db, dirCollection) {
  /** @type {Map<string, DirDeptState>} */
  const depts = new Map();
  const snap = await db.collection(dirCollection).get();

  for (const doc of snap.docs) {
    const slug = doc.id;
    const data = doc.data();
    const department_en = asString(data.department_en);
    const department_fa = asString(data.department_fa);
    /** @type {Map<string, DirCatRow & { subcategories: Map<string, DirSubRow> }>} */
    const categories = new Map();

    const raw = data.categories;
    if (Array.isArray(raw)) {
      for (const c of raw) {
        if (!c || typeof c !== "object") continue;
        const o = c;
        const cs = asString(o.slug);
        if (!cs) continue;
        categories.set(cs, {
          slug: cs,
          name_en: asString(o.name_en),
          name_fa: asString(o.name_fa),
          tags_en: Array.isArray(o.tags_en) ? o.tags_en.filter((x) => typeof x === "string") : [],
          tags_fa: Array.isArray(o.tags_fa) ? o.tags_fa.filter((x) => typeof x === "string") : [],
          subcategories: new Map(),
        });
      }
    }

    const catCol = db.collection(dirCollection).doc(slug).collection("categories");
    const catSnap = await catCol.limit(600).get();
    for (const cdoc of catSnap.docs) {
      const cd = cdoc.data();
      const cs = asString(cd.slug) || cdoc.id;
      if (!cs) continue;
      const existing = categories.get(cs) || {
        slug: cs,
        name_en: "",
        name_fa: "",
        tags_en: [],
        tags_fa: [],
        subcategories: new Map(),
      };
      existing.name_en = existing.name_en || asString(cd.name_en);
      existing.name_fa = existing.name_fa || asString(cd.name_fa);
      if (!existing.subcategories) existing.subcategories = new Map();

      const subCol = catCol.doc(cdoc.id).collection("subcategories");
      const subSnap = await subCol.limit(400).get();
      for (const sdoc of subSnap.docs) {
        const sd = sdoc.data();
        const ss = asString(sd.slug) || sdoc.id;
        if (!ss) continue;
        existing.subcategories.set(ss, {
          slug: ss,
          name_en: asString(sd.name_en) || ss,
          name_fa: asString(sd.name_fa) || asString(sd.name_en) || ss,
        });
      }
      categories.set(cs, existing);
    }

    depts.set(slug, { department_en, department_fa, categories });
  }
  return depts;
}

function categoryRowToMatchList(cat) {
  return [cat];
}

function matchDirCategoryInDept(deptState, dirRow) {
  const list = Array.from(deptState.categories.values());
  const code = dirRow.code;
  const label = norm(dirRow.label);
  const eng = norm(dirRow.engName);

  let found = list.find((c) => c.slug && c.slug === code);
  if (found) return found;

  if (eng) {
    found = list.find((c) => norm(c.name_en) === eng);
    if (found) return found;
  }
  if (label) {
    found = list.find((c) => norm(c.name_fa) === label);
    if (found) return found;
    found = list.find((c) => norm(c.name_en) === label);
    if (found) return found;
  }
  return null;
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

function ensureUniqueSlug(base, used) {
  let s = base;
  let n = 0;
  while (used.has(s)) {
    n++;
    s = `${base}_${n}`;
  }
  used.add(s);
  return s;
}

function dirCatToEmbeddedArrayEntry(cat) {
  const tagsFromSubs = Array.from(cat.subcategories?.values() ?? []).map((s) => s.name_en || s.slug);
  return {
    slug: cat.slug,
    name_en: cat.name_en || cat.slug,
    name_fa: cat.name_fa || cat.name_en || cat.slug,
    tags_en: cat.tags_en?.length ? cat.tags_en : tagsFromSubs,
    tags_fa: cat.tags_fa?.length ? cat.tags_fa : tagsFromSubs,
  };
}

function parseArgs(argv) {
  let dryRun = false;
  let limit = null;
  let skipPromotions = false;
  let extendDir = true;
  let dirCollection = "dir";
  let sourceAds = "ads";
  let destMyads = "myads";
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--limit") limit = Math.max(1, Number(argv[++i]) || 0);
    else if (a === "--skip-promotions") skipPromotions = true;
    else if (a === "--no-extend-dir") extendDir = false;
    else if (a === "--dir") dirCollection = argv[++i].trim();
    else if (a === "--from") sourceAds = argv[++i].trim();
    else if (a === "--to") destMyads = argv[++i].trim();
    else if (a === "--help" || a === "-h") {
      console.log(`sync-myads-from-ads.mjs — ads → myads + align / extend dir

  --dry-run           Preview counts only; does not write myads or dir
  --limit N
  --skip-promotions
  --no-extend-dir     Do not create missing dir / categories / subcategories
  --dir NAME          (default: dir)
  --from / --to       collections
`);
      process.exit(0);
    }
  }
  return { dryRun, limit, skipPromotions, extendDir, dirCollection, sourceAds, destMyads };
}

async function main() {
  loadDotEnv();
  const {
    dryRun,
    limit,
    skipPromotions,
    extendDir,
    dirCollection,
    sourceAds,
    destMyads,
  } = parseArgs(process.argv);

  const db = await initFirestore();
  const { FieldPath, FieldValue } = await import("firebase-admin/firestore");

  /** @type {Map<string, DirDeptState>} */
  const depts = await loadDirDepartmentsState(db, dirCollection);
  console.log(`Loaded ${depts.size} department(s) from "${dirCollection}" (merged embedded + subcollections).`);

  const directorySnap = await db.collection("directory").limit(400).get();
  /** directory Firestore id → dept slug in dir */
  const deptToDirSlug = new Map();
  /** `${directoryId}|${catCode}` → { slug, name_en, name_fa } */
  const catKeyToDirCat = new Map();

  const usedDeptSlugs = new Set(depts.keys());

  let stats = {
    alignedDept: 0,
    alignedCat: 0,
    alignedSub: 0,
    both: 0,
    createdDept: 0,
    createdCat: 0,
    createdSub: 0,
    promotionsCopied: 0,
  };

  async function flushDeptCategoriesArray(dbConn, col, deptSlug, deptState) {
    const arr = Array.from(deptState.categories.values()).map(dirCatToEmbeddedArrayEntry);
    await dbConn
      .collection(col)
      .doc(deptSlug)
      .set({ categories: arr, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }

  async function ensureSubcategory(deptSlug, deptState, catSlug, tagLabel) {
    const cat = deptState.categories.get(catSlug);
    if (!cat) return null;
    if (!cat.subcategories) cat.subcategories = new Map();

    const nt = norm(tagLabel);
    for (const sub of cat.subcategories.values()) {
      if (norm(sub.name_fa) === nt || norm(sub.name_en) === nt || sub.slug === tagLabel) return sub.slug;
    }
    for (const sub of cat.subcategories.values()) {
      if (sub.slug === slugifyAscii(tagLabel) && slugifyAscii(tagLabel)) return sub.slug;
    }

    if (!extendDir) return slugFromLabel(tagLabel);

    const usedSubSlugs = new Set(cat.subcategories.keys());
    const subSlug = ensureUniqueSlug(slugFromLabel(tagLabel), usedSubSlugs);
    const hasPersian = /[\u0600-\u06FF]/.test(tagLabel);
    cat.subcategories.set(subSlug, {
      slug: subSlug,
      name_en: hasPersian ? subSlug : tagLabel,
      name_fa: tagLabel,
    });
    stats.createdSub++;
    if (!dryRun) {
      await db
        .collection(dirCollection)
        .doc(deptSlug)
        .collection("categories")
        .doc(catSlug)
        .collection("subcategories")
        .doc(subSlug)
        .set(
          {
            slug: subSlug,
            name_en: hasPersian ? subSlug : tagLabel,
            name_fa: tagLabel,
            updatedAt: FieldValue.serverTimestamp(),
            source: "sync-myads-from-ads",
          },
          { merge: true },
        );
      await flushDeptCategoriesArray(db, dirCollection, deptSlug, deptState);
    }
    return subSlug;
  }

  for (const dDoc of directorySnap.docs) {
    const dId = dDoc.id;
    const data = dDoc.data();
    const engName = asString(data.engName);
    const faName = asString(data.department);
    let slug = matchDirectoryDeptToDirSlug(depts, dId, engName, faName);
    if (!slug && extendDir) {
      const base = slugFromLabel(engName || faName || dId);
      slug = ensureUniqueSlug(base || slugFromLabel(dId), usedDeptSlugs);
      depts.set(slug, {
        department_en: engName || faName || slug,
        department_fa: faName || engName || slug,
        categories: new Map(),
      });
      stats.createdDept++;
      if (!dryRun) {
        await db
          .collection(dirCollection)
          .doc(slug)
          .set(
            {
              slug,
              department_en: engName || faName || slug,
              department_fa: faName || engName || slug,
              image: `${DIR_ICON_BASE}/${slug}.svg`,
              categories: [],
              updatedAt: FieldValue.serverTimestamp(),
              source: "sync-myads-from-ads",
            },
            { merge: true },
          );
      }
    }
    if (slug) deptToDirSlug.set(dId, slug);
  }
  console.log(`Directory departments mapped to dir slugs: ${deptToDirSlug.size} / ${directorySnap.size}.`);

  for (const dDoc of directorySnap.docs) {
    const dId = dDoc.id;
    const slug = deptToDirSlug.get(dId);
    if (!slug) continue;
    const deptState = depts.get(slug);
    if (!deptState) continue;

    const cats = await readDirectoryDepartmentCategories(db, dId, dDoc.data());
    const usedCatSlugs = new Set(deptState.categories.keys());
    for (const c of cats) {
      let dirCat = matchDirCategoryInDept(deptState, c);
      if (!dirCat && extendDir) {
        const catSlug = ensureUniqueSlug(slugFromLabel(c.engName || c.label || c.code), usedCatSlugs);
        dirCat = {
          slug: catSlug,
          name_en: c.engName || c.label || catSlug,
          name_fa: c.label || c.engName || catSlug,
          tags_en: [],
          tags_fa: [],
          subcategories: new Map(),
        };
        deptState.categories.set(catSlug, dirCat);
        if (!dryRun) {
          const catRef = db.collection(dirCollection).doc(slug).collection("categories").doc(catSlug);
          await catRef.set(
            {
              slug: catSlug,
              name_en: dirCat.name_en,
              name_fa: dirCat.name_fa,
              updatedAt: FieldValue.serverTimestamp(),
              source: "sync-myads-from-ads",
            },
            { merge: true },
          );
          await flushDeptCategoriesArray(db, dirCollection, slug, deptState);
        }
      }
      if (dirCat && dirCat.slug) {
        catKeyToDirCat.set(`${dId}|${c.code}`, {
          slug: dirCat.slug,
          name_en: dirCat.name_en,
          name_fa: dirCat.name_fa,
        });
      }
    }
  }
  console.log(`Category key mappings: ${catKeyToDirCat.size}.`);

  let q = db.collection(sourceAds).orderBy(FieldPath.documentId());
  if (limit) q = q.limit(limit);
  const adsSnap = await q.get();
  console.log(`Processing ${adsSnap.size} ad(s) from "${sourceAds}".`);

  if (dryRun) {
    for (const adDoc of adsSnap.docs) {
      const data = adDoc.data();
      const oldDept = departmentIdFromAd(data);
      const oldCatRaw =
        asString(data.cat_code) || asString(data.catCode) || asString(data.category_code);
      const deptSlug = oldDept ? deptToDirSlug.get(oldDept) : null;
      const dirCat =
        oldDept && oldCatRaw ? catKeyToDirCat.get(`${oldDept}|${oldCatRaw}`) : null;
      if (deptSlug) stats.alignedDept++;
      if (dirCat) stats.alignedCat++;
      if (deptSlug && dirCat) stats.both++;
      const tags = normalizeSubcatsFromAd(data);
      if (deptSlug && dirCat && tags.length) stats.alignedSub++;
    }
    console.log("Dry run:", stats);
    console.log(
      "No documents written (dry run). Run without --dry-run to create/update myads and extend dir.",
    );
    process.exit(0);
  }

  const BATCH = 400;
  let batch = db.batch();
  let ops = 0;

  async function commitBatch() {
    if (ops === 0) return;
    await batch.commit();
    batch = db.batch();
    ops = 0;
  }

  for (const adDoc of adsSnap.docs) {
    const id = adDoc.id;
    const data = adDoc.data();
    const oldDept = departmentIdFromAd(data);
    const oldCatRaw =
      asString(data.cat_code) || asString(data.catCode) || asString(data.category_code);

    let deptSlug = oldDept ? deptToDirSlug.get(oldDept) : null;
    let dirCat =
      oldDept && oldCatRaw ? catKeyToDirCat.get(`${oldDept}|${oldCatRaw}`) : null;

    const notes = [];

    if (!deptSlug && extendDir && oldDept) {
      const dRef = db.collection("directory").doc(oldDept);
      const dSnap = await dRef.get();
      const eng = dSnap.exists ? asString(dSnap.data()?.engName) : "";
      const fa = dSnap.exists ? asString(dSnap.data()?.department) : "";
      let slug = matchDirectoryDeptToDirSlug(depts, oldDept, eng, fa);
      if (!slug) {
        const base = slugFromLabel(eng || fa || oldDept);
        slug = ensureUniqueSlug(base || slugFromLabel(oldDept), usedDeptSlugs);
        depts.set(slug, {
          department_en: eng || fa || slug,
          department_fa: fa || eng || slug,
          categories: new Map(),
        });
        await db
          .collection(dirCollection)
          .doc(slug)
          .set(
            {
              slug,
              department_en: eng || fa || slug,
              department_fa: fa || eng || slug,
              image: `${DIR_ICON_BASE}/${slug}.svg`,
              categories: [],
              updatedAt: FieldValue.serverTimestamp(),
              source: "sync-myads-from-ads",
            },
            { merge: true },
          );
        stats.createdDept++;
      }
      deptToDirSlug.set(oldDept, slug);
      deptSlug = slug;
    }

    const deptState = deptSlug ? depts.get(deptSlug) : null;

    if (!dirCat && extendDir && oldDept && oldCatRaw && deptState) {
      const dRef = db.collection("directory").doc(oldDept);
      const dSnap = await dRef.get();
      const dirCats = dSnap.exists
        ? await readDirectoryDepartmentCategories(db, oldDept, dSnap.data())
        : [];
      const row = dirCats.find((x) => x.code === oldCatRaw) || {
        code: oldCatRaw,
        label: asString(data.cat) || oldCatRaw,
        engName: asString(data.cat) || oldCatRaw,
      };
      let matched = matchDirCategoryInDept(deptState, row);
      if (!matched) {
        const catSlug = ensureUniqueSlug(
          slugFromLabel(row.engName || row.label || row.code),
          new Set(deptState.categories.keys()),
        );
        matched = {
          slug: catSlug,
          name_en: row.engName || row.label || catSlug,
          name_fa: row.label || row.engName || catSlug,
          tags_en: [],
          tags_fa: [],
          subcategories: new Map(),
        };
        deptState.categories.set(catSlug, matched);
        await db
          .collection(dirCollection)
          .doc(deptSlug)
          .collection("categories")
          .doc(catSlug)
          .set(
            {
              slug: catSlug,
              name_en: matched.name_en,
              name_fa: matched.name_fa,
              updatedAt: FieldValue.serverTimestamp(),
              source: "sync-myads-from-ads",
            },
            { merge: true },
          );
        stats.createdCat++;
        await flushDeptCategoriesArray(db, dirCollection, deptSlug, deptState);
      }
      dirCat = { slug: matched.slug, name_en: matched.name_en, name_fa: matched.name_fa };
      catKeyToDirCat.set(`${oldDept}|${oldCatRaw}`, dirCat);
    }

    const out = { ...data };
    if (deptSlug && deptState) {
      out.departmentID = db.collection(dirCollection).doc(deptSlug);
      out.dept = deptState.department_fa || deptState.department_en || out.dept;
      stats.alignedDept++;
    } else {
      notes.push("department_not_in_dir");
    }

    if (dirCat?.slug) {
      out.cat_code = dirCat.slug;
      out.cat = dirCat.name_fa || dirCat.name_en || out.cat;
      stats.alignedCat++;
    } else if (oldCatRaw) {
      notes.push("category_not_in_dir");
    }

    const subSlugList = [];
    if (deptSlug && deptState && dirCat?.slug) {
      for (const tag of normalizeSubcatsFromAd(data)) {
        const ss = await ensureSubcategory(deptSlug, deptState, dirCat.slug, tag);
        if (ss) subSlugList.push(ss);
      }
      if (subSlugList.length) stats.alignedSub++;
    } else {
      const legacy = normalizeSubcatsFromAd(data);
      if (legacy.length) {
        for (const t of legacy) subSlugList.push(slugFromLabel(t));
      }
    }

    out.subcat = subSlugList;
    out.selectedCategoryTags = subSlugList;
    out.dir_subcategory_slugs = subSlugList;

    if (deptSlug && dirCat) stats.both++;

    out.dir_aligned = notes.length === 0 && !!(deptSlug && dirCat);
    if (notes.length) out.dir_align_notes = notes;
    else delete out.dir_align_notes;
    if (deptSlug) {
      out.dir_id = deptSlug;
      out.dir_department_slug = deptSlug;
    } else {
      delete out.dir_id;
      delete out.dir_department_slug;
    }
    if (dirCat?.slug) out.dir_category_slug = dirCat.slug;
    else delete out.dir_category_slug;
    out.myads_syncedAt = FieldValue.serverTimestamp();

    batch.set(db.collection(destMyads).doc(id), out);
    ops++;
    if (ops >= BATCH) {
      await commitBatch();
      console.log(`Committed myads batch… (${id})`);
    }
  }
  await commitBatch();
  console.log(`Wrote ${adsSnap.size} documents to "${destMyads}".`);

  if (!skipPromotions) {
    for (const adDoc of adsSnap.docs) {
      const id = adDoc.id;
      const prom = await db.collection(sourceAds).doc(id).collection("promotions").get();
      if (prom.empty) continue;
      let pb = db.batch();
      let po = 0;
      for (const p of prom.docs) {
        pb.set(db.collection(destMyads).doc(id).collection("promotions").doc(p.id), p.data());
        po++;
        stats.promotionsCopied++;
        if (po >= BATCH) {
          await pb.commit();
          pb = db.batch();
          po = 0;
        }
      }
      if (po > 0) await pb.commit();
    }
    console.log(`Copied ${stats.promotionsCopied} promotion subdocument(s).`);
  }

  console.log("Done:", stats);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

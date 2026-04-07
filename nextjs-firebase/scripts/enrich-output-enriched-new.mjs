import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  asString as dirAsString,
  loadDirDepartmentsState,
  buildCatCodeToDeptSlug,
  resolveCategorySlug,
  resolveDeptSlugByCatPrefix,
  resolveDeptSlugFromAdLabels,
} from "./lib/adDirFirestoreTaxonomy.mjs";

/**
 * Add seq, city_fa, city_id (Firestore cities doc id), dir_id (Firestore dir dept doc id),
 * plus dir_department_slug and dir_category_slug to match output_enriched.json shape.
 *
 *   node ./scripts/enrich-output-enriched-new.mjs [--file ../koochly-scraper/output_enriched_new.json] [--dry-run]
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DEFAULT_FILE = join(ROOT, "..", "koochly-scraper", "output_enriched_new.json");

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

function asString(v) {
  return typeof v === "string" ? v.trim() : "";
}

function normalizeCityKey(s) {
  return asString(s)
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .toLowerCase();
}

function rowCityFa(row) {
  return asString(row.city_fa) || asString(row.city);
}

function rowCityEng(row) {
  return asString(row.city_eng);
}

function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function buildCityIndexes(snap) {
  const existingByEng = new Map();
  const existingByFa = new Map();
  const cityDataById = new Map();

  for (const doc of snap.docs) {
    const c = doc.data();
    const eng = asString(c.city_eng);
    const fa = asString(c.city_fa);
    if (eng) existingByEng.set(normalizeCityKey(eng), doc.id);
    if (fa) existingByFa.set(normalizeCityKey(fa), doc.id);
    cityDataById.set(doc.id, c);
  }
  return { existingByEng, existingByFa, cityDataById };
}

function resolveCityDocId(existingByEng, existingByFa, row) {
  const cityEng = rowCityEng(row);
  const cityFa = rowCityFa(row);
  const ek = normalizeCityKey(cityEng);
  const fk = normalizeCityKey(cityFa);
  if (ek && existingByEng.has(ek)) return existingByEng.get(ek);
  if (fk && existingByFa.has(fk)) return existingByFa.get(fk);
  return null;
}

function mergeDirFieldsFromTaxonomy(payload, row, depts, catCodeToDeptSlug) {
  const catRaw =
    dirAsString(row.cat_code) || dirAsString(row.catCode) || dirAsString(row.category_code);
  const fromMap =
    catRaw && catCodeToDeptSlug.has(catRaw) ? catCodeToDeptSlug.get(catRaw) : null;
  const deptSlug =
    fromMap || resolveDeptSlugByCatPrefix(catRaw, depts) || resolveDeptSlugFromAdLabels(row, depts);
  if (!deptSlug || !depts.has(deptSlug)) return;
  const st = depts.get(deptSlug);
  const catSlug = resolveCategorySlug(row, st, null, new Map());
  if (!dirAsString(payload.dir_id)) payload.dir_id = deptSlug;
  if (!dirAsString(payload.dir_department_slug)) payload.dir_department_slug = deptSlug;
  if (catSlug && !dirAsString(payload.dir_category_slug)) payload.dir_category_slug = catSlug;
}

function parseArgs(argv) {
  let file = DEFAULT_FILE;
  let dryRun = false;
  let dirCollection = "dir";
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") file = argv[++i];
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--dir") dirCollection = asString(argv[++i]) || "dir";
  }
  return { file, dryRun, dirCollection };
}

async function main() {
  loadDotEnv();
  const { file, dryRun, dirCollection } = parseArgs(process.argv);
  if (!existsSync(file)) throw new Error(`File not found: ${file}`);

  const raw = JSON.parse(readFileSync(file, "utf8"));
  const rows = Array.isArray(raw) ? raw : Object.values(raw);
  if (!Array.isArray(rows)) throw new Error("Expected JSON array.");

  const db = await initFirestore();
  const citiesSnap = await db.collection("cities").get();
  const { existingByEng, existingByFa, cityDataById } = buildCityIndexes(citiesSnap);

  const depts = await loadDirDepartmentsState(db, dirCollection);
  const catCodeToDeptSlug = buildCatCodeToDeptSlug(depts);

  let missingCity = 0;
  let missingDir = 0;
  const out = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!isPlainObject(row)) {
      out.push(row);
      continue;
    }

    const seq = i + 1;
    const cityId = resolveCityDocId(existingByEng, existingByFa, row);
    let city_fa = rowCityFa(row);
    if (cityId) {
      const cd = cityDataById.get(cityId);
      const fromDb = cd && asString(cd.city_fa);
      if (fromDb) city_fa = fromDb;
    } else {
      missingCity++;
    }

    const dirPatch = {};
    mergeDirFieldsFromTaxonomy(dirPatch, row, depts, catCodeToDeptSlug);
    if (!dirAsString(dirPatch.dir_id)) missingDir++;

    const next = {
      ...row,
      seq,
      city_fa,
      city_id: cityId,
      ...dirPatch,
    };
    out.push(next);
  }

  console.log(
    `rows=${rows.length} cities.indexed=${citiesSnap.size} dir.depts=${depts.size} ` +
      `missingCity=${missingCity} missingDir=${missingDir} dryRun=${dryRun}`,
  );

  if (!dryRun) {
    writeFileSync(file, `${JSON.stringify(out, null, 2)}\n`, "utf8");
    console.log(`Wrote ${file}`);
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});

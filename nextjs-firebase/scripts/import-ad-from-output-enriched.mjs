#!/usr/bin/env node
/**
 * Import `koochly-scraper/output_enriched_new.json` (or `--file`) into Firestore `ad`.
 * By default, ensures each row's city exists in `cities` (creates missing docs like
 * `sync-missing-cities-from-all.mjs`). Ads get `city_fa` (from JSON `city`) and `cityId`
 * when a city doc is resolved.
 *
 * Usage:
 *   node ./scripts/import-ad-from-output-enriched.mjs --dry-run
 *   node ./scripts/import-ad-from-output-enriched.mjs
 *   node ./scripts/import-ad-from-output-enriched.mjs --file ../koochly-scraper/output_enriched_new.json
 *   node ./scripts/import-ad-from-output-enriched.mjs --file ../koochly-scraper/output_enriched.json --file ../koochly-scraper/output_enriched_new.json
 *   node ./scripts/import-ad-from-output-enriched.mjs --no-ensure-cities
 *   node ./scripts/import-ad-from-output-enriched.mjs --limit 1000 --start 0
 *   node ./scripts/import-ad-from-output-enriched.mjs --dir-fields   (set dir_id / dir_* from Firestore `dir` + cat_code / cat)
 */
import { existsSync, readFileSync } from "node:fs";
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

function parseArgs(argv) {
  const files = [];
  let dryRun = false;
  let limit = null;
  let start = 0;
  let collection = "ad";
  let ensureCities = true;
  let dirFields = false;
  let dirCollection = "dir";
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") {
      const p = asString(argv[++i]);
      if (p) files.push(p);
    }
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--limit") limit = Math.max(1, Number(argv[++i]) || 0);
    else if (a === "--start") start = Math.max(0, Number(argv[++i]) || 0);
    else if (a === "--collection") collection = asString(argv[++i]) || "ad";
    else if (a === "--no-ensure-cities") ensureCities = false;
    else if (a === "--dir-fields") dirFields = true;
    else if (a === "--dir") dirCollection = asString(argv[++i]) || "dir";
    else if (a === "--help" || a === "-h") {
      console.log(`import-ad-from-output-enriched.mjs

Usage:
  node ./scripts/import-ad-from-output-enriched.mjs [--file PATH ...]
                                                   [--collection ad]
                                                   [--start 0]
                                                   [--limit 1000]
                                                   [--no-ensure-cities]
                                                   [--dir-fields]
                                                   [--dir dir]
                                                   [--dry-run]
`);
      process.exit(0);
    }
  }
  if (files.length === 0) files.push(DEFAULT_FILE);
  return { files, dryRun, limit, start, collection, ensureCities, dirFields, dirCollection };
}

function normalizeCityKey(s) {
  return asString(s)
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .toLowerCase();
}

function parseCountryFromAddress(address) {
  const a = asString(address);
  if (!a) return "";
  const parts = a.split(",").map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function convertSpecial(value, db) {
  if (Array.isArray(value)) return value.map((x) => convertSpecial(x, db));
  if (!isPlainObject(value)) return value;

  if (
    Object.keys(value).length === 2 &&
    typeof value.__lat__ === "number" &&
    typeof value.__lon__ === "number"
  ) {
    return new db.GeoPoint(value.__lat__, value.__lon__);
  }

  if (Object.keys(value).length === 1 && typeof value.__time__ === "string") {
    const d = new Date(value.__time__);
    if (!Number.isNaN(d.getTime())) return db.Timestamp.fromDate(d);
  }

  if (Object.keys(value).length === 1 && typeof value.__ref__ === "string") {
    return dbRefFromPath(db, value.__ref__);
  }

  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = convertSpecial(v, db);
  }
  return out;
}

function dbRefFromPath(db, path) {
  const p = asString(path);
  if (!p) return p;
  const parts = p.split("/").filter(Boolean);
  if (parts.length < 2 || parts.length % 2 !== 0) return p;
  let ref = db.collection(parts[0]).doc(parts[1]);
  for (let i = 2; i < parts.length; i += 2) {
    ref = ref.collection(parts[i]).doc(parts[i + 1]);
  }
  return ref;
}

function rowCityFa(row) {
  return asString(row.city_fa) || asString(row.city);
}

function rowCityEng(row) {
  return asString(row.city_eng);
}

/**
 * @param {import("firebase-admin/firestore").Firestore} db
 * @param {ReturnType<typeof parseArgs>} opts
 * @param {object[]} rows
 */
async function ensureCitiesForRows(db, opts, rows) {
  const { FieldValue, GeoPoint } = await import("firebase-admin/firestore");
  const existingSnap = await db.collection("cities").get();
  const existingByEng = new Map();
  const existingByFa = new Map();
  const countryMetaByEng = new Map();

  for (const doc of existingSnap.docs) {
    const c = doc.data();
    const eng = asString(c.city_eng);
    const fa = asString(c.city_fa);
    if (eng) existingByEng.set(normalizeCityKey(eng), doc.id);
    if (fa) existingByFa.set(normalizeCityKey(fa), doc.id);

    const countryEng = asString(c.country_eng);
    if (countryEng) {
      const key = normalizeCityKey(countryEng);
      if (!countryMetaByEng.has(key)) {
        countryMetaByEng.set(key, {
          country_fa: asString(c.country_fa),
          flag_url: asString(c.flag_url),
          currency_symbol: asString(c.currency_symbol),
        });
      }
    }
  }

  const candidateByDedupe = new Map();
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    const cityEng = rowCityEng(row);
    const cityFa = rowCityFa(row);
    if (!cityEng && !cityFa) continue;
    const dedupe = normalizeCityKey(cityEng) || normalizeCityKey(cityFa);
    if (!dedupe) continue;
    if (candidateByDedupe.has(dedupe)) continue;
    const lat =
      typeof row?.location?.__lat__ === "number" ? row.location.__lat__ : null;
    const lon =
      typeof row?.location?.__lon__ === "number" ? row.location.__lon__ : null;
    candidateByDedupe.set(dedupe, {
      city_eng: cityEng,
      city_fa: cityFa,
      country_eng: parseCountryFromAddress(row.address),
      lat,
      lon,
    });
  }

  const toCreate = [];
  for (const c of candidateByDedupe.values()) {
    const engKey = normalizeCityKey(c.city_eng);
    const faKey = normalizeCityKey(c.city_fa);
    if ((engKey && existingByEng.has(engKey)) || (faKey && existingByFa.has(faKey))) {
      continue;
    }
    toCreate.push(c);
  }

  let citiesAdded = 0;
  if (toCreate.length > 0) {
    const cityWriter = opts.dryRun
      ? null
      : db.bulkWriter();
    if (cityWriter) {
      cityWriter.onWriteError((err) => {
        if (err.failedAttempts < 5) return true;
        return false;
      });
    }

    for (const c of toCreate) {
      const countryKey = normalizeCityKey(c.country_eng);
      const known = countryMetaByEng.get(countryKey) || {
        country_fa: "",
        flag_url: "",
        currency_symbol: "",
      };

      const cityRef = db.collection("cities").doc();
      const payload = {
        active: true,
        city_eng: c.city_eng,
        city_fa: c.city_fa,
        country_eng: c.country_eng,
        country_fa: known.country_fa,
        flag_url: known.flag_url,
        currency_symbol: known.currency_symbol,
        order: 0,
        results: "[]",
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      };
      if (typeof c.lat === "number" && typeof c.lon === "number") {
        payload.latlng = new GeoPoint(c.lat, c.lon);
      }

      const engKey = normalizeCityKey(c.city_eng);
      const faKey = normalizeCityKey(c.city_fa);
      if (cityWriter) {
        if (engKey) existingByEng.set(engKey, cityRef.id);
        if (faKey) existingByFa.set(faKey, cityRef.id);
        cityWriter.set(cityRef, payload, { merge: true });
      }
      citiesAdded++;
      console.log(
        `${opts.dryRun ? "[dry-run] " : ""}add city: ${c.city_eng || c.city_fa || cityRef.id}`,
      );
    }

    if (cityWriter) await cityWriter.close();
  }

  return { existingByEng, existingByFa, citiesAdded };
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

/** Fill `dir_id`, `dir_department_slug`, `dir_category_slug` when missing (scraped cat_code like "beauty"). */
function mergeDirFieldsFromTaxonomy(payload, row, depts, catCodeToDeptSlug) {
  if (
    dirAsString(payload.dir_id) &&
    dirAsString(payload.dir_department_slug) &&
    dirAsString(payload.dir_category_slug)
  ) {
    return;
  }
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

async function main() {
  loadDotEnv();
  const { files, dryRun, limit, start, collection, ensureCities, dirFields, dirCollection } =
    parseArgs(process.argv);
  for (const file of files) {
    if (!existsSync(file)) throw new Error(`File not found: ${file}`);
  }

  const allRows = [];
  for (const file of files) {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const part = Array.isArray(raw) ? raw : Object.values(raw);
    if (!Array.isArray(part)) throw new Error(`Expected JSON array/object in ${file}.`);
    allRows.push(...part);
  }

  const rows = allRows.slice(start, limit ? start + limit : undefined);
  if (rows.length === 0) {
    console.log("Nothing to import.");
    return;
  }

  const db = await initFirestore();
  const adminFs = await import("firebase-admin/firestore");
  const helper = {
    GeoPoint: adminFs.GeoPoint,
    Timestamp: adminFs.Timestamp,
  };

  let depts = null;
  let catCodeToDeptSlug = null;
  if (dirFields) {
    depts = await loadDirDepartmentsState(db, dirCollection);
    catCodeToDeptSlug = buildCatCodeToDeptSlug(depts);
    console.log(
      `dir-fields: loaded ${depts.size} dept(s) from "${dirCollection}", ${catCodeToDeptSlug.size} cat key(s).`,
    );
  }

  let existingByEng = new Map();
  let existingByFa = new Map();
  let citiesAdded = 0;

  if (ensureCities) {
    const r = await ensureCitiesForRows(db, { dryRun }, rows);
    existingByEng = r.existingByEng;
    existingByFa = r.existingByFa;
    citiesAdded = r.citiesAdded;
  }

  let written = 0;
  let skipped = 0;

  const writer = db.bulkWriter();
  writer.onWriteError((err) => {
    // Retry transient write failures; stop on permanent failures.
    if (err.failedAttempts < 5) return true;
    return false;
  });

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!isPlainObject(row)) {
      skipped++;
      continue;
    }
    const docId = asString(row.id) || asString(row.google_place_id) || asString(row.seq);
    if (!docId) {
      skipped++;
      continue;
    }
    const payload = convertSpecial(row, helper);
    const fa = rowCityFa(row);
    if (fa && !asString(payload.city_fa)) payload.city_fa = fa;
    if (ensureCities) {
      const cid = resolveCityDocId(existingByEng, existingByFa, row);
      if (cid) payload.cityId = cid;
    }
    if (dirFields && depts && catCodeToDeptSlug) {
      mergeDirFieldsFromTaxonomy(payload, row, depts, catCodeToDeptSlug);
    }
    const ref = db.collection(collection).doc(docId);
    if (!dryRun) writer.set(ref, payload, { merge: true });
    written++;
    if ((i + 1) % 500 === 0) {
      console.log(`Progress: ${i + 1}/${rows.length}`);
    }
  }

  if (!dryRun) await writer.close();
  console.log(
    `${dryRun ? "[dry-run] " : ""}done. collection=${collection}, files=${files.length}, scanned=${rows.length}, written=${written}, skipped=${skipped}` +
      (ensureCities ? `, citiesAdded=${citiesAdded}` : "") +
      (dirFields ? `, dirFields=${dirCollection}` : ""),
  );
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});


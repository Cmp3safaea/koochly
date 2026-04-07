/**
 * Enrich koochly-scraper/output_enriched_new_2.json:
 * - Assign `seq` (fills missing; reserves above max of Firestore `ad.seq` and existing JSON seq).
 * - Ensure each row's city exists in Firestore `cities` (creates missing docs).
 * - Set `cityId` + `city_fa` from resolved city doc.
 * - Set `dir_id`, `dir_department_slug`, `dir_category_slug` from Firestore `dir` + `cat_code`.
 *
 * Usage:
 *   node ./scripts/enrich-output-enriched-new-2.mjs [--dry-run]
 *   node ./scripts/enrich-output-enriched-new-2.mjs --file ../koochly-scraper/output_enriched_new_2.json
 */
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DEFAULT_FILE = join(ROOT, "..", "koochly-scraper", "output_enriched_new_2.json");

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

function parseCountryFromAddress(address) {
  const a = asString(address);
  if (!a) return "";
  const parts = a.split(",").map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
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

function coerceSeq(v) {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.trim());
    if (Number.isFinite(n) && n > 0) return n;
  }
  return NaN;
}

async function maxSeqFirestore(db) {
  try {
    const snap = await db.collection("ad").orderBy("seq", "desc").limit(1).get();
    if (!snap.empty) {
      const v = snap.docs[0].data().seq;
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n)) return n;
    }
  } catch {
    /* collection may lack single-field orderBy index */
  }
  return 0;
}

/**
 * Ensure cities for JSON rows: create missing in Firestore, return eng/fa → doc id maps.
 * (Same behavior as import-ad-from-output-enriched.mjs ensureCitiesForRows.)
 */
async function ensureCitiesForRows(db, dryRun, rows) {
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
    const cityWriter = dryRun
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
        `${dryRun ? "[dry-run] " : ""}add city: ${c.city_eng || c.city_fa || cityRef.id}`,
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

  const cityPrep = await ensureCitiesForRows(db, dryRun, rows);
  const { existingByEng, existingByFa, citiesAdded } = cityPrep;

  const depts = await loadDirDepartmentsState(db, dirCollection);
  const catCodeToDeptSlug = buildCatCodeToDeptSlug(depts);

  const citiesSnap = await db.collection("cities").get();
  const cityDataById = new Map();
  for (const doc of citiesSnap.docs) {
    cityDataById.set(doc.id, doc.data());
  }

  let maxSeq = await maxSeqFirestore(db);
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    const s = coerceSeq(row.seq);
    if (Number.isFinite(s) && s > maxSeq) maxSeq = s;
  }
  let nextSeq = maxSeq + 1;

  let missingDir = 0;
  const out = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!isPlainObject(row)) {
      out.push(row);
      continue;
    }

    let seq = coerceSeq(row.seq);
    if (!Number.isFinite(seq)) {
      seq = nextSeq;
      nextSeq += 1;
    } else if (seq >= nextSeq) {
      nextSeq = seq + 1;
    }

    const cityId = resolveCityDocId(existingByEng, existingByFa, row);
    let city_fa = rowCityFa(row);
    if (cityId) {
      const cd = cityDataById.get(cityId);
      const fromDb = cd && asString(cd.city_fa);
      if (fromDb) city_fa = fromDb;
    }

    const dirPatch = {};
    mergeDirFieldsFromTaxonomy(dirPatch, row, depts, catCodeToDeptSlug);
    if (!dirAsString(dirPatch.dir_id)) missingDir++;

    out.push({
      ...row,
      seq,
      city_fa,
      ...(cityId ? { cityId } : {}),
      ...dirPatch,
    });
  }

  console.log(
    `rows=${rows.length} cities.added=${citiesAdded} dir.depts=${depts.size} ` +
      `cat.map=${catCodeToDeptSlug.size} missingDir=${missingDir} dryRun=${dryRun}`,
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

#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DEFAULT_ALL_JSON = join(ROOT, "..", "koochly-scraper", "all.json");

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

function normalize(s) {
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

function parseArgs() {
  let allPath = DEFAULT_ALL_JSON;
  let dryRun = false;
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--all") allPath = process.argv[++i];
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--help" || a === "-h") {
      console.log(`sync-missing-cities-from-all.mjs

Usage:
  node ./scripts/sync-missing-cities-from-all.mjs [--all ../koochly-scraper/all.json] [--dry-run]
`);
      process.exit(0);
    }
  }
  return { allPath, dryRun };
}

async function main() {
  loadDotEnv();
  const { allPath, dryRun } = parseArgs();
  if (!existsSync(allPath)) {
    throw new Error(`all.json not found: ${allPath}`);
  }

  const data = JSON.parse(readFileSync(allPath, "utf8"));
  if (!Array.isArray(data)) {
    throw new Error("Expected all.json to be a JSON array.");
  }

  const db = await initFirestore();
  const { FieldValue, GeoPoint } = await import("firebase-admin/firestore");

  const existingSnap = await db.collection("cities").get();
  const existingByEng = new Map();
  const existingByFa = new Map();
  const countryMetaByEng = new Map();

  for (const doc of existingSnap.docs) {
    const c = doc.data();
    const eng = asString(c.city_eng);
    const fa = asString(c.city_fa);
    if (eng) existingByEng.set(normalize(eng), doc.id);
    if (fa) existingByFa.set(normalize(fa), doc.id);

    const countryEng = asString(c.country_eng);
    if (countryEng) {
      const key = normalize(countryEng);
      if (!countryMetaByEng.has(key)) {
        countryMetaByEng.set(key, {
          country_fa: asString(c.country_fa),
          flag_url: asString(c.flag_url),
          currency_symbol: asString(c.currency_symbol),
        });
      }
    }
  }

  const candidates = new Map();
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const cityEng = asString(row.city_eng);
    const cityFa = asString(row.city);
    if (!cityEng && !cityFa) continue;
    const key = normalize(cityEng || cityFa);
    if (!key) continue;
    if (!candidates.has(key)) {
      candidates.set(key, {
        city_eng: cityEng,
        city_fa: cityFa,
        country_eng: parseCountryFromAddress(row.address),
        lat: row?.location?.__lat__,
        lon: row?.location?.__lon__,
      });
    }
  }

  let addCount = 0;
  let skipExisting = 0;
  for (const [_, c] of candidates) {
    const engKey = normalize(c.city_eng);
    const faKey = normalize(c.city_fa);
    if ((engKey && existingByEng.has(engKey)) || (faKey && existingByFa.has(faKey))) {
      skipExisting++;
      continue;
    }

    const countryKey = normalize(c.country_eng);
    const known = countryMetaByEng.get(countryKey) || {
      country_fa: "",
      flag_url: "",
      currency_symbol: "",
    };

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

    if (!dryRun) {
      await db.collection("cities").doc().set(payload, { merge: true });
    }
    addCount++;
    console.log(`${dryRun ? "[dry-run] " : ""}add city: ${c.city_eng || c.city_fa}`);
  }

  console.log(`Done. candidates=${candidates.size}, existing=${skipExisting}, added=${addCount}`);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});


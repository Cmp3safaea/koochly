#!/usr/bin/env node
/**
 * Fetch Places listings in the UAE focused on Persian / Iranian businesses (restaurants, grocery, bakery, cafe…).
 * Uses biased text queries + types; results are not guaranteed Iranian-owned—verify before publishing.
 * Output JSON is a lean list of place fields (not your ads/Firestore document shape).
 *
 * Usage:
 *   node ./scripts/import-places-draft.mjs --static-cities --cities dubai,abu_dhabi,sharjah --max-total 100
 *
 * Region is always AE. Default Places language: English; use --language fa for more Farsi place names where available.
 *
 * @see https://developers.google.com/maps/documentation/places/web-service/text-search
 */

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PLACES_SEARCH_TEXT = "https://places.googleapis.com/v1/places:searchText";

/** Fields billed per Places SKU; keep mask tight for cost control. */
function placesFieldMask(includePhotos) {
  const fields = [
    "places.id",
    "places.types",
    "places.displayName",
    "places.formattedAddress",
    "places.location",
    "places.nationalPhoneNumber",
    "places.internationalPhoneNumber",
    "places.websiteUri",
    "places.businessStatus",
  ];
  if (includePhotos) {
    const i = fields.indexOf("places.businessStatus");
    if (i >= 0) fields.splice(i, 0, "places.photos");
    else fields.push("places.photos");
  }
  return fields.join(",");
}

/** UAE-only: Google region, default language, static emirate centers (--static-cities). */
const UAE_REGION_CODE = "AE";
const UAE_LANGUAGE_CODE = "en";

const UAE_QUERY_ROTATIONS = JSON.parse(
  readFileSync(join(__dirname, "data", "uae-iranian-query-rotations.json"), "utf8"),
);

const UAE_IMPORT_SUBCAT_TAGS = ["persian_iranian_uae"];
const UAE_IMPORT_FOCUS_LINE =
  "Discovery focus: Persian / Iranian business in UAE (verify ownership & category before publish).";

const UAE_STATIC_CITIES = JSON.parse(
  readFileSync(join(__dirname, "data", "uae-static-cities.json"), "utf8"),
);

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

function parseArgs(argv) {
  const o = {
    maxTotal: 100,
    cities: [],
    out: join(ROOT, "tmp", "places-import-draft.json"),
    reset: false,
    perCityMax: null,
    staticCities: false,
    language: null,
    radiusMeters: 35000,
    dryRun: false,
    /** When set, disable rotation and use this query only */
    textQuery: null,
    includedType: null,
    includePhotos: true,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--max-total") o.maxTotal = Math.max(1, Number(argv[++i]) || 100);
    else if (a === "--cities")
      o.cities = argv[++i].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    else if (a === "--out") o.out = argv[++i];
    else if (a === "--reset") o.reset = true;
    else if (a === "--per-city-max") o.perCityMax = Math.max(1, Number(argv[++i]) || 1);
    else if (a === "--static-cities") o.staticCities = true;
    else if (a === "--language") o.language = argv[++i].trim().toLowerCase();
    else if (a === "--radius") o.radiusMeters = Math.max(1000, Number(argv[++i]) || 35000);
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--text-query") o.textQuery = argv[++i];
    else if (a === "--included-type") o.includedType = argv[++i];
    else if (a === "--no-photos") o.includePhotos = false;
    else if (a === "--help" || a === "-h") {
      console.log(`import-places-draft.mjs - Persian / Iranian businesses in UAE (region AE)

  --cities slug1,slug2  Required. UAE static slugs (dubai, abu_dhabi, ...) or Firestore city keys.
  --max-total N         Stop after N unique places (default 100).
  --static-cities       Use built-in UAE emirate centers (no Firestore).
  --language code       Places language (default en; try fa for more Farsi names, ar for Arabic).
  --out PATH            Output JSON (default tmp/places-import-draft.json).
  --reset               Ignore existing file (do not merge).
  --per-city-max N      Cap each city at N rows (optional).
  --radius M            locationBias circle radius in meters (default 35000).
  --no-photos           Omit places.photos from API + no photoName in JSON (saves SKU).
  --text-query "..."    Single query; disables rotation.
  --included-type T     Google Places primary type (optional).
  --dry-run             Print plan only, no HTTP.

  Output items are lean place records (not ads). Use photoName with GET /api/places/photo if needed.

  Example:
    --static-cities --cities dubai,abu_dhabi,sharjah --max-total 100

Env:
  GOOGLE_PLACES_API_KEY  (preferred) or GOOGLE_MAPS_API_KEY
  Firebase Admin envs    If not --static-cities, for cities collection lookup
`);
      process.exit(0);
    }
  }
  return o;
}

function perCityTargets(numCities, maxTotal, perCityMax) {
  if (numCities <= 0) return [];
  const base = Math.floor(maxTotal / numCities);
  let rem = maxTotal % numCities;
  const targets = [];
  for (let i = 0; i < numCities; i++) {
    let t = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
    if (perCityMax != null) t = Math.min(t, perCityMax);
    targets.push(Math.max(0, t));
  }
  return targets;
}

function pickLatLng(data) {
  const raw = data.latlng;
  if (raw && typeof raw === "object") {
    const lat = raw.__lat__ ?? raw.lat ?? raw.latitude;
    const lon = raw.__lon__ ?? raw.lng ?? raw.lon ?? raw.longitude;
    if (typeof lat === "number" && typeof lon === "number") return { lat, lon };
  }
  return null;
}

async function initFirestoreIfNeeded() {
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
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  if (projectId) {
    initializeApp({ projectId });
  } else {
    initializeApp();
  }
  return getFirestore();
}

function titleCaseAscii(slug) {
  if (!slug) return slug;
  return slug.charAt(0).toUpperCase() + slug.slice(1).toLowerCase();
}

async function resolveCityFromFirestore(db, slugRaw) {
  const slug = slugRaw.trim();
  const engCandidates = [slug, slug.toLowerCase(), titleCaseAscii(slug)];
  for (const v of engCandidates) {
    const q1 = await db.collection("cities").where("city_eng", "==", v).limit(1).get();
    if (!q1.empty) return { id: q1.docs[0].id, data: q1.docs[0].data() };
  }
  const q2 = await db.collection("cities").where("city_fa", "==", slug).limit(1).get();
  if (!q2.empty) return { id: q2.docs[0].id, data: q2.docs[0].data() };
  const doc = await db.collection("cities").doc(slug).get();
  if (doc.exists) return { id: doc.id, data: doc.data() };
  return null;
}

function resolveStaticCity(slug, staticCityMap) {
  const row = staticCityMap[slug];
  if (!row) return null;
  return {
    id: slug,
    data: {
      city_fa: row.city_fa,
      city_eng: row.city_eng,
      latlng: { lat: row.lat, lng: row.lng },
    },
  };
}

/** Places API (New) returns id and/or name: places/ChIJ... */
function extractPlaceId(place) {
  if (!place || typeof place !== "object") return "";
  if (typeof place.id === "string" && place.id.trim()) return place.id.trim();
  const n = place.name;
  if (typeof n === "string" && n.startsWith("places/")) return n.slice("places/".length);
  return "";
}

function displayNameText(place) {
  const d = place.displayName;
  if (!d) return "";
  if (typeof d === "string") return d;
  if (typeof d.text === "string") return d.text;
  return "";
}

function pickPhone(place) {
  const n = place.nationalPhoneNumber;
  if (typeof n === "string" && n.trim()) return n.trim();
  const i = place.internationalPhoneNumber;
  if (typeof i === "string" && i.trim()) return i.trim();
  return "";
}

/** Lean place row for spreadsheets or review — not the ads collection schema. */
function placeToLeanRecord(place, ctx) {
  const googlePlaceId = extractPlaceId(place);
  const name = displayNameText(place);
  const types = Array.isArray(place.types) ? place.types : [];
  const primaryType = types[0] || "";
  const loc = place.location || {};
  const lat = typeof loc.latitude === "number" ? loc.latitude : null;
  const lon = typeof loc.longitude === "number" ? loc.longitude : null;

  let photoName;
  if (ctx.includePhotos) {
    const p0 = Array.isArray(place.photos) ? place.photos[0] : null;
    if (p0?.name && typeof p0.name === "string") photoName = p0.name;
  }

  const { cityRow, catRow, subcatTags } = ctx;
  const cityFa =
    typeof cityRow.data.city_fa === "string" && cityRow.data.city_fa.trim()
      ? cityRow.data.city_fa.trim()
      : "";
  const cityEng =
    typeof cityRow.data.city_eng === "string" && cityRow.data.city_eng.trim()
      ? cityRow.data.city_eng.trim()
      : "";

  const tags = Array.isArray(subcatTags) ? subcatTags.filter(Boolean) : [];

  const rec = {
    googlePlaceId,
    name,
    address: typeof place.formattedAddress === "string" ? place.formattedAddress : "",
    location: lat != null && lon != null ? { lat, lon } : null,
    phone: pickPhone(place),
    website:
      typeof place.websiteUri === "string" && place.websiteUri.trim()
        ? place.websiteUri.trim()
        : "",
    types,
    primaryType,
    cityId: cityRow.id,
    city: cityFa || cityEng,
    cityEn: cityEng || cityFa,
    matchedSearchQuery: catRow.textQuery,
    searchCategoryCode: catRow.catCode,
    tags,
    source: "google_places",
  };

  if (photoName) rec.photoName = photoName;
  if (place.businessStatus && place.businessStatus !== "OPERATIONAL") {
    rec.businessStatus = place.businessStatus;
  }

  return rec;
}

async function searchTextPage(apiKey, body, fieldMask) {
  const res = await fetch(PLACES_SEARCH_TEXT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Places searchText HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  if (!res.ok) {
    const msg = json.error?.message || text.slice(0, 500);
    throw new Error(`Places searchText ${res.status}: ${msg}`);
  }
  return json;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function collectForCity(apiKey, opts, cityRow, targetForCity, seen, items) {
  const latLng = pickLatLng(cityRow.data);
  if (!latLng) {
    console.warn(`Skip city ${cityRow.id}: missing latlng in Firestore/static data`);
    return;
  }

  const fieldMask = placesFieldMask(opts.includePhotos);
  const rotations =
    opts.textQuery != null
      ? [
          {
            textQuery: opts.textQuery,
            includedType: opts.includedType || undefined,
            catCode: opts.includedType || "custom",
            cat: opts.textQuery,
          },
        ]
      : UAE_QUERY_ROTATIONS;
  const cityHint =
    `${cityRow.data.city_eng || ""} ${cityRow.data.city_fa || ""}`.trim();

  let addedHere = 0;

  for (const catRow of rotations) {
    if (items.length >= opts.maxTotal || addedHere >= targetForCity) return;

    let pageToken = undefined;
    const baseBody = {
      textQuery: `${catRow.textQuery} ${cityHint}`.trim(),
      languageCode: opts.languageCode,
      regionCode: opts.regionCode,
      pageSize: 20,
      rankPreference: "DISTANCE",
      locationBias: {
        circle: {
          center: { latitude: latLng.lat, longitude: latLng.lon },
          radius: opts.radiusMeters,
        },
      },
    };
    if (catRow.includedType) {
      baseBody.includedType = catRow.includedType;
      baseBody.strictTypeFiltering = false;
    }

    for (;;) {
      if (items.length >= opts.maxTotal || addedHere >= targetForCity) return;

      const body = { ...baseBody };
      if (pageToken) body.pageToken = pageToken;

      if (opts.dryRun) {
        console.log("[dry-run] would call searchText", JSON.stringify(body, null, 0));
        return;
      }

      const json = await searchTextPage(apiKey, body, fieldMask);
      pageToken = json.nextPageToken || undefined;
      const places = Array.isArray(json.places) ? json.places : [];

      for (const place of places) {
        if (items.length >= opts.maxTotal || addedHere >= targetForCity) return;
        if (place.businessStatus && place.businessStatus === "CLOSED_PERMANENTLY") continue;

        const pid = extractPlaceId(place);
        if (!pid || seen.has(pid)) continue;
        seen.add(pid);

        const row = placeToLeanRecord(place, {
          cityRow,
          catRow,
          subcatTags: UAE_IMPORT_SUBCAT_TAGS,
          includePhotos: opts.includePhotos,
        });
        items.push(row);
        addedHere++;
        const idShort = (row.googlePlaceId || "?").slice(0, 12);
        console.log(`+ ${row.name} (${cityRow.id}) [${idShort}...]`);
      }

      if (!pageToken || places.length === 0) break;
      await sleep(250);
    }

    await sleep(150);
  }
}

async function main() {
  loadDotEnv();
  const opts = parseArgs(process.argv);

  opts.regionCode = UAE_REGION_CODE;
  opts.languageCode = opts.language || UAE_LANGUAGE_CODE;
  opts.staticCityMap = UAE_STATIC_CITIES;

  if (opts.cities.length === 0) {
    console.error("Error: provide --cities slug1,slug2 (see --help)");
    process.exit(1);
  }

  const apiKey = (
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    ""
  ).trim();
  if (!apiKey && !opts.dryRun) {
    console.error("Error: set GOOGLE_PLACES_API_KEY (or GOOGLE_MAPS_API_KEY) in .env");
    process.exit(1);
  }

  let db = null;
  if (!opts.staticCities) {
    try {
      db = await initFirestoreIfNeeded();
    } catch (e) {
      console.error("Firebase init failed:", e.message || e);
      console.error("Hint: use --static-cities for built-in UAE emirate centers (dubai, abu_dhabi, ...).");
      process.exit(1);
    }
  }

  const map = opts.staticCityMap;
  const resolved = [];
  for (const slug of opts.cities) {
    let row = opts.staticCities ? resolveStaticCity(slug, map) : null;
    if (!row && db) {
      row = await resolveCityFromFirestore(db, slug);
    }
    if (!row) {
      console.warn(`Unknown city slug "${slug}" - skipped`);
      continue;
    }
    if (!pickLatLng(row.data) && map[slug]) {
      console.warn(`City "${slug}" has no latlng in Firestore; using UAE static center`);
      row = resolveStaticCity(slug, map);
    }
    if (!pickLatLng(row.data)) {
      console.warn(`Skip "${slug}": no coordinates`);
      continue;
    }
    resolved.push(row);
  }

  if (resolved.length === 0) {
    console.error("No cities resolved.");
    process.exit(1);
  }

  const targets = perCityTargets(resolved.length, opts.maxTotal, opts.perCityMax);
  console.log(
    `UAE region=${opts.regionCode} lang=${opts.languageCode} | cities=${resolved.map((r) => r.id).join(", ")} | maxTotal=${opts.maxTotal} | perCityTargets=${targets.join(",")}`,
  );

  let items = [];
  const seen = new Set();
  if (!opts.reset && existsSync(opts.out)) {
    try {
      const prev = JSON.parse(readFileSync(opts.out, "utf8"));
      if (Array.isArray(prev.items)) {
        items = prev.items;
        for (const it of items) {
          const pid = it.googlePlaceId;
          if (pid) seen.add(pid);
        }
        console.log(`Merged ${items.length} existing draft(s) from ${opts.out}`);
      }
    } catch {
      console.warn("Could not parse existing file; starting fresh");
      items = [];
      seen.clear();
    }
  }

  const startLen = items.length;
  if (startLen >= opts.maxTotal) {
    console.log(`Already at ${startLen} >= maxTotal ${opts.maxTotal}; nothing to do.`);
    return;
  }

  for (let i = 0; i < resolved.length; i++) {
    if (items.length >= opts.maxTotal) break;
    const cityRow = resolved[i];
    let budget = targets[i];
    const room = opts.maxTotal - items.length;
    budget = Math.min(budget, room);
    if (budget <= 0) continue;

    console.log(`\n- City ${cityRow.id} (target +${budget})`);
    await collectForCity(apiKey, opts, cityRow, budget, seen, items);
  }

  const outDir = dirname(opts.out);
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const payload = {
    exportedAt: new Date().toISOString(),
    meta: {
      country: "AE",
      discoveryFocus: "persian_iranian_businesses",
      verificationNote: UAE_IMPORT_FOCUS_LINE,
      regionCode: opts.regionCode,
      languageCode: opts.languageCode,
      maxTotal: opts.maxTotal,
      cities: resolved.map((r) => r.id),
      staticCities: opts.staticCities,
      includePhotos: opts.includePhotos,
      addedThisRun: items.length - startLen,
      totalItems: items.length,
    },
    items,
  };

  if (opts.dryRun) {
    console.log("\n[dry-run] no file written.");
    return;
  }

  const tmp = `${opts.out}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
  renameSync(tmp, opts.out);
  console.log(`\nWrote ${items.length} item(s) to ${opts.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

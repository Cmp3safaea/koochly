#!/usr/bin/env node
/**
 * Import department/category taxonomy JSON into Firestore collection `dir`.
 *
 * Each top-level array item becomes one document: doc id = `slug` (e.g. experts_consultants).
 * Fields: department_en, department_fa, slug, categories (array), image (public icon URL), updatedAt.
 *
 * Usage:
 *   node ./scripts/import-dir-taxonomy.mjs
 *   node ./scripts/import-dir-taxonomy.mjs --file ./path/to/file.json
 *   node ./scripts/import-dir-taxonomy.mjs --dry-run
 *   node ./scripts/import-dir-taxonomy.mjs --collection dir_custom
 *
 * Env (same as other Admin scripts):
 *   FIREBASE_SERVICE_ACCOUNT_KEY | FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 | GOOGLE_APPLICATION_CREDENTIALS
 *   Or Application Default Credentials + GOOGLE_CLOUD_PROJECT / NEXT_PUBLIC_FIREBASE_PROJECT_ID
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DEFAULT_JSON = join(__dirname, "data", "koochly_taxonomy_300_clean_tags.json");

/** Public URL segment; files live in `public/department-icons/{slug}.svg`. */
const DEPARTMENT_ICON_BASE = "/department-icons";

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
  let file = DEFAULT_JSON;
  let dryRun = false;
  let collection = "dir";
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") file = argv[++i];
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--collection") collection = argv[++i].trim();
    else if (a === "--help" || a === "-h") {
      console.log(`import-dir-taxonomy.mjs — Firestore import for taxonomy JSON

  --file PATH       JSON file (default: scripts/data/koochly_taxonomy_300_clean_tags.json)
  --collection NAME Firestore collection (default: dir)
  --dry-run         Parse JSON and print counts only; no writes

Requires Firebase Admin credentials (see script header).
`);
      process.exit(0);
    }
  }
  return { file, dryRun, collection };
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

function validateSlug(slug) {
  if (!slug || typeof slug !== "string") return false;
  const t = slug.trim();
  if (!t || t.length > 700) return false;
  if (t.includes("/")) return false;
  return true;
}

async function main() {
  loadDotEnv();
  const { file, dryRun, collection } = parseArgs(process.argv);

  if (!existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }

  const raw = readFileSync(file, "utf8");
  let rows;
  try {
    rows = JSON.parse(raw);
  } catch (e) {
    console.error("Invalid JSON:", e.message);
    process.exit(1);
  }
  if (!Array.isArray(rows)) {
    console.error("JSON root must be an array of departments.");
    process.exit(1);
  }

  const prepared = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const slug = typeof row.slug === "string" ? row.slug.trim() : "";
    if (!validateSlug(slug)) {
      console.warn("skip: invalid or missing slug", row.department_en ?? row);
      continue;
    }
    prepared.push({
      slug,
      department_en: typeof row.department_en === "string" ? row.department_en : "",
      department_fa: typeof row.department_fa === "string" ? row.department_fa : "",
      categories: Array.isArray(row.categories) ? row.categories : [],
    });
  }

  console.log(`Parsed ${prepared.length} departments from ${file}`);
  if (dryRun) {
    const cats = prepared.reduce((n, r) => n + r.categories.length, 0);
    console.log(`Dry run: would write ${prepared.length} docs to collection "${collection}" (${cats} category rows total).`);
    process.exit(0);
  }

  const { FieldValue } = await import("firebase-admin/firestore");
  const db = await initFirestore();
  const BATCH_MAX = 400;
  let batch = db.batch();
  let inBatch = 0;
  let written = 0;

  for (const row of prepared) {
    const ref = db.collection(collection).doc(row.slug);
    batch.set(
      ref,
      {
        department_en: row.department_en,
        department_fa: row.department_fa,
        slug: row.slug,
        categories: row.categories,
        image: `${DEPARTMENT_ICON_BASE}/${row.slug}.svg`,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    inBatch++;
    written++;
    if (inBatch >= BATCH_MAX) {
      await batch.commit();
      console.log(`Committed batch (${written} docs so far)`);
      batch = db.batch();
      inBatch = 0;
    }
  }
  if (inBatch > 0) {
    await batch.commit();
  }

  console.log(`Done: ${written} documents in Firestore collection "${collection}".`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

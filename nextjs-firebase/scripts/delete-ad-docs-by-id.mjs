#!/usr/bin/env node
/**
 * Delete Firestore `ad` documents by id list (JSON array or tehran-ids.json shape).
 *
 * Usage:
 *   node ./scripts/delete-ad-docs-by-id.mjs --ids-file ../koochly-scraper/tehran-ids.json
 *   node ./scripts/delete-ad-docs-by-id.mjs --dry-run --ids-file ...
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

function parseArgs() {
  let idsFile = "";
  let dryRun = false;
  let collection = "ad";
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--ids-file") idsFile = process.argv[++i];
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--collection") collection = process.argv[++i] || "ad";
  }
  return { idsFile, dryRun, collection };
}

function loadIds(filePath) {
  const raw = JSON.parse(readFileSync(filePath, "utf8"));
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string" && x.trim());
  if (raw && Array.isArray(raw.idsUnion)) return raw.idsUnion.filter((x) => typeof x === "string");
  throw new Error("Expected JSON array of ids or object with idsUnion");
}

async function main() {
  loadDotEnv();
  const { idsFile, dryRun, collection } = parseArgs();
  if (!idsFile || !existsSync(idsFile)) {
    console.error("Usage: --ids-file path/to/tehran-ids.json");
    process.exit(1);
  }
  const ids = loadIds(idsFile);
  if (ids.length === 0) {
    console.log("No ids to delete.");
    return;
  }

  const db = await initFirestore();
  let deleted = 0;
  let missing = 0;

  for (const id of ids) {
    const ref = db.collection(collection).doc(id.trim());
    const snap = await ref.get();
    if (!snap.exists) {
      missing++;
      continue;
    }
    if (!dryRun) await ref.delete();
    deleted++;
  }

  const summary = `${dryRun ? "[dry-run] " : ""}collection=${collection} requested=${ids.length} deleted=${deleted} missing=${missing}`;
  console.log(summary);
  try {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(ROOT, "..", "koochly-scraper", "delete-ad-tehran-result.txt"), summary + "\n", "utf8");
  } catch {
    /* ignore */
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});

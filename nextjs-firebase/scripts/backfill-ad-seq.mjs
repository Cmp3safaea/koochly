#!/usr/bin/env node
/**
 * Assign numeric `seq` (and canonical `url`) to every `ad` doc that lacks a valid seq.
 * Valid seq: finite number or numeric string, integer > 0 (same idea as `nextAdSeq` / SEO helpers).
 * New seq values start at max(existing seq) + 1, or 10000 if no ad has a valid seq yet.
 *
 * Usage:
 *   node ./scripts/backfill-ad-seq.mjs --dry-run
 *   node ./scripts/backfill-ad-seq.mjs
 *   node ./scripts/backfill-ad-seq.mjs --collection ad --max-updates 50
 *   node ./scripts/backfill-ad-seq.mjs --no-update-url
 *
 * Requires the same credentials as other scripts (see import-ad-from-output-enriched.mjs).
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

function siteBaseUrl() {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//, "");
    return `https://${host.replace(/\/+$/, "")}`;
  }
  return "http://localhost:3000";
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

/** @returns {number | null} positive integer seq or null */
function coerceSeq(seqRaw) {
  if (typeof seqRaw === "number" && Number.isFinite(seqRaw)) {
    const n = Math.floor(seqRaw);
    return n > 0 ? n : null;
  }
  if (typeof seqRaw === "string") {
    const n = Number(seqRaw.trim());
    if (Number.isFinite(n)) {
      const f = Math.floor(n);
      return f > 0 ? f : null;
    }
  }
  return null;
}

function parseArgs(argv) {
  let dryRun = false;
  let collection = "ad";
  let maxUpdates = null;
  let updateUrl = true;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--collection") collection = argv[++i] || "ad";
    else if (a === "--max-updates") maxUpdates = Math.max(1, Number(argv[++i]) || 0);
    else if (a === "--no-update-url") updateUrl = false;
    else if (a === "--help" || a === "-h") {
      console.log(`backfill-ad-seq.mjs

  --dry-run          Scan only; print summary
  --collection ad    Firestore collection (default: ad)
  --max-updates N    Stop after N writes (for testing)
  --no-update-url    Only set seq; leave url unchanged
`);
      process.exit(0);
    }
  }
  return { dryRun, collection, maxUpdates, updateUrl };
}

async function main() {
  loadDotEnv();
  const { dryRun, collection, maxUpdates, updateUrl } = parseArgs(process.argv);
  const db = await initFirestore();
  const { FieldPath } = await import("firebase-admin/firestore");

  let lastDoc = null;
  const pageSize = 500;
  let maxSeq = 0;
  let anyValid = false;
  /** @type {{ ref: import('firebase-admin/firestore').DocumentReference, id: string }[]} */
  const needs = [];
  /** @type {Map<number, string>} */
  const seqOwner = new Map();
  let scanned = 0;

  for (;;) {
    let q = db.collection(collection).orderBy(FieldPath.documentId()).limit(pageSize);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    for (const doc of snap.docs) {
      scanned++;
      const data = doc.data();
      const v = coerceSeq(data.seq);
      if (v !== null) {
        anyValid = true;
        if (v > maxSeq) maxSeq = v;
        const prev = seqOwner.get(v);
        if (prev && prev !== doc.id) {
          console.warn(`duplicate seq ${v}: docs "${prev}" and "${doc.id}"`);
        }
        seqOwner.set(v, doc.id);
      } else {
        needs.push({ ref: doc.ref, id: doc.id });
      }
    }
    lastDoc = snap.docs[snap.docs.length - 1];
  }

  let nextSeq = anyValid ? maxSeq + 1 : 10000;
  let toApply = needs;
  if (maxUpdates != null && needs.length > maxUpdates) {
    toApply = needs.slice(0, maxUpdates);
  }

  const base = siteBaseUrl();
  console.log(
    JSON.stringify(
      {
        collection,
        dryRun,
        scanned,
        maxExistingSeq: anyValid ? maxSeq : null,
        missingSeqCount: needs.length,
        willAssign: toApply.length,
        nextSeqStart: toApply.length ? nextSeq : null,
        updateUrl,
        siteBaseUrl: base,
      },
      null,
      2,
    ),
  );

  if (dryRun || toApply.length === 0) {
    if (toApply.length && dryRun) {
      const preview = toApply.slice(0, 5).map((row, i) => ({
        id: row.id,
        seq: nextSeq + i,
        url: updateUrl ? `${base}/b/${nextSeq + i}` : "(unchanged)",
      }));
      console.log("preview (first 5):", JSON.stringify(preview, null, 2));
    }
    return;
  }

  const BATCH = 450;
  let written = 0;
  for (let i = 0; i < toApply.length; ) {
    const batch = db.batch();
    const end = Math.min(i + BATCH, toApply.length);
    for (; i < end; i++) {
      const row = toApply[i];
      const seq = nextSeq++;
      const patch = { seq };
      if (updateUrl) patch.url = `${base}/b/${seq}`;
      batch.update(row.ref, patch);
      written++;
    }
    await batch.commit();
    console.log(`committed ${written}/${toApply.length}`);
  }

  console.log(`done. updated ${written} document(s).`);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});

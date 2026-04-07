/**
 * Set `seq` on every document in the `ad` collection to 1..N in stable order
 * (Firestore document id ascending via FieldPath.documentId()).
 *
 *   node ./scripts/renumber-ad-seq-all.mjs [--dry-run]
 *   node ./scripts/renumber-ad-seq-all.mjs --collection ad
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

function parseArgs(argv) {
  let dryRun = false;
  let collection = "ad";
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--collection") collection = String(argv[++i] || "").trim() || "ad";
  }
  return { dryRun, collection };
}

async function main() {
  loadDotEnv();
  const { dryRun, collection } = parseArgs(process.argv);
  const db = await initFirestore();
  const { FieldPath } = await import("firebase-admin/firestore");

  const refs = [];
  let lastDoc;
  const pageSize = 500;

  for (;;) {
    let q = db.collection(collection).orderBy(FieldPath.documentId()).limit(pageSize);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) refs.push(doc.ref);
    lastDoc = snap.docs[snap.docs.length - 1];
  }

  const total = refs.length;
  console.log(`${dryRun ? "[dry-run] " : ""}collection=${collection} documents=${total} → seq 1..${total}`);

  if (dryRun || total === 0) return;

  const writer = db.bulkWriter();
  writer.onWriteError((err) => (err.failedAttempts < 5 ? true : false));

  let seq = 1;
  for (const ref of refs) {
    writer.update(ref, { seq });
    seq++;
    if (seq % 2000 === 1 && seq > 1) console.log(`… ${seq - 1}/${total}`);
  }

  await writer.close();
  console.log(`Done. Updated seq on ${total} document(s).`);
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});

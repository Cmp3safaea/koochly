import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadDotEnv() {
  const envPath = join(ROOT, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
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
    if (!process.env[key]) process.env[key] = val;
  }
}

async function initFirestore() {
  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  if (getApps().length > 0) return getFirestore();
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_KEY?.trim();
  if (json) initializeApp({ credential: cert(JSON.parse(json)) });
  else initializeApp();
  return getFirestore();
}

loadDotEnv();
const ids = JSON.parse(
  readFileSync(join(ROOT, "..", "koochly-scraper", "tehran-ids.json"), "utf8"),
).idsUnion;
const db = await initFirestore();
let still = 0;
for (const id of ids) {
  const s = await db.collection("ad").doc(id).get();
  if (s.exists) still++;
}
writeFileSync(
  join(ROOT, "..", "koochly-scraper", "tehran-delete-verify.txt"),
  `checked=${ids.length} stillExist=${still}\n`,
);

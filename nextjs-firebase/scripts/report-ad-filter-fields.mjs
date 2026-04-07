#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "..", "koochly-scraper", "ad-filter-report.json");

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

async function main() {
  loadDotEnv();
  const db = await initFirestore();
  const snap = await db.collection("ad").limit(3000).get();

  let hasCatCode = 0;
  let hasDirCat = 0;
  let hasDepartmentID = 0;
  let hasDirDept = 0;
  let hasDirId = 0;
  let approved = 0;
  const cityCounts = new Map();

  for (const doc of snap.docs) {
    const d = doc.data();
    if (typeof d.cat_code === "string" && d.cat_code.trim()) hasCatCode++;
    if (typeof d.dir_category_slug === "string" && d.dir_category_slug.trim()) hasDirCat++;
    if (d.departmentID != null) hasDepartmentID++;
    if (typeof d.dir_department_slug === "string" && d.dir_department_slug.trim()) hasDirDept++;
    if (typeof d.dir_id === "string" && d.dir_id.trim()) hasDirId++;
    if (d.approved === true) approved++;
    if (typeof d.city_eng === "string" && d.city_eng.trim()) {
      const k = d.city_eng.trim();
      cityCounts.set(k, (cityCounts.get(k) || 0) + 1);
    }
  }

  const topCities = Array.from(cityCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([city, count]) => ({ city, count }));

  writeFileSync(
    OUT,
    JSON.stringify(
      {
        scanned: snap.size,
        hasCatCode,
        hasDirCat,
        hasDepartmentID,
        hasDirDept,
        hasDirId,
        approved,
        topCities,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  writeFileSync(OUT, JSON.stringify({ error: e instanceof Error ? e.message : String(e) }, null, 2));
  process.exit(0);
});


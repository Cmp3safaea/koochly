#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "..", "koochly-scraper", "los-angeles-check.json");

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
  if (json) {
    initializeApp({ credential: cert(JSON.parse(json)) });
  } else {
    initializeApp();
  }
  return getFirestore();
}

async function main() {
  loadDotEnv();
  const db = await initFirestore();
  const snap = await db.collection("cities").where("city_eng", "==", "Los Angeles").limit(5).get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  writeFileSync(OUT, JSON.stringify({ city_eng: "Los Angeles", count: snap.size, rows }, null, 2));
}

main().catch((e) => {
  writeFileSync(OUT, JSON.stringify({ error: e instanceof Error ? e.message : String(e) }, null, 2));
  process.exit(0);
});


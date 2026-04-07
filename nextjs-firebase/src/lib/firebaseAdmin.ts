import fs from "node:fs";
import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import type { Bucket } from "@google-cloud/storage";

let firestore: Firestore | null = null;

function initFirebaseAdmin() {
  // Idempotent init: safe to call multiple times (Cloud Run hot reload, etc).
  if (getApps().length > 0) return;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  const serviceAccountJsonBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64;
  const googleApplicationCredentialsPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (serviceAccountJson) {
    // Raw JSON string (works well with Cloud Run secrets).
    initializeApp({ credential: cert(JSON.parse(serviceAccountJson)) });
    return;
  } else {
    if (serviceAccountJsonBase64) {
      const decoded = Buffer.from(serviceAccountJsonBase64, "base64").toString(
        "utf8",
      );
      initializeApp({ credential: cert(JSON.parse(decoded)) });
      return;
    }

    if (googleApplicationCredentialsPath) {
      // Standard Google env var: points to a JSON file on disk.
      const raw = fs.readFileSync(googleApplicationCredentialsPath, "utf8");
      initializeApp({ credential: cert(JSON.parse(raw)) });
      return;
    }

    // Uses Application Default Credentials (recommended for Cloud Run).
    // Include explicit project id when present (e.g. Docker build-arg) so init
    // does not fail with "Unable to detect a Project Id" before ADC works.
    const projectId =
      process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
      process.env.GCLOUD_PROJECT?.trim() ||
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
    if (projectId) {
      initializeApp({ projectId });
    } else {
      initializeApp();
    }
  }
}

export function getFirestoreAdmin(): Firestore {
  if (firestore) return firestore;
  initFirebaseAdmin();
  firestore = getFirestore();
  return firestore;
}

/** Ensures the Firebase Admin app is initialized; use for auth/storage after Firestore init. */
export function getFirebaseAuthAdmin() {
  getFirestoreAdmin();
  return getAuth();
}

let storageBucket: Bucket | null = null;

/**
 * Resolves the GCS bucket name for Firebase Storage uploads.
 * `getStorage().bucket()` with no argument only works if `storageBucket` was set at `initializeApp`,
 * which we do not set — so we always pass an explicit name.
 *
 * Override with `FIREBASE_STORAGE_BUCKET` (e.g. `myproj.firebasestorage.app` or `myproj.appspot.com`).
 */
export function resolveFirebaseStorageBucketName(): string {
  const explicit = process.env.FIREBASE_STORAGE_BUCKET?.trim();
  if (explicit) return explicit;

  const projectId =
    (() => {
      try {
        return getApp().options.projectId?.trim();
      } catch {
        return undefined;
      }
    })() ||
    process.env.GOOGLE_CLOUD_PROJECT?.trim() ||
    process.env.GCLOUD_PROJECT?.trim() ||
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();

  if (!projectId) {
    throw new Error(
      "Firebase Storage bucket unknown: set FIREBASE_STORAGE_BUCKET in .env, or ensure the Admin " +
        "SDK has a project id (service account JSON / GOOGLE_CLOUD_PROJECT).",
    );
  }

  // Default bucket created in modern Firebase projects (*.firebasestorage.app in download URLs).
  return `${projectId}.firebasestorage.app`;
}

/** Opens the configured Firebase Storage bucket (see `resolveFirebaseStorageBucketName`). */
export function getFirebaseStorageBucket(): Bucket {
  if (storageBucket) return storageBucket;
  getFirestoreAdmin();
  const name = resolveFirebaseStorageBucketName();
  storageBucket = getStorage().bucket(name);
  return storageBucket;
}

type AdminAdDoc = Record<string, unknown> & { url?: string };

/** Ad row from Firestore plus stable document `id` (used by `/b/[seq]` and `/ad/[adId]`). */
export type AdminLoadedAd = Record<string, unknown> & {
  id: string;
  url?: string;
  approved?: boolean;
  seq?: number | string;
  title?: string;
  engName?: string;
  details?: string;
};

function toLoadedAd(docId: string, data: Record<string, unknown>): AdminLoadedAd {
  return { id: docId, ...data } as AdminLoadedAd;
}

export async function loadAdBySeq(seq: number): Promise<AdminLoadedAd | null> {
  const db = getFirestoreAdmin();
  const q = await db.collection("ad").where("seq", "==", seq).limit(1).get();
  if (!q.empty) {
    const d = q.docs[0];
    return toLoadedAd(d.id, d.data() as Record<string, unknown>);
  }

  const subset = await db.collection("ad").limit(800).get();
  const doc = subset.docs.find((d) => {
    const data = d.data() as AdminAdDoc;
    return typeof data.url === "string" && data.url.includes(`/b/${seq}`);
  });
  if (!doc) return null;
  return toLoadedAd(doc.id, doc.data() as Record<string, unknown>);
}

export async function loadAdByDocId(docId: string): Promise<AdminLoadedAd | null> {
  const id = docId.trim();
  if (!id) return null;
  const db = getFirestoreAdmin();
  const snap = await db.collection("ad").doc(id).get();
  if (!snap.exists) return null;
  return toLoadedAd(snap.id, snap.data() as Record<string, unknown>);
}


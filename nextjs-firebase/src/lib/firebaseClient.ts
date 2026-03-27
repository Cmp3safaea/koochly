import type { FirebaseApp } from "firebase/app";
import { getApps, initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, type Auth } from "firebase/auth";
import type { FirebaseWebPublicConfig } from "./firebaseWebConfig";

let firebaseApp: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let googleProviderInstance: GoogleAuthProvider | null = null;

/** Set from the server via `FirebaseRuntimeInit` so Cloud Run runtime env applies. */
let runtimeInjectedConfig: FirebaseWebPublicConfig | null = null;

export function applyFirebaseWebPublicConfig(cfg: FirebaseWebPublicConfig | null) {
  runtimeInjectedConfig = cfg;
}

function pickEnv(e: NodeJS.ProcessEnv, name: string): string {
  const v = e[name];
  return typeof v === "string" ? v.trim() : "";
}

function readProcessEnvFirebaseConfig(): FirebaseWebPublicConfig | null {
  const e = process.env;
  const apiKey =
    pickEnv(e, "NEXT_PUBLIC_FIREBASE_API_KEY") || pickEnv(e, "FIREBASE_WEB_API_KEY");
  const authDomain =
    pickEnv(e, "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN") ||
    pickEnv(e, "FIREBASE_WEB_AUTH_DOMAIN");
  const projectId =
    pickEnv(e, "NEXT_PUBLIC_FIREBASE_PROJECT_ID") ||
    pickEnv(e, "FIREBASE_WEB_PROJECT_ID");
  const appId =
    pickEnv(e, "NEXT_PUBLIC_FIREBASE_APP_ID") || pickEnv(e, "FIREBASE_WEB_APP_ID");
  const measurementId =
    pickEnv(e, "NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID") ||
    pickEnv(e, "FIREBASE_WEB_MEASUREMENT_ID") ||
    undefined;
  const messagingSenderId =
    pickEnv(e, "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID") ||
    pickEnv(e, "FIREBASE_WEB_MESSAGING_SENDER_ID") ||
    undefined;

  if (!apiKey || !authDomain || !projectId || !appId) return null;

  const cfg: FirebaseWebPublicConfig = {
    apiKey,
    authDomain,
    projectId,
    appId,
  };
  if (measurementId) cfg.measurementId = measurementId;
  if (messagingSenderId) cfg.messagingSenderId = messagingSenderId;
  return cfg;
}

function getFirebaseConfigOrNull(): FirebaseWebPublicConfig | null {
  if (runtimeInjectedConfig) {
    const c = runtimeInjectedConfig;
    if (c.apiKey && c.authDomain && c.projectId && c.appId) return c;
  }
  return readProcessEnvFirebaseConfig();
}

export function isFirebaseClientConfigured(): boolean {
  return getFirebaseConfigOrNull() !== null;
}

function getFirebaseAppOrNull(): FirebaseApp | null {
  if (firebaseApp) return firebaseApp;
  if (getApps().length > 0) {
    firebaseApp = getApps()[0]!;
    return firebaseApp;
  }
  const cfg = getFirebaseConfigOrNull();
  if (!cfg) return null;
  firebaseApp = initializeApp(cfg);
  return firebaseApp;
}

export function getAuthClient(): Auth {
  const maybe = getAuthClientOrNull();
  if (!maybe) {
    throw new Error(
      "Firebase client is not configured. Set NEXT_PUBLIC_FIREBASE_* (or FIREBASE_WEB_*) env vars, or pass config from the server via FirebaseRuntimeInit.",
    );
  }
  return maybe;
}

export function getAuthClientOrNull(): Auth | null {
  if (authInstance) return authInstance;
  const app = getFirebaseAppOrNull();
  if (!app) return null;
  authInstance = getAuth(app);
  return authInstance;
}

export function getGoogleProvider(): GoogleAuthProvider {
  if (googleProviderInstance) return googleProviderInstance;
  googleProviderInstance = new GoogleAuthProvider();
  return googleProviderInstance;
}


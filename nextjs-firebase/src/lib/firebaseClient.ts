import type { FirebaseApp } from "firebase/app";
import { getApps, initializeApp } from "firebase/app";
import { GoogleAuthProvider, getAuth, type Auth } from "firebase/auth";

let firebaseApp: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let googleProviderInstance: GoogleAuthProvider | null = null;

function getFirebaseConfigOrNull() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim();
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN?.trim();
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim();
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID?.trim();

  const missing: string[] = [];
  if (!apiKey) missing.push("NEXT_PUBLIC_FIREBASE_API_KEY");
  if (!authDomain) missing.push("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN");
  if (!projectId) missing.push("NEXT_PUBLIC_FIREBASE_PROJECT_ID");
  if (!appId) missing.push("NEXT_PUBLIC_FIREBASE_APP_ID");

  if (missing.length > 0) return null;

  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    // Optional fields (leave undefined if not provided).
    measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID?.trim() || undefined,
    messagingSenderId:
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID?.trim() || undefined,
  };
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
      "Firebase client is not configured. Set NEXT_PUBLIC_FIREBASE_* env vars in nextjs-firebase/.env.",
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


import { unstable_noStore } from "next/cache";

/** Public Firebase web app fields (safe to pass to the browser; not secret). */
export type FirebaseWebPublicConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  measurementId?: string;
  messagingSenderId?: string;
};

function pickEnv(e: NodeJS.ProcessEnv, name: string): string {
  const v = e[name];
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Reads Firebase web config from the current process env (Cloud Run runtime works).
 * Prefer passing the result into `FirebaseRuntimeInit` so the client bundle does not rely
 * on `NEXT_PUBLIC_*` being present at `next build`.
 *
 * Supports `NEXT_PUBLIC_FIREBASE_*` or `FIREBASE_WEB_*` aliases (same values).
 */
export function getFirebaseWebPublicConfig(): FirebaseWebPublicConfig | null {
  unstable_noStore();
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

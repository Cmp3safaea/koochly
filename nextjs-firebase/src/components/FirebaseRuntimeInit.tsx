"use client";

import type { FirebaseWebPublicConfig } from "../lib/firebaseWebConfig";
import { applyFirebaseWebPublicConfig } from "../lib/firebaseClient";

/**
 * Applies Firebase web config from the server before other client code reads `process.env`.
 * Render as the first child inside `I18nProvider` (see `[locale]/layout.tsx`).
 */
export default function FirebaseRuntimeInit({
  config,
}: {
  config: FirebaseWebPublicConfig | null;
}) {
  applyFirebaseWebPublicConfig(config);
  return null;
}

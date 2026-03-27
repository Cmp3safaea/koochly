import { unstable_noStore } from "next/cache";

/**
 * Google Maps JS API key for Server → Client props. Prefer `GOOGLE_MAPS_BROWSER_KEY`
 * on Cloud Run (`NEXT_PUBLIC_*` is often inlined empty at `next build`).
 *
 * Bracket env access + `noStore()` avoid static/cached shells that skip runtime env.
 */
export function getMapsBrowserApiKey(): string {
  unstable_noStore();
  const e = process.env;
  const pick = (name: string) => {
    const v = e[name];
    return typeof v === "string" ? v.trim() : "";
  };
  return (
    pick("GOOGLE_MAPS_BROWSER_KEY") ||
    pick("GOOGLE_MAPS_API_KEY") ||
    pick("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY") ||
    ""
  );
}

/**
 * Google Maps JavaScript API key, read on the server only and passed into client
 * map components. `NEXT_PUBLIC_*` is inlined at `next build`; if the image was
 * built without that key, `process.env.NEXT_PUBLIC_...` stays empty at runtime on
 * Cloud Run. Use `GOOGLE_MAPS_BROWSER_KEY` (same secret value) in production.
 */
export function getMapsBrowserApiKey(): string {
  return (
    process.env.GOOGLE_MAPS_BROWSER_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() ||
    ""
  );
}

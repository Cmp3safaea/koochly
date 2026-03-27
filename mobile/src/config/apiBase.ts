/**
 * Public Next.js site origin (no trailing slash).
 * Set `EXPO_PUBLIC_API_BASE_URL` in `mobile/.env` (e.g. http://192.168.1.10:3000) so a
 * physical device can reach your dev server.
 */
export function getApiBaseUrl(): string {
  const raw = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (raw) return raw.replace(/\/$/, "");
  return "http://127.0.0.1:3000";
}

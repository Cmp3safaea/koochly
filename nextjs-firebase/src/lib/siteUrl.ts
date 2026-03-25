/**
 * Canonical site origin for absolute URLs (metadata, sitemap, robots).
 * Set `NEXT_PUBLIC_SITE_URL` in production (e.g. `https://www.example.com`).
 */
export function getSiteBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//, "");
    return `https://${host.replace(/\/+$/, "")}`;
  }

  return "http://localhost:3000";
}

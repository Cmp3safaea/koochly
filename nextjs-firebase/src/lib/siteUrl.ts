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

/**
 * Request-aware origin for sitemap, robots, etc. Uses proxy headers on Cloud Run when
 * `NEXT_PUBLIC_SITE_URL` is unset. Dynamic-imports `next/headers` so this module stays safe for
 * non-request contexts that only call `getSiteBaseUrl()`.
 */
export async function getSiteBaseUrlFromRequest(): Promise<string> {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const { headers } = await import("next/headers");
  const h = await headers();
  const hostRaw = h.get("x-forwarded-host") ?? h.get("host");
  if (hostRaw) {
    const host = hostRaw.split(",")[0].trim();
    const protoPart = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const isLocal =
      /^127\.\d+\.\d+\.\d+/.test(host) ||
      host.startsWith("localhost") ||
      host.startsWith("[::1]");
    const protocol =
      protoPart === "http" || protoPart === "https"
        ? protoPart
        : isLocal
          ? "http"
          : "https";
    return `${protocol}://${host}`.replace(/\/+$/, "");
  }

  return getSiteBaseUrl();
}

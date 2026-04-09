import type { MetadataRoute } from "next";
import { getSiteBaseUrlFromRequest } from "../lib/siteUrl";

export const revalidate = 3600;

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = await getSiteBaseUrlFromRequest();
  const host = (() => {
    try {
      return new URL(base).host;
    } catch {
      return undefined;
    }
  })();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/"],
    },
    sitemap: `${base}/sitemap.xml`,
    ...(host ? { host } : {}),
  };
}

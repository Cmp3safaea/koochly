import { getSiteBaseUrlFromRequest } from "./siteUrl";

export async function buildRobotsTxtBody(): Promise<string> {
  const base = await getSiteBaseUrlFromRequest();
  let hostSuffix = "";
  try {
    const host = new URL(base).host;
    if (host) hostSuffix = "\n\nHost: " + host;
  } catch {
    /* skip */
  }
  return (
    "User-agent: *\n" +
    "Allow: /\n" +
    "Disallow: /api/\n" +
    "\n" +
    "Sitemap: " +
    base +
    "/sitemap.xml" +
    hostSuffix +
    "\n"
  );
}

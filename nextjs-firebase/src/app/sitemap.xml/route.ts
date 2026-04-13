import { NextResponse } from "next/server";
import { buildSitemapEntries, sitemapEntriesToXml } from "../../lib/sitemapEntries";
import { getSiteBaseUrlFromRequest } from "../../lib/siteUrl";

export const revalidate = 3600;

export async function GET() {
  const base = await getSiteBaseUrlFromRequest();
  const entries = await buildSitemapEntries(base);
  const xml = sitemapEntriesToXml(entries);
  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate",
    },
  });
}

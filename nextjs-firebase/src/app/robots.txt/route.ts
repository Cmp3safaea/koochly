import { NextResponse } from "next/server";
import { buildRobotsTxtBody } from "../../lib/robotsTxtBody";

export const revalidate = 3600;

export async function GET() {
  const body = await buildRobotsTxtBody();
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate",
    },
  });
}

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { defaultLocale, isLocale, type Locale } from "@koochly/shared";

function firstSegment(pathname: string): string | undefined {
  return pathname.split("/").filter(Boolean)[0];
}

function pathWithoutQuery(pathname: string): string {
  const q = pathname.indexOf("?");
  return (q === -1 ? pathname : pathname.slice(0, q)).replace(/\/+$/, "") || "/";
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const base = pathWithoutQuery(pathname);
  const baseLower = base.toLowerCase();
  // SEO routes live at the app root (`app/sitemap.xml/route.ts`, `app/robots.txt/route.ts`),
  // not under `/[locale]`. Skipping locale rewrite avoids 404 on `/sitemap.xml`, etc.
  if (
    baseLower === "/sitemap.xml" ||
    baseLower === "/robots.txt" ||
    baseLower.startsWith("/sitemap/")
  ) {
    return NextResponse.next();
  }

  const seg = firstSegment(pathname);
  const hasLocale = Boolean(seg && isLocale(seg));

  if (hasLocale && seg === defaultLocale) {
    const url = request.nextUrl.clone();
    const parts = pathname.split("/").filter(Boolean).slice(1);
    url.pathname = parts.length > 0 ? `/${parts.join("/")}` : "/";
    return NextResponse.redirect(url);
  }

  if (!hasLocale) {
    const url = request.nextUrl.clone();
    const suffix = pathname === "/" ? "" : pathname;
    url.pathname = `/${defaultLocale}${suffix}`;
    const res = NextResponse.rewrite(url);
    res.headers.set("x-next-locale", defaultLocale);
    return res;
  }

  const res = NextResponse.next();
  res.headers.set("x-next-locale", seg as Locale);
  return res;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api, Next internals, static files
     * - .xml / .txt so `/sitemap.xml` and `/robots.txt` never hit locale rewrite (fixes 404 on prod).
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|xml|txt)$).*)",
  ],
};

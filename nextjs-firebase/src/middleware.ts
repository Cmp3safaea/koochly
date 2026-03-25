import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { defaultLocale, isLocale, type Locale } from "./i18n/config";

function firstSegment(pathname: string): string | undefined {
  return pathname.split("/").filter(Boolean)[0];
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const seg = firstSegment(pathname);
  const hasLocale = Boolean(seg && isLocale(seg));

  if (!hasLocale) {
    const url = request.nextUrl.clone();
    const suffix = pathname === "/" ? "" : pathname;
    url.pathname = `/${defaultLocale}${suffix}`;
    return NextResponse.redirect(url);
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
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

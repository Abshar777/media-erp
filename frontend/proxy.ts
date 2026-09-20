import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/reports/shared", // public read-only shared reports
  // Somebody arriving from the Root portal has no session yet, by definition.
  // Without this the guard sent them to /login before the page could redeem
  // their token, so the one route whose job is to establish a session was the
  // one route that required one already.
  "/sso",
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = request.cookies.get("access_token")?.value;
  if (!token) {
    const loginUrl = new URL("/login", request.url);
    if (pathname !== "/") loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Exclude API routes (`/api/*`) so the auth gate never intercepts the
  // backend proxy — otherwise login/register requests get 307-redirected to
  // /login and never reach the API. Also exclude PWA assets under `/icons/`
  // (multi-segment paths that the trailing-file rule below doesn't catch) so
  // the manifest's icons load without auth for the install prompt.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|api/|[^/]*\\.[^/]*$).*)"],
};

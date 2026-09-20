import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * No auth gate here any more.
 *
 * This used to redirect to /login whenever an `access_token` cookie was
 * absent. That worked while Media ERP was only ever opened directly, and
 * broke the moment the Root portal began opening it in an iframe: a gate that
 * runs on the server can only read cookies, and a cookie belonging to a
 * third-party frame is unreliable — SameSite=Lax forbids it outright, and
 * browsers now block third-party cookies even at SameSite=None.
 *
 * So the session was established correctly and then thrown away one
 * navigation later: tokens in localStorage, no cookie, gate redirects to
 * /login. From the outside that is indistinguishable from the sign-in being
 * rejected, which is exactly how it was read.
 *
 * The three sales CRMs never had this problem, and the reason is precisely
 * this: they have no server-side gate. The session lives in localStorage,
 * which a frame does not interfere with, and the client decides.
 *
 * Nothing is unprotected by removing it. `app/(dashboard)/layout.tsx` already
 * gates every page behind the same check, renders a spinner rather than
 * content until it passes, and sends anybody without a session to /login. The
 * API is the real boundary regardless: it authenticates the bearer token on
 * every request, and a page that renders without one shows nothing.
 *
 * What is lost is the redirect happening a few hundred milliseconds earlier,
 * before any JavaScript. That is the trade, and it is the same one the CRMs
 * have always made.
 *
 * The file stays because Next resolves the proxy by name, and because the
 * matcher below is the record of which paths were deliberately excluded.
 */
export function proxy(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  // Exclude API routes (`/api/*`) so nothing here intercepts the backend
  // proxy. Also exclude PWA assets under `/icons/` (multi-segment paths the
  // trailing-file rule below doesn't catch) so the manifest's icons load for
  // the install prompt.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|api/|[^/]*\\.[^/]*$).*)"],
};

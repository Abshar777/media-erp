/**
 * The cookie that `proxy.ts` reads to decide whether somebody is signed in.
 *
 * The session itself lives in localStorage; this exists only so the route
 * guard, which runs on the server and cannot see localStorage, knows not to
 * bounce every page to /login.
 *
 * Written in one place because it is written from two — the auth store on
 * sign-in and the interceptor on refresh — and a cookie whose attributes
 * disagreed between the two would work until the first token refresh and then
 * quietly stop.
 */

const NAME = "access_token";
const WEEK = 60 * 60 * 24 * 7;

/**
 * SameSite=None, but only over HTTPS.
 *
 * The Root portal opens this application in an iframe, which makes it
 * third-party to the page around it, and a SameSite=Lax cookie is never
 * stored in that position — by design, since that is the defence against
 * cross-site request forgery. Signing in from the portal therefore looked
 * like a failure and was not: the tokens reached localStorage, this cookie
 * was discarded, and the guard sent the next page straight back to /login.
 *
 * SameSite=None requires Secure, and a Secure cookie is dropped over plain
 * http — so on http this keeps Lax rather than writing a cookie the browser
 * will refuse, which would break local development in the same silent way.
 * Keyed on the actual protocol rather than a build flag, because it is the
 * protocol the rule is about.
 *
 * This is a real reduction: another site can now cause a request carrying
 * this cookie. It is a route-guard marker rather than the session — the API
 * authenticates on the bearer token from localStorage, which a cross-site
 * request cannot read — but it is worth knowing it is no longer Lax.
 */
function attributes(): string {
  const secure = typeof window !== "undefined" && window.location.protocol === "https:";
  return secure ? "SameSite=None; Secure" : "SameSite=Lax";
}

export function writeAuthCookie(token: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${NAME}=${token}; path=/; max-age=${WEEK}; ${attributes()}`;
}

export function clearAuthCookie(): void {
  if (typeof document === "undefined") return;
  // Cleared with the same attributes it was written with: a browser matches
  // on name, path and domain, so an expiry written differently still removes
  // it — but keeping them aligned avoids a stale duplicate under some paths.
  document.cookie = `${NAME}=; path=/; max-age=0; ${attributes()}`;
}

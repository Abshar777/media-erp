/**
 * Eviction only. Nothing writes this cookie any more.
 *
 * It existed so the server-side gate in proxy.ts could tell whether somebody
 * was signed in. That gate is gone — it could not work inside the Root
 * portal's frame, where a third-party cookie is unreliable — so the cookie has
 * no reader left, and writing an access token into a cookie that JavaScript
 * can read and that rides along with every request is not worth doing for
 * nobody's benefit.
 *
 * Clearing it is kept, and deliberately: browsers that signed in before this
 * change are still holding one. Signing out should take it away rather than
 * leave it sitting there until it expires.
 */

const NAME = "access_token";

export function clearAuthCookie(): void {
  if (typeof document === "undefined") return;
  /*
   * Cleared under both attribute sets it was ever written with. A browser
   * matches a cookie on name, path and domain — not on SameSite — but an
   * expiry written over https must itself carry Secure, or it is refused and
   * the stale cookie survives the sign-out that was meant to remove it.
   */
  document.cookie = `${NAME}=; path=/; max-age=0; SameSite=Lax`;
  if (typeof window !== "undefined" && window.location.protocol === "https:") {
    document.cookie = `${NAME}=; path=/; max-age=0; SameSite=None; Secure`;
  }
}

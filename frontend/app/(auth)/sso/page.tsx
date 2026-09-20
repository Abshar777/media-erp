"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowRight } from "lucide-react";
import api from "@/lib/axios";
import { redirectAfterLogin } from "@/lib/redirectTo";

/**
 * Arriving from the Root portal.
 *
 * The portal signs somebody in once and sends them here with a single-use
 * token in the address. The login page has long understood `?sso=` on itself,
 * but the portal sends everybody to `/sso?token=` — every other system in the
 * estate answers there — so a launch into this one landed on nothing at all.
 *
 * There is nothing to click. Somebody who followed the link has already
 * decided to come, and a button would only be a second decision about the same
 * thing.
 */

const BLUE = "#0057b8";

function Redeem() {
  const router = useRouter();
  const params = useSearchParams();
  // `token` is what the portal sends; `sso` is what this application's own
  // login page has always accepted. Both are read so neither link breaks.
  const token = params.get("token") ?? params.get("sso");
  const [error, setError] = useState<string | null>(null);

  /*
   * Redeemed once, even under React's development double-mount.
   *
   * The token is single-use: a second attempt spends nothing and is refused,
   * which would replace a working sign-in with "invalid or expired" on the
   * screen of somebody who had in fact just signed in.
   */
  const tried = useRef(false);

  useEffect(() => {
    if (tried.current) return;
    tried.current = true;

    if (!token) {
      setError("This sign-in link has no token in it. Open Media ERP from the portal again.");
      return;
    }

    void (async () => {
      try {
        const res = await api.post("/auth/sso-login", { ssoToken: token });
        const { access_token, refresh_token } = res.data?.data ?? res.data ?? {};
        if (!access_token) {
          setError("That sign-in could not be completed. Open Media ERP from the portal again.");
          return;
        }
        localStorage.setItem("access_token", access_token);
        if (refresh_token) localStorage.setItem("refresh_token", refresh_token);
        // replace, not push: the address holds a spent token, and Back should
        // not return to a page that will now refuse.
        router.replace(redirectAfterLogin());
      } catch (err) {
        // The server's own words. It knows whether the token was spent, the
        // account is unknown here, or the portal could not be reached — and
        // each of those needs something different done about it.
        const message =
          (err as { response?: { data?: { message?: string; detail?: string } } })?.response?.data
            ?.message ??
          (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
          "That sign-in could not be completed. Open Media ERP from the portal again.";
        setError(message);
      }
    })();
  }, [token, router]);

  if (error) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <AlertCircle className="h-8 w-8 text-red-500" />
        <div>
          <p className="font-medium text-white">Could not sign you in</p>
          <p className="mt-1 max-w-sm" style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
            {error}
          </p>
        </div>
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm hover:underline"
          style={{ color: BLUE }}
        >
          Sign in with your email instead <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4 py-20">
      <div
        className="h-9 w-9 animate-spin rounded-full border-[3px] border-white/20"
        style={{ borderTopColor: BLUE }}
      />
      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)" }}>
        Signing you in via Root ERP…
      </p>
    </div>
  );
}

export default function SsoPage() {
  return (
    // useSearchParams needs a boundary, or the whole route opts out of static
    // rendering at build time.
    <Suspense
      fallback={
        <div className="flex flex-col items-center gap-4 py-20">
          <div
            className="h-9 w-9 animate-spin rounded-full border-[3px] border-white/20"
            style={{ borderTopColor: BLUE }}
          />
        </div>
      }
    >
      <Redeem />
    </Suspense>
  );
}

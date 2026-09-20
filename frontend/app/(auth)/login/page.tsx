"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { Eye, EyeOff, Loader2, ArrowRight, AlertCircle } from "lucide-react";
import { useLogin } from "@/hooks/useAuth";
import { useAuthStore } from "@/stores/authStore";
import api from "@/lib/axios";
import { redirectAfterLogin } from "@/lib/redirectTo";

const schema = z.object({
  email:    z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});
type FormData = z.infer<typeof schema>;

const BLUE = "#0057b8";

export default function LoginPage() {
  const login  = useLogin();
  const setAuth = useAuthStore((s) => s.setAuth);
  const router = useRouter();

  const [ssoLoading, setSsoLoading] = useState(false);
  const [ssoError,   setSsoError]   = useState<string | null>(null);
  const [showPwd,    setShowPwd]    = useState(false);
  const [focused,    setFocused]    = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("sso");
    if (!token) return;
    setSsoLoading(true);
    api.post("/auth/sso-login", { ssoToken: token })
      .then(res => {
        const { access_token, refresh_token, user } = res.data?.data ?? res.data ?? {};
        if (access_token) {
          /*
           * Through the store. Writing the tokens straight to localStorage
           * looked equivalent and was not: the store holds `isAuthenticated`,
           * the dashboard layout gates every page on it, and router.replace
           * is a client-side navigation — nothing reloads, so nothing
           * rehydrates the store. The tokens were there, the flag was false,
           * and the layout sent the person back here having just signed in.
           */
          setAuth(user, access_token, refresh_token);
          router.replace(redirectAfterLogin());
        } else {
          setSsoLoading(false);
          setSsoError("SSO login failed. Please sign in manually.");
        }
      })
      .catch(() => {
        setSsoLoading(false);
        setSsoError("SSO login failed. Please sign in manually.");
      });
  }, [router]);

  if (ssoLoading) {
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

  return (
    <motion.div
      className="delta-slide-up"
      style={{ width: "100%", maxWidth: 420 }}
    >
      {/* ── Delta white card ── */}
      <div
        className="delta-card"
        style={{ position: "relative", overflow: "hidden" }}
      >
        {/* Blue top accent line */}
        <div
          style={{
            position: "absolute",
            top: 0, left: 0, right: 0, height: 3,
            background: `linear-gradient(90deg, ${BLUE}, #00b4d8)`,
            borderRadius: "20px 20px 0 0",
          }}
        />

        {/* Top-right blue glow */}
        <div
          style={{
            position: "absolute", top: -60, right: -60,
            width: 180, height: 180, borderRadius: "50%",
            background: "radial-gradient(circle, rgba(0,87,184,0.06) 0%, transparent 70%)",
            pointerEvents: "none",
          }}
        />

        <div style={{ padding: "44px 38px 36px" }}>

          {/* Logo */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 28 }}>
            <Image
              src="/logo-dark.png"
              alt="Delta"
              width={130}
              height={58}
              priority
              unoptimized
              style={{ objectFit: "contain" }}
            />
          </div>

          {/* Heading */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08, duration: 0.4 }}
            style={{ marginBottom: 32 }}
          >
            <h1 style={{
              fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em",
              lineHeight: 1.1, color: "hsl(222 47% 11%)", marginBottom: 8,
            }}>
              Welcome back
            </h1>
            <p style={{ fontSize: 13, color: "hsl(215 16% 47%)", lineHeight: 1.65 }}>
              Enter your credentials to continue
            </p>
          </motion.div>

          {/* SSO error */}
          {ssoError && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                marginBottom: 20,
                display: "flex", alignItems: "flex-start", gap: 10,
                borderRadius: 12, padding: "11px 14px",
                fontSize: 12, lineHeight: 1.5,
                background: "rgba(239,68,68,0.07)",
                border: "1px solid rgba(239,68,68,0.2)",
                color: "#dc2626",
              }}
            >
              <AlertCircle style={{ width: 14, height: 14, marginTop: 1, flexShrink: 0 }} />
              {ssoError}
            </motion.div>
          )}

          <form onSubmit={handleSubmit(d => login.mutate(d))}>

            {/* ── Email ── */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.14, duration: 0.35 }}
              style={{ marginBottom: 18 }}
            >
              <label
                htmlFor="email"
                style={{
                  display: "block",
                  fontSize: 10, fontWeight: 700,
                  letterSpacing: "0.14em", textTransform: "uppercase",
                  marginBottom: 8,
                  color: focused === "email" ? BLUE : "hsl(215 16% 47%)",
                  transition: "color 0.2s ease",
                }}
              >
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                className={`delta-input${errors.email ? " error" : ""}`}
                onFocus={() => setFocused("email")}
                onBlur={() => setFocused(null)}
                {...register("email")}
              />
              {errors.email && (
                <p style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#dc2626" }}>
                  <AlertCircle style={{ width: 11, height: 11, flexShrink: 0 }} />
                  {errors.email.message}
                </p>
              )}
            </motion.div>

            {/* ── Password ── */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.20, duration: 0.35 }}
              style={{ marginBottom: 28 }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <label
                  htmlFor="password"
                  style={{
                    fontSize: 10, fontWeight: 700,
                    letterSpacing: "0.14em", textTransform: "uppercase",
                    color: focused === "password" ? BLUE : "hsl(215 16% 47%)",
                    transition: "color 0.2s ease",
                  }}
                >
                  Password
                </label>
                <Link
                  href="/forgot-password"
                  style={{ fontSize: 12, color: BLUE, fontWeight: 600, textDecoration: "none", opacity: 0.8 }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = "1")}
                  onMouseLeave={e => (e.currentTarget.style.opacity = "0.8")}
                >
                  Forgot password?
                </Link>
              </div>
              <div style={{ position: "relative" }}>
                <input
                  id="password"
                  type={showPwd ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className={`delta-input${errors.password ? " error" : ""}`}
                  style={{ paddingRight: 44 }}
                  onFocus={() => setFocused("password")}
                  onBlur={() => setFocused(null)}
                  {...register("password")}
                />
                <button
                  type="button"
                  onClick={() => setShowPwd(v => !v)}
                  aria-label={showPwd ? "Hide password" : "Show password"}
                  style={{
                    position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer", padding: 0,
                    color: "hsl(215 16% 60%)",
                    transition: "color 0.15s ease",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.color = BLUE)}
                  onMouseLeave={e => (e.currentTarget.style.color = "hsl(215 16% 60%)")}
                >
                  {showPwd ? <EyeOff style={{ width: 16, height: 16 }} /> : <Eye style={{ width: 16, height: 16 }} />}
                </button>
              </div>
              {errors.password && (
                <p style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "#dc2626" }}>
                  <AlertCircle style={{ width: 11, height: 11, flexShrink: 0 }} />
                  {errors.password.message}
                </p>
              )}
            </motion.div>

            {/* ── CTA Button ── */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.26, duration: 0.35 }}
            >
              <button
                type="submit"
                disabled={login.isPending}
                className="delta-btn group w-full flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{
                  height: 48,
                  background: BLUE,
                  color: "#fff",
                  border: "none",
                  cursor: login.isPending ? "not-allowed" : "pointer",
                  fontSize: 15,
                  fontWeight: 800,
                  width: "100%",
                }}
              >
                {login.isPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Signing in…
                  </>
                ) : (
                  <>
                    Sign in
                    <ArrowRight className="size-[15px] transition-transform duration-200 group-hover:translate-x-1" />
                  </>
                )}
              </button>
            </motion.div>
          </form>
        </div>
      </div>
    </motion.div>
  );
}

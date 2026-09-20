"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Glasses, LogOut } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import PWAInstallPrompt from "@/components/PWAInstallPrompt";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";
import { useNotificationSocket } from "@/hooks/useNotificationSocket";
import { useOnboardingStatus, useCompleteOnboarding, useStopImpersonation } from "@/hooks/useAuth";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user            = useAuthStore((s) => s.user);
  const originalAuth    = useAuthStore((s) => s.originalAuth);
  const router = useRouter();
  const pathname = usePathname();
  const [hydrated, setHydrated] = useState(false);

  // App-wide, so the bell reacts on every screen — the chat page's own socket
  // only exists while that page is open.
  useNotificationSocket(user?.id ?? null);

  const { data: onboardingData, isLoading: onboardingLoading } = useOnboardingStatus();
  const completeOnboarding = useCompleteOnboarding();
  const stopImpersonation  = useStopImpersonation();

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated && !isAuthenticated) {
      /*
       * Record where they were going, as `?from=`.
       *
       * proxy.ts used to do this when it turned somebody away, and
       * redirectAfterLogin reads it to land them back where they meant to be.
       * That gate is gone — it could not work inside the Root portal's frame —
       * so this check is now the only thing that turns anybody away, and it
       * has to carry the same information or people always land on the
       * dashboard no matter which page they asked for.
       */
      const from = pathname && pathname !== "/" ? `?from=${encodeURIComponent(pathname)}` : "";
      router.replace(`/login${from}`);
    }
  }, [hydrated, isAuthenticated, router, pathname]);

  if (!hydrated || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
          className="h-8 w-8 rounded-full border-2 border-primary border-t-transparent"
        />
      </div>
    );
  }

  // Show onboarding wizard for new users (once status is loaded and not complete)
  const showOnboarding = !onboardingLoading && onboardingData?.onboarding_complete === false;

  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Impersonation banner — full-width amber strip when active */}
      <AnimatePresence>
        {originalAuth && (
          <motion.div
            key="impersonation-banner"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden shrink-0 z-50"
          >
            <div className="flex items-center justify-between gap-4 bg-amber-500 px-4 py-2 text-sm font-medium text-white">
              <div className="flex items-center gap-2">
                <Glasses className="size-4 shrink-0" />
                <span>
                  Viewing as <strong>{user?.name}</strong>
                  {user?.role?.role_name && (
                    <span className="opacity-80 ml-1">({user.role.role_name})</span>
                  )}
                </span>
              </div>
              <button
                onClick={stopImpersonation}
                className="flex items-center gap-1.5 rounded-md bg-white/20 px-3 py-1 text-xs font-semibold hover:bg-white/30 transition-colors"
              >
                <LogOut className="size-3.5" />
                Exit Impersonation
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main layout */}
      <div className="flex flex-1 min-h-0">
        <Sidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          <Header />

          {/* Keyed mount animation only — no exit-wait, so client navigations
              always render the new page immediately (no "needs reload" bug). */}
          <motion.main
            key={pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="flex-1 overflow-y-auto p-6"
          >
            {children}
          </motion.main>
        </div>
      </div>

      {/* Onboarding wizard overlay */}
      <AnimatePresence>
        {showOnboarding && (
          <OnboardingWizard
            onComplete={() => completeOnboarding.mutate()}
          />
        )}
      </AnimatePresence>

      {/* Install-app prompt (PWA) */}
      <PWAInstallPrompt />
    </div>
  );
}

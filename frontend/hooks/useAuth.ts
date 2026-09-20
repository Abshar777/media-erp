"use client";

import { useRouter } from "next/navigation";
import { redirectAfterLogin } from "@/lib/redirectTo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import api from "@/lib/axios";
import { useAuthStore } from "@/stores/authStore";
import type { AuthResponse, User } from "@/types/user";

interface LoginPayload {
  email: string;
  password: string;
}

interface RegisterPayload {
  email: string;
  password: string;
  name: string;
}

export function useLogin() {
  const { setAuth } = useAuthStore();
  const router = useRouter();

  return useMutation({
    mutationFn: async (payload: LoginPayload) => {
      const { data } = await api.post<{ success: boolean; data: AuthResponse }>(
        "/auth/login",
        payload
      );
      return data.data;
    },
    onSuccess(data) {
      setAuth(data.user, data.access_token, data.refresh_token);
      toast.success("Welcome back!");
      // The route guard records where it turned you away from; go back there
      // rather than to the dashboard, which is not where you were headed.
      router.push(redirectAfterLogin());
    },
    onError() {
      toast.error("Invalid email or password");
    },
  });
}

export function useRegister() {
  const { setAuth } = useAuthStore();
  const router = useRouter();
  console.log('user is')

  return useMutation({
    mutationFn: async (payload: RegisterPayload) => {
      console.log('user is', payload)
      const { data } = await api.post<{ success: boolean; data: AuthResponse }>(
        "/auth/register",
        payload
      );
      return data.data;
    },
    onSuccess(data) {
      setAuth(data.user, data.access_token, data.refresh_token);
      toast.success("Account created!");
      router.push("/dashboard");
    },
    onError() {
      toast.error("Registration failed. Please try again.");
    },
  });
}

export function useLogout() {
  const { clearAuth } = useAuthStore();
  const router = useRouter();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      await api.post("/auth/logout");
    },
    onSettled() {
      clearAuth();
      queryClient.clear();
      router.push("/login");
    },
  });
}

export function useMe() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: User }>("/auth/me");
      return data.data;
    },
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  const { setAuth } = useAuthStore();

  return useMutation({
    mutationFn: async (payload: { name?: string; email?: string }) => {
      const { data } = await api.put<{ success: boolean; data: User }>("/auth/me", payload);
      return data.data;
    },
    onSuccess(user) {
      // Tokens live in localStorage (not Zustand state) — read them directly
      const token        = localStorage.getItem("access_token")  ?? "";
      const refreshToken = localStorage.getItem("refresh_token") ?? "";
      setAuth(user, token, refreshToken);          // ← updates persisted Zustand store
      qc.invalidateQueries({ queryKey: ["me"] });
      toast.success("Profile updated!");
    },
    onError(err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? "Failed to update profile.");
    },
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: async (payload: { email: string }) => {
      const { data } = await api.post<{ success: boolean; data: { message: string } }>(
        "/auth/forgot-password",
        payload
      );
      return data.data;
    },
    onSuccess() {
      toast.success("Reset code sent! Check your inbox (and spam folder).", { duration: 5000 });
    },
    onError(err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? "Could not send the reset code. Please try again.");
    },
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: async (payload: { email: string; otp: string; new_password: string }) => {
      const { data } = await api.post<{ success: boolean; message: string }>(
        "/auth/reset-password",
        payload
      );
      return data;
    },
    onSuccess() {
      toast.success("Password reset successfully!");
    },
    onError(err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? "Invalid or expired code. Please try again.");
    },
  });
}

export function useUpdatePassword() {
  return useMutation({
    mutationFn: async (payload: { current_password: string; new_password: string }) => {
      const { data } = await api.put<{ success: boolean; message: string }>("/auth/password", payload);
      return data;
    },
    onSuccess() {
      toast.success("Password changed. Please log in again.");
    },
    onError(err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? "Failed to change password.");
    },
  });
}

// ── 2FA hooks ─────────────────────────────────────────────────────────────────

export function use2faStatus() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ["2fa-status"],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: { two_fa_enabled: boolean } }>("/auth/2fa/status");
      return data.data;
    },
    enabled: isAuthenticated,
  });
}

export function use2faSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ success: boolean; data: { secret: string; uri: string } }>("/auth/2fa/setup");
      return data.data;
    },
    onSuccess() {
      qc.invalidateQueries({ queryKey: ["2fa-status"] });
    },
  });
}

export function use2faEnable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      const { data } = await api.post<{ success: boolean; data: { two_fa_enabled: boolean } }>("/auth/2fa/enable", { code });
      return data.data;
    },
    onSuccess() {
      toast.success("Two-factor authentication enabled!");
      qc.invalidateQueries({ queryKey: ["2fa-status"] });
    },
    onError(err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? "Invalid code. Please try again.");
    },
  });
}

export function use2faDisable() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      const { data } = await api.post<{ success: boolean; data: { two_fa_enabled: boolean } }>("/auth/2fa/disable", { code });
      return data.data;
    },
    onSuccess() {
      toast.success("Two-factor authentication disabled.");
      qc.invalidateQueries({ queryKey: ["2fa-status"] });
    },
    onError(err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? "Invalid code. Please try again.");
    },
  });
}

// ── Onboarding hook ───────────────────────────────────────────────────────────

export function useOnboardingStatus() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return useQuery({
    queryKey: ["onboarding-status"],
    queryFn: async () => {
      const { data } = await api.get<{ success: boolean; data: { onboarding_complete: boolean } }>("/auth/onboarding/status");
      return data.data;
    },
    enabled: isAuthenticated,
    staleTime: Infinity, // once loaded, don't refetch unless invalidated
  });
}

export function useCompleteOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post<{ success: boolean }>("/auth/onboarding/complete");
      return data;
    },
    onSuccess() {
      qc.invalidateQueries({ queryKey: ["onboarding-status"] });
    },
  });
}

// ── Impersonation hooks ───────────────────────────────────────────────────────

export function useImpersonate() {
  const startImpersonation = useAuthStore((s) => s.startImpersonation);
  const router = useRouter();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const { data } = await api.post<{ success: boolean; data: AuthResponse }>(
        `/auth/impersonate/${userId}`
      );
      return data.data;
    },
    onSuccess(data) {
      startImpersonation(data.user, data.access_token, data.refresh_token);
      qc.clear();
      router.push("/dashboard");
      toast.success(`Now viewing as ${data.user.name}`);
    },
    onError(err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? "Failed to impersonate user.");
    },
  });
}

export function useStopImpersonation() {
  const stopImpersonation = useAuthStore((s) => s.stopImpersonation);
  const router = useRouter();
  const qc = useQueryClient();

  return () => {
    stopImpersonation();
    qc.clear();
    toast.success("Returned to your account");
    router.push("/users");
  };
}

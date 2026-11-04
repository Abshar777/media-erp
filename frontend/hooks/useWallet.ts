"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/axios";
import { useAuthStore } from "@/stores/authStore";
import type { Wallet } from "@/types/wallet";

/*
 * My Wallet (2026-11-04): your month from the HRMS — salary a day at a time, what came off and why, commission, what
 * finance has paid. The server asks the HRMS as whoever is signed in — while impersonating, that person (2026-11-04:
 * "show it when impersonating also"). Keyed by who that is: impersonation here switches people without a reload.
 */
export const useWallet = (month: string, opts: { enabled?: boolean } = {}) => {
  const who = useAuthStore((s) => s.user?.email ?? "");
  return useQuery({
    queryKey: ["wallet", who, month],
    queryFn: async () => (await api.get<{ success: boolean; message: string; data: Wallet }>("/wallet", { params: { month } })).data.data,
    // Finance is asked behind it on every load; a minute keeps flicking between months cheap.
    staleTime: 60_000,
    retry: false,
    enabled: opts.enabled ?? true,
  });
};

/** This month where the company keeps its books (the HRMS's months are Dubai's). */
export const walletThisMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date()).slice(0, 7);

"use client";

import { useQuery } from "@tanstack/react-query";
import api from "@/lib/axios";
import { useAuthStore } from "@/stores/authStore";
import type { Wallet } from "@/types/wallet";

/*
 * My Wallet (2026-11-04): your month from the HRMS — salary a day at a time, what came off and why, commission, what
 * finance has paid. The server asks the HRMS as whoever is signed in; never somebody else's.
 */
export const useWallet = (month: string, opts: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: ["wallet", month],
    queryFn: async () => (await api.get<{ success: boolean; message: string; data: Wallet }>("/wallet", { params: { month } })).data.data,
    // Finance is asked behind it on every load; a minute keeps flicking between months cheap.
    staleTime: 60_000,
    retry: false,
    enabled: opts.enabled ?? true,
  });

/** This month where the company keeps its books (the HRMS's months are Dubai's). */
export const walletThisMonth = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date()).slice(0, 7);

/**
 * Viewing Media ERP as somebody else (a Super Admin's impersonation). Their token is the other person's own, so the
 * server can't tell — the wallet is simply not asked for then: their pay is not the viewer's to read.
 */
export const useViewingAsSomeoneElse = () => useAuthStore((s) => !!s.originalAuth);

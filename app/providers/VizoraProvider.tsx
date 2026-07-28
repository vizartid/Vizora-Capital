"use client";

import type { Business, Membership } from "../lib/finance/types";
import { insforge } from "../lib/insforge/client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

type AuthUser = { id: string; email?: string; profile?: Record<string, unknown> };

interface VizoraContextValue {
  user: AuthUser | null;
  membership: Membership | null;
  business: Business | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const VizoraContext = createContext<VizoraContextValue | null>(null);

async function withTimeout<T>(promise: PromiseLike<T>, label: string, milliseconds = 12_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} terlalu lama. Silakan coba lagi.`)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function VizoraProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    let currentUser: AuthUser | null = null;
    try {
      const sessionResponse = await withTimeout(
        fetch("/api/auth/me", {
          credentials: "same-origin",
          cache: "no-store",
          headers: { Accept: "application/json" },
        }),
        "Pemeriksaan sesi",
      );
      const session = await sessionResponse.json().catch(() => ({ user: null, message: "Respons sesi tidak valid" })) as {
        user: AuthUser | null;
        message?: string;
      };
      if (!sessionResponse.ok) throw new Error(session.message ?? "Tidak dapat memeriksa sesi");

      currentUser = session.user;
      if (!currentUser) {
        setUser(null); setMembership(null); setBusiness(null);
        return;
      }

      setUser(currentUser);
      const memberResult = await withTimeout(
        insforge.database.from("business_members")
          .select("id, business_id, user_id, email, display_name, role, status")
          .eq("user_id", currentUser.id)
          .eq("status", "active")
          .order("joined_at")
          .limit(1)
          .maybeSingle(),
        "Pemuatan ruang kerja",
      );
      if (memberResult.error) throw new Error(memberResult.error.message);

      const member = memberResult.data as Membership | null;
      setMembership(member);
      if (!member) { setBusiness(null); return; }

      const businessResult = await withTimeout(
        insforge.database.from("businesses").select("*").eq("id", member.business_id).single(),
        "Pemuatan profil bisnis",
      );
      if (businessResult.error) throw new Error(businessResult.error.message);
      setBusiness((businessResult.data as Business | null) ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Tidak dapat memuat sesi Anda");
      if (!currentUser) setUser(null);
      setMembership(null);
      setBusiness(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timer); }, [refresh]);
  const value = useMemo(() => ({ user, membership, business, loading, error, refresh }), [user, membership, business, loading, error, refresh]);
  return <VizoraContext.Provider value={value}>{children}</VizoraContext.Provider>;
}

export function useVizora() {
  const value = useContext(VizoraContext);
  if (!value) throw new Error("useVizora must be used inside VizoraProvider");
  return value;
}

import {
  DEFAULT_ACCESS_TOKEN_COOKIE,
  DEFAULT_REFRESH_TOKEN_COOKIE,
} from "@insforge/sdk/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createInsForgeServerClient } from "../lib/insforge/server";

export const dynamic = "force-dynamic";

type ActiveMembership = {
  business_id: string;
};

export default async function PaidDashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const hasSession = Boolean(
    cookieStore.get(DEFAULT_ACCESS_TOKEN_COOKIE)?.value
    || cookieStore.get(DEFAULT_REFRESH_TOKEN_COOKIE)?.value,
  );

  if (!hasSession) redirect("/login");

  const insforge = await createInsForgeServerClient();
  const userResult = await insforge.auth.getCurrentUser();
  const user = userResult.data?.user;

  if (userResult.error || !user?.id) redirect("/login");

  const membershipResult = await insforge.database.from("business_members")
    .select("business_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("joined_at")
    .limit(1)
    .maybeSingle();

  if (membershipResult.error) {
    throw new Error("Tidak dapat memeriksa akses ruang kerja");
  }

  const membership = membershipResult.data as ActiveMembership | null;
  if (!membership) redirect("/onboarding");

  const now = new Date().toISOString();
  const subscriptionResult = await insforge.database.from("business_subscriptions")
    .select("id")
    .eq("business_id", membership.business_id)
    .eq("status", "active")
    .lte("current_period_start", now)
    .gt("current_period_end", now)
    .maybeSingle();

  if (subscriptionResult.error) {
    throw new Error("Tidak dapat memeriksa status paket");
  }

  if (!subscriptionResult.data) redirect("/pricing?payment=required");

  return children;
}

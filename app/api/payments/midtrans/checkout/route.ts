import { createInsForgeAdminClient } from "../../../../lib/insforge/admin";
import { createInsForgeServerClient } from "../../../../lib/insforge/server";
import { createSnapTransaction } from "../../../../lib/payments/midtrans";
import { getPaymentPlan, isBillingCycle } from "../../../../lib/payments/plans";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type CheckoutBody = {
  billingCycle?: unknown;
  businessId?: unknown;
  checkoutAttemptId?: unknown;
  planId?: unknown;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function appOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  try {
    return new URL(configured || request.url).origin;
  } catch {
    return new URL(request.url).origin;
  }
}

export async function POST(request: Request) {
  let body: CheckoutBody;
  try {
    body = await request.json() as CheckoutBody;
  } catch {
    return jsonError("Permintaan checkout tidak valid", 400);
  }

  const plan = getPaymentPlan(body.planId);
  if (!plan || !isBillingCycle(body.billingCycle) || !isUuid(body.businessId) || !isUuid(body.checkoutAttemptId)) {
    return jsonError("Paket, periode, atau ruang kerja tidak valid", 400);
  }

  const insforge = await createInsForgeServerClient();
  const userResult = await insforge.auth.getCurrentUser();
  const user = userResult.data?.user;
  if (userResult.error || !user?.id) return jsonError("Silakan masuk sebelum memilih paket", 401);

  const membershipResult = await insforge.database.from("business_members")
    .select("business_id, role, status")
    .eq("business_id", body.businessId)
    .eq("user_id", user.id)
    .maybeSingle();
  const membership = membershipResult.data as { business_id: string; role: string; status: string } | null;
  if (membershipResult.error || !membership || membership.status !== "active") {
    return jsonError("Anda tidak memiliki akses ke ruang kerja ini", 403);
  }
  if (membership.role !== "administrator") {
    return jsonError("Hanya administrator yang dapat mengubah paket", 403);
  }

  let admin;
  try {
    admin = createInsForgeAdminClient();
  } catch {
    return jsonError("Konfigurasi pembayaran server belum lengkap", 503);
  }

  const existingResult = await admin.database.from("payment_orders")
    .select("midtrans_order_id, redirect_url, status")
    .eq("business_id", body.businessId)
    .eq("checkout_attempt_id", body.checkoutAttemptId)
    .maybeSingle();
  if (existingResult.error) return jsonError("Tidak dapat memeriksa checkout", 500);
  if (existingResult.data?.redirect_url) {
    return NextResponse.json(
      { orderId: existingResult.data.midtrans_order_id, redirectUrl: existingResult.data.redirect_url },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  if (existingResult.data) return jsonError("Checkout ini sedang diproses. Silakan tunggu sebentar.", 409);

  const paymentId = crypto.randomUUID();
  const orderId = `Vizora-${paymentId.replaceAll("-", "")}`;
  const amount = plan.prices[body.billingCycle];
  const inserted = await admin.database.from("payment_orders").insert([{
    id: paymentId,
    business_id: body.businessId,
    initiated_by: user.id,
    checkout_attempt_id: body.checkoutAttemptId,
    midtrans_order_id: orderId,
    plan_id: plan.id,
    billing_cycle: body.billingCycle,
    amount,
    currency: "IDR",
    status: "creating",
  }]).select("id").single();
  if (inserted.error) return jsonError("Tidak dapat membuat catatan pembayaran", 500);

  const finishUrl = new URL("/pricing", appOrigin(request));
  finishUrl.searchParams.set("payment", "finish");
  finishUrl.searchParams.set("order_id", orderId);

  try {
    const transaction = await createSnapTransaction({
      transaction_details: { order_id: orderId, gross_amount: amount },
      item_details: [{
        id: `${plan.id}-${body.billingCycle}`,
        price: amount,
        quantity: 1,
        name: `Vizora ${plan.name} (${body.billingCycle === "yearly" ? "Tahunan" : "Bulanan"})`,
      }],
      customer_details: {
        first_name: String(user.profile?.name ?? user.email?.split("@")[0] ?? "Pelanggan Vizora").slice(0, 255),
        email: user.email,
      },
      credit_card: { secure: true },
      callbacks: { finish: finishUrl.toString() },
      page_expiry: { duration: 1, unit: "day" },
    });

    const updated = await admin.database.from("payment_orders").update({
      status: "pending",
      snap_token: transaction.token,
      redirect_url: transaction.redirectUrl,
      create_error: null,
    }).eq("id", paymentId);
    if (updated.error) throw new Error(updated.error.message);

    return NextResponse.json(
      { orderId, redirectUrl: transaction.redirectUrl },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message.slice(0, 1000) : "Midtrans checkout failed";
    await admin.database.from("payment_orders").update({ status: "failed", create_error: message }).eq("id", paymentId);
    return jsonError("Midtrans tidak dapat memulai pembayaran. Silakan coba lagi.", 502);
  }
}

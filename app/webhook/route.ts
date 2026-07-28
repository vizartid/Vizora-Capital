import { createInsForgeAdminClient } from "../lib/insforge/admin";
import {
  getMidtransTransactionStatus,
  mapMidtransStatus,
  parseMidtransNotification,
  preserveFinalPaymentState,
  verifyMidtransNotification,
  type DurablePaymentStatus,
} from "../lib/payments/midtrans";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type PaymentOrder = {
  id: string;
  business_id: string;
  initiated_by: string;
  midtrans_order_id: string;
  plan_id: "starter" | "growth" | "scale";
  billing_cycle: "monthly" | "yearly";
  amount: number | string;
  status: DurablePaymentStatus;
  paid_at: string | null;
  fulfilled_at: string | null;
};

type CurrentSubscription = {
  plan_id: string;
  billing_cycle: string;
  status: string;
  current_period_start: string;
  current_period_end: string;
  latest_payment_order_id: string | null;
};

function periodEnd(start: Date, cycle: PaymentOrder["billing_cycle"]) {
  const end = new Date(start);
  if (cycle === "yearly") end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return end;
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 100_000) return NextResponse.json({ error: "Payload too large" }, { status: 413 });

  let rawNotification: unknown;
  try {
    rawNotification = JSON.parse(await request.text());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const notification = parseMidtransNotification(rawNotification);
  if (!notification || !(await verifyMidtransNotification(notification))) {
    return NextResponse.json({ error: "Invalid notification signature" }, { status: 401 });
  }

  let status;
  try {
    status = await getMidtransTransactionStatus(notification.order_id);
  } catch {
    return NextResponse.json({ error: "Could not verify transaction status" }, { status: 502 });
  }
  if (status.order_id !== notification.order_id) {
    return NextResponse.json({ error: "Transaction identity mismatch" }, { status: 400 });
  }

  let admin;
  try {
    admin = createInsForgeAdminClient();
  } catch {
    return NextResponse.json({ error: "Payment persistence is not configured" }, { status: 503 });
  }

  const paymentResult = await admin.database.from("payment_orders")
    .select("id, business_id, initiated_by, midtrans_order_id, plan_id, billing_cycle, amount, status, paid_at, fulfilled_at")
    .eq("midtrans_order_id", status.order_id)
    .maybeSingle();
  const payment = paymentResult.data as PaymentOrder | null;
  if (paymentResult.error || !payment) return NextResponse.json({ error: "Payment order not found" }, { status: 404 });

  const providerAmount = Number(status.gross_amount);
  if (!Number.isFinite(providerAmount) || providerAmount !== Number(payment.amount)) {
    return NextResponse.json({ error: "Payment amount mismatch" }, { status: 400 });
  }

  const mappedStatus = mapMidtransStatus(status);
  const durableStatus = preserveFinalPaymentState(payment.status, mappedStatus);
  const paidAt = durableStatus === "paid" ? new Date(payment.paid_at ?? Date.now()) : null;
  const updateResult = await admin.database.from("payment_orders").update({
    status: durableStatus,
    midtrans_transaction_id: status.transaction_id ?? null,
    transaction_status: status.transaction_status,
    fraud_status: status.fraud_status ?? null,
    status_code: status.status_code,
    payment_type: status.payment_type ?? null,
    paid_at: payment.paid_at ? undefined : paidAt?.toISOString(),
    notification_received_at: new Date().toISOString(),
    raw_notification: status,
  }).eq("id", payment.id);
  if (updateResult.error) return NextResponse.json({ error: "Could not persist payment" }, { status: 500 });

  if (durableStatus === "paid" && !payment.fulfilled_at) {
    const currentResult = await admin.database.from("business_subscriptions")
      .select("plan_id, billing_cycle, status, current_period_start, current_period_end, latest_payment_order_id")
      .eq("business_id", payment.business_id)
      .maybeSingle();
    if (currentResult.error) return NextResponse.json({ error: "Could not inspect subscription" }, { status: 500 });
    const current = currentResult.data as CurrentSubscription | null;

    if (current?.latest_payment_order_id !== payment.id) {
      const now = paidAt ?? new Date();
      const currentEnd = current?.current_period_end ? new Date(current.current_period_end) : null;
      const isRenewal = current?.status === "active"
        && current.plan_id === payment.plan_id
        && current.billing_cycle === payment.billing_cycle
        && currentEnd !== null
        && currentEnd > now;
      const periodStart = isRenewal && current ? new Date(current.current_period_start) : now;
      const periodEndBase = isRenewal && currentEnd ? currentEnd : now;
      const subscriptionResult = await admin.database.from("business_subscriptions").upsert([{
        business_id: payment.business_id,
        plan_id: payment.plan_id,
        billing_cycle: payment.billing_cycle,
        status: "active",
        provider: "midtrans",
        current_period_start: periodStart.toISOString(),
        current_period_end: periodEnd(periodEndBase, payment.billing_cycle).toISOString(),
        latest_payment_order_id: payment.id,
      }], { onConflict: "business_id" });
      if (subscriptionResult.error) {
        return NextResponse.json({ error: "Could not activate subscription" }, { status: 500 });
      }
    }

    const fulfilled = await admin.database.from("payment_orders")
      .update({ fulfilled_at: new Date().toISOString() })
      .eq("id", payment.id)
      .is("fulfilled_at", null);
    if (fulfilled.error) return NextResponse.json({ error: "Could not finalize fulfillment" }, { status: 500 });
  }

  if (durableStatus === "refunded") {
    const cancelled = await admin.database.from("business_subscriptions")
      .update({ status: "cancelled" })
      .eq("business_id", payment.business_id)
      .eq("latest_payment_order_id", payment.id);
    if (cancelled.error) return NextResponse.json({ error: "Could not revoke refunded subscription" }, { status: 500 });
  }

  if (payment.status !== durableStatus) {
    await admin.database.from("audit_logs").insert([{
      business_id: payment.business_id,
      actor_type: "system",
      actor_user_id: null,
      action: durableStatus === "paid" ? "payment_confirmed" : "payment_status_changed",
      entity_type: "payment_orders",
      entity_id: payment.id,
      summary: durableStatus === "paid" ? "Midtrans payment confirmed and plan activated" : `Midtrans payment changed to ${durableStatus}`,
      metadata: {
        midtrans_order_id: payment.midtrans_order_id,
        plan_id: payment.plan_id,
        billing_cycle: payment.billing_cycle,
        transaction_status: status.transaction_status,
      },
    }]);
  }

  return NextResponse.json({ ok: true, status: durableStatus });
}

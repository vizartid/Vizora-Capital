import { createInsForgeServerClient } from "../../../../lib/insforge/server";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const orderId = new URL(request.url).searchParams.get("orderId");
  if (!orderId || !/^Vizora-[0-9a-f]{32}$/i.test(orderId)) {
    return NextResponse.json({ error: "Order pembayaran tidak valid" }, { status: 400 });
  }

  const insforge = await createInsForgeServerClient();
  const userResult = await insforge.auth.getCurrentUser();
  if (userResult.error || !userResult.data?.user?.id) {
    return NextResponse.json({ error: "Silakan masuk untuk melihat pembayaran" }, { status: 401 });
  }

  const paymentResult = await insforge.database.from("payment_orders")
    .select("midtrans_order_id, plan_id, billing_cycle, amount, currency, status, paid_at, created_at")
    .eq("midtrans_order_id", orderId)
    .maybeSingle();
  if (paymentResult.error) {
    return NextResponse.json({ error: paymentResult.error.message }, { status: 500 });
  }
  if (!paymentResult.data) {
    return NextResponse.json({ error: "Pembayaran tidak ditemukan" }, { status: 404 });
  }

  return NextResponse.json(
    { payment: paymentResult.data },
    { headers: { "Cache-Control": "no-store" } },
  );
}

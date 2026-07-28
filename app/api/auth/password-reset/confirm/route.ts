import { createServerClient } from "@insforge/sdk/ssr";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const email = String(body.email ?? "").trim().toLowerCase();
  const code = String(body.code ?? "").trim();
  const password = String(body.password ?? "");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Masukkan alamat email yang valid" }, { status: 400 });
  }
  if (!/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Kode pemulihan harus terdiri dari 6 digit" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Kata sandi baru minimal 8 karakter" }, { status: 400 });
  }

  const insforge = createServerClient();
  const exchange = await insforge.auth.exchangeResetPasswordToken({ email, code });
  if (exchange.error || !exchange.data?.token) {
    return NextResponse.json({ error: exchange.error?.message ?? "Kode pemulihan tidak valid atau kedaluwarsa" }, { status: exchange.error?.statusCode ?? 400 });
  }

  const reset = await insforge.auth.resetPassword({ newPassword: password, otp: exchange.data.token });
  if (reset.error) {
    return NextResponse.json({ error: reset.error.message }, { status: reset.error.statusCode ?? 400 });
  }

  const response = NextResponse.json({ ok: true });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

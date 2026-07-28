import { createServerClient } from "@insforge/sdk/ssr";
import { NextRequest, NextResponse } from "next/server";

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!isEmail(email)) return NextResponse.json({ error: "Masukkan alamat email yang valid" }, { status: 400 });

  const insforge = createServerClient();
  const result = await insforge.auth.sendResetPasswordEmail({ email });
  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: result.error.statusCode ?? 400 });
  }

  const response = NextResponse.json({ ok: true });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

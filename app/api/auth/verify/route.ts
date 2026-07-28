import { createAuthActions, DEFAULT_ACCESS_TOKEN_COOKIE, DEFAULT_REFRESH_TOKEN_COOKIE } from "@insforge/sdk/ssr";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const auth = createAuthActions({ requestCookies: request.cookies, responseCookies: response.cookies });
  const body = await request.json() as Record<string, unknown>;
  const result = await auth.verifyEmail({ email: String(body.email ?? ""), otp: String(body.otp ?? "") });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: result.error.statusCode ?? 400 });
  if (!response.cookies.get(DEFAULT_ACCESS_TOKEN_COOKIE) || !response.cookies.get(DEFAULT_REFRESH_TOKEN_COOKIE)) {
    return NextResponse.json({ error: "Email terverifikasi, tetapi sesi belum terbentuk. Silakan masuk dengan kata sandi Anda." }, { status: 502 });
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}

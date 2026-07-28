import { createAuthActions, DEFAULT_ACCESS_TOKEN_COOKIE, DEFAULT_REFRESH_TOKEN_COOKIE } from "@insforge/sdk/ssr";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const auth = createAuthActions({ requestCookies: request.cookies, responseCookies: response.cookies });
  const body = await request.json() as Record<string, unknown>;
  const result = await auth.signInWithPassword({
    email: String(body.email ?? "").trim().toLowerCase(),
    password: String(body.password ?? ""),
  });
  if (result.error || !result.data?.user) {
    return NextResponse.json({ error: result.error?.message ?? "Email atau kata sandi salah" }, { status: result.error?.statusCode ?? 401 });
  }
  if (!response.cookies.get(DEFAULT_ACCESS_TOKEN_COOKIE) || !response.cookies.get(DEFAULT_REFRESH_TOKEN_COOKIE)) {
    return NextResponse.json({ error: "Sesi masuk tidak lengkap. Silakan coba lagi." }, { status: 502 });
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}

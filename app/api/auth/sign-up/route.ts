import { createAuthActions } from "@insforge/sdk/ssr";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  const auth = createAuthActions({ requestCookies: request.cookies, responseCookies: response.cookies });
  const body = await request.json() as Record<string, unknown>;
  const result = await auth.signUp({
    email: String(body.email ?? ""),
    password: String(body.password ?? ""),
    name: String(body.name ?? ""),
    redirectTo: new URL("/login", request.url).toString(),
  });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: result.error.statusCode ?? 400 });
  return NextResponse.json({
    ok: true,
    requireEmailVerification: Boolean(result.data?.requireEmailVerification),
    verifyEmailMethod: "code",
    email: body.email,
  }, { headers: response.headers });
}

import { createAuthActions } from "@insforge/sdk/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const provider = request.nextUrl.searchParams.get("provider") ?? "google";
  if (!['google', 'github'].includes(provider)) return NextResponse.json({ error: "Unsupported provider" }, { status: 400 });
  const cookieStore = await cookies();
  const auth = createAuthActions({ cookies: cookieStore });
  const result = await auth.signInWithOAuth(provider, {
    redirectTo: new URL("/api/auth/callback", request.url).toString(),
    skipBrowserRedirect: true,
  });
  if (result.error || !result.data.url || !result.data.codeVerifier) return NextResponse.redirect(new URL("/login?error=oauth_failed", request.url));
  cookieStore.set("insforge_code_verifier", result.data.codeVerifier, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  return NextResponse.redirect(result.data.url);
}

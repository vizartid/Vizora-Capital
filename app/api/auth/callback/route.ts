import { createAuthActions } from "@insforge/sdk/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("insforge_code");
  const cookieStore = await cookies();
  const verifier = cookieStore.get("insforge_code_verifier")?.value;
  if (!code || !verifier) return NextResponse.redirect(new URL("/login?error=oauth_failed", request.url));
  const response = NextResponse.redirect(new URL("/", request.url));
  const auth = createAuthActions({ requestCookies: request.cookies, responseCookies: response.cookies });
  const result = await auth.exchangeOAuthCode(code, verifier);
  if (result.error) return NextResponse.redirect(new URL("/login?error=oauth_failed", request.url));
  response.cookies.delete("insforge_code_verifier");
  return response;
}

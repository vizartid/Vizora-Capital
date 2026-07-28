import { DEFAULT_REFRESH_TOKEN_COOKIE, refreshAuth } from "@insforge/sdk/ssr";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  // A missing refresh cookie means the visitor is anonymous. Returning 204
  // lets createBrowserClient settle to a signed-out state without surfacing an
  // expected AUTH_UNAUTHORIZED response on login and signup pages.
  if (!request.cookies.get(DEFAULT_REFRESH_TOKEN_COOKIE)?.value) {
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const result = await refreshAuth({ request });
  result.response.headers.set("Cache-Control", "no-store");
  return result.response;
}

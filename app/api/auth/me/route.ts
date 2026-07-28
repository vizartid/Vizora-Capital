import { createServerClient } from "@insforge/sdk/ssr";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const insforge = createServerClient({ cookies: request.cookies });
  const result = await insforge.auth.getCurrentUser();

  if (result.error) {
    return NextResponse.json(
      {
        error: result.error.error,
        message: result.error.message,
      },
      {
        status: result.error.statusCode ?? 401,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  return NextResponse.json(
    { user: result.data?.user ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

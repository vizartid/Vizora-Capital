import {
  updateSession,
  type CookieOptions,
  type CookieStore,
} from "@insforge/sdk/ssr/middleware";
import { NextRequest, NextResponse } from "next/server";

function requestCookieStore(request: NextRequest): CookieStore {
  function set(name: string, value: string, options?: CookieOptions): unknown;
  function set(options: { name: string; value: string } & CookieOptions): unknown;
  function set(
    nameOrOptions: string | ({ name: string; value: string } & CookieOptions),
    value?: string,
  ) {
    if (typeof nameOrOptions === "string") {
      return request.cookies.set(nameOrOptions, value ?? "");
    }
    return request.cookies.set({
      name: nameOrOptions.name,
      value: nameOrOptions.value,
    });
  }

  function remove(name: string): unknown;
  function remove(options: { name: string } & CookieOptions): unknown;
  function remove(nameOrOptions: string | ({ name: string } & CookieOptions)) {
    return request.cookies.delete(
      typeof nameOrOptions === "string" ? nameOrOptions : nameOrOptions.name,
    );
  }

  return {
    get: (name) => request.cookies.get(name),
    set,
    delete: remove,
  };
}

export async function proxy(request: NextRequest) {
  // Auth handlers own their cookie lifecycle. Running updateSession() in front
  // of them can rotate a refresh token before /api/auth/refresh consumes it.
  if (
    request.nextUrl.pathname.startsWith("/api/auth/")
    || request.nextUrl.pathname === "/webhook"
  ) {
    return NextResponse.next({ request });
  }

  const response = NextResponse.next({ request });
  await updateSession({
    requestCookies: requestCookieStore(request),
    responseCookies: response.cookies,
  });
  return response;
}

export const config = { matcher: ["/((?!api/auth|_next/static|_next/image|favicon.svg|og.png).*)"] };

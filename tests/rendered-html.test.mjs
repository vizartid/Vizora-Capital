import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(new URL(pathname, "http://localhost"), {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("redirects unauthenticated dashboard requests before rendering paid features", async () => {
  const response = await render();
  assert.match(String(response.status), /^30[2378]$/);
  assert.equal(new URL(response.headers.get("location"), "http://localhost").pathname, "/login");
});

test("keeps authentication, onboarding, and checkout pages public", async () => {
  for (const pathname of ["/login", "/signup", "/onboarding", "/pricing"]) {
    const response = await render(pathname);
    assert.equal(response.status, 200, `${pathname} should remain accessible`);
  }
});

test("ships tenant isolation and human approval controls with the app", async () => {
  const [workflow, storage, financeApi, provider, insforgeClient] = await Promise.all([
    readFile(new URL("../migrations/20260720073131_Vizora-workflows.sql", import.meta.url), "utf8"),
    readFile(new URL("../migrations/20260720073133_Vizora-realtime-storage.sql", import.meta.url), "utf8"),
    readFile(new URL("../functions/finance-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/providers/VizoraProvider.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/insforge/client.ts", import.meta.url), "utf8"),
  ]);

  assert.match(workflow, /ENABLE ROW LEVEL SECURITY/);
  assert.match(workflow, /CREATE OR REPLACE FUNCTION public\.approve_ai_action/);
  assert.match(workflow, /CREATE OR REPLACE FUNCTION public\.approve_invoice/);
  assert.match(storage, /business-assets/);
  assert.match(storage, /realtime\.publish/);
  assert.match(financeApi, /action === "process_reminders"/);
  assert.match(financeApi, /response_format/);
  assert.match(financeApi, /google\/gemini-3\.1-flash-lite/);
  assert.match(financeApi, /\.limit\(chatHistoryLimit\)/);
  assert.match(financeApi, /parseVizoraResponse\(raw\)/);
  assert.match(provider, /business_members/);
  assert.match(insforgeClient, /NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL/);
  assert.match(insforgeClient, /\.function2\.insforge\.app/);
});

test("requires a complete auth session before navigating after sign in", async () => {
  const [signInRoute, verifyRoute, refreshRoute, currentUserRoute, proxy, entryViews, provider] = await Promise.all([
    readFile(new URL("../app/api/auth/sign-in/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/verify/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/refresh/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/me/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/EntryViews.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/providers/VizoraProvider.tsx", import.meta.url), "utf8"),
  ]);

  for (const route of [signInRoute, verifyRoute]) {
    assert.match(route, /DEFAULT_ACCESS_TOKEN_COOKIE/);
    assert.match(route, /DEFAULT_REFRESH_TOKEN_COOKIE/);
    assert.match(route, /Cache-Control", "no-store"/);
  }

  assert.match(entryViews, /window\.location\.assign\("\/"\)/);
  assert.match(entryViews, /window\.location\.assign\("\/onboarding"\)/);
  assert.match(refreshRoute, /DEFAULT_REFRESH_TOKEN_COOKIE/);
  assert.match(refreshRoute, /status: 204/);
  assert.match(proxy, /startsWith\("\/api\/auth\/"\)/);
  assert.match(proxy, /\(\?!api\/auth\|/);
  assert.match(currentUserRoute, /createServerClient/);
  assert.match(provider, /fetch\("\/api\/auth\/me"/);
  assert.doesNotMatch(provider, /insforge\.auth\.getCurrentUser/);
});

test("ships a server-mediated password recovery flow", async () => {
  const [requestRoute, confirmRoute, entryViews] = await Promise.all([
    readFile(new URL("../app/api/auth/password-reset/request/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/auth/password-reset/confirm/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/components/EntryViews.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(requestRoute, /sendResetPasswordEmail/);
  assert.match(confirmRoute, /exchangeResetPasswordToken/);
  assert.match(confirmRoute, /resetPassword/);
  assert.doesNotMatch(confirmRoute, /NextResponse\.json\(\{\s*token/);
  assert.match(entryViews, /href="\/forgot-password"/);
  assert.match(entryViews, /window\.location\.replace\("\/"\)/);
});

test("ships authenticated and webhook-verified Midtrans billing", async () => {
  const [checkout, webhook, status, midtrans, migration, pricing, paidLayout, envExample, proxy] = await Promise.all([
    readFile(new URL("../app/api/payments/midtrans/checkout/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/webhook/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/payments/midtrans/status/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/payments/midtrans.ts", import.meta.url), "utf8"),
    readFile(new URL("../migrations/20260722090000_midtrans-billing.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/components/EntryViews.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/(dashboard)/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../proxy.ts", import.meta.url), "utf8"),
  ]);

  assert.match(checkout, /getCurrentUser\(\)/);
  assert.match(checkout, /membership\.role !== "administrator"/);
  assert.match(checkout, /plan\.prices\[body\.billingCycle\]/);
  assert.match(checkout, /checkout_attempt_id/);
  assert.match(webhook, /verifyMidtransNotification/);
  assert.match(webhook, /getMidtransTransactionStatus/);
  assert.match(webhook, /business_subscriptions/);
  assert.match(webhook, /fulfilled_at/);
  assert.match(midtrans, /SHA-512/);
  assert.match(midtrans, /preserveFinalPaymentState/);
  assert.match(status, /Cache-Control/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /fulfilled_at TIMESTAMPTZ/);
  assert.match(migration, /REVOKE ALL ON public\.payment_orders/);
  assert.match(pricing, /Membuka Midtrans/);
  assert.match(pricing, /Paket aktif diperlukan untuk mengakses dashboard/);
  assert.match(paidLayout, /business_subscriptions/);
  assert.match(paidLayout, /current_period_start/);
  assert.match(paidLayout, /current_period_end/);
  assert.match(paidLayout, /redirect\("\/login"\)/);
  assert.match(paidLayout, /redirect\("\/pricing\?payment=required"\)/);
  assert.match(envExample, /^MIDTRANS_SERVER_KEY=/m);
  assert.match(proxy, /request\.nextUrl\.pathname === "\/webhook"/);
  assert.doesNotMatch(pricing, /MIDTRANS_SERVER_KEY|INSFORGE_API_KEY/);
});

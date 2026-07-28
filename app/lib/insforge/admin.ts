import { createAdminClient } from "@insforge/sdk";

export function createInsForgeAdminClient() {
  const baseUrl = process.env.INSFORGE_URL ?? process.env.NEXT_PUBLIC_INSFORGE_URL;
  const apiKey = process.env.INSFORGE_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error("InsForge admin credentials are not configured");
  }

  return createAdminClient({ baseUrl, apiKey });
}

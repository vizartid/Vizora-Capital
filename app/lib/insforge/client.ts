import { createBrowserClient } from "@insforge/sdk/ssr";

const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;

function hostedFunctionsUrl(url: string | undefined) {
  if (!url) return undefined;

  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith(".insforge.app")) return undefined;
    const appKey = parsed.hostname.split(".")[0];
    return `${parsed.protocol}//${appKey}.function2.insforge.app`;
  } catch {
    return undefined;
  }
}

export const insforge = createBrowserClient({
  baseUrl,
  anonKey: process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY,
  functionsUrl: process.env.NEXT_PUBLIC_INSFORGE_FUNCTIONS_URL || hostedFunctionsUrl(baseUrl),
});

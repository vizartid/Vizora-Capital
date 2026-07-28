import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const cliPath = process.argv[2];
if (!cliPath) throw new Error("Pass the absolute path to the InsForge CLI entrypoint");

const envText = readFileSync(".env.local", "utf8");
const openRouterLine = envText.split(/\r?\n/).find((line) => line.startsWith("OPENROUTER_API_KEY="));
if (!openRouterLine) throw new Error("OPENROUTER_API_KEY is missing from .env.local; run `insforge ai setup` first");

let openRouterKey = openRouterLine.slice("OPENROUTER_API_KEY=".length).trim();
if ((openRouterKey.startsWith('"') && openRouterKey.endsWith('"')) || (openRouterKey.startsWith("'") && openRouterKey.endsWith("'"))) {
  openRouterKey = openRouterKey.slice(1, -1);
}

const secrets = [
  ["OPENROUTER_API_KEY", openRouterKey],
  ["OPENROUTER_CHAT_MODEL", "google/gemini-3.1-flash-lite"],
  ["REMINDER_WORKER_TOKEN", randomBytes(32).toString("hex")],
];

for (const [key, value] of secrets) {
  const result = spawnSync(process.execPath, [cliPath, "secrets", "add", key, value], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Unable to configure ${key}: ${result.stderr || result.stdout || "unknown CLI error"}`);
  }
  console.log(`Configured ${key}`);
}

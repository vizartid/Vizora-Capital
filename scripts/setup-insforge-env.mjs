import { readFile, writeFile } from "node:fs/promises";

const project = JSON.parse(await readFile(".insforge/project.json", "utf8"));
const input = await new Promise((resolve, reject) => {
  let body = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => (body += chunk));
  process.stdin.on("end", () => resolve(body));
  process.stdin.on("error", reject);
});

if (typeof project.oss_host !== "string" || !project.oss_host.startsWith("https://")) {
  throw new Error("Linked InsForge project is missing a valid oss_host");
}
if (typeof project.api_key !== "string" || project.api_key.length < 20) {
  throw new Error("Linked InsForge project is missing a valid server API key");
}

const envPath = ".env.local";
let current = "";
try {
  current = await readFile(envPath, "utf8");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const response = input.trim() ? JSON.parse(input) : {};
const currentAnonKey = current
  .split(/\r?\n/)
  .find((line) => line.startsWith("NEXT_PUBLIC_INSFORGE_ANON_KEY="))
  ?.slice("NEXT_PUBLIC_INSFORGE_ANON_KEY=".length);
const anonKey =
  response.value ??
  response.data?.value ??
  response.secret?.value ??
  response.data?.secret?.value ??
  currentAnonKey;
if (typeof anonKey !== "string" || anonKey.length < 20) {
  throw new Error("Pass the InsForge ANON_KEY response on stdin or configure it in .env.local first");
}

const managed = new Map([
  ["NEXT_PUBLIC_INSFORGE_URL", project.oss_host],
  ["NEXT_PUBLIC_INSFORGE_ANON_KEY", anonKey],
  ["INSFORGE_URL", project.oss_host],
  ["INSFORGE_API_KEY", project.api_key],
  ["NEXT_PUBLIC_APP_URL", "http://localhost:3000"],
]);

const kept = current
  .split(/\r?\n/)
  .filter((line) => !managed.has(line.split("=", 1)[0]))
  .filter((line, index, lines) => line.length > 0 || index < lines.length - 1);

for (const [key, value] of managed) kept.push(`${key}=${value}`);
await writeFile(envPath, `${kept.filter(Boolean).join("\n")}\n`, { mode: 0o600 });

console.log("Configured InsForge URL, anon key, and server API key in .env.local");

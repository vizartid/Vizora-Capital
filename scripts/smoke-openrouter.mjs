import { readFileSync } from "node:fs";
import OpenAI from "openai";

const model = process.env.OPENROUTER_CHAT_MODEL ?? "google/gemini-3.1-flash-lite";

function localEnvValue(name) {
  const line = readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith(`${name}=`));
  if (!line) return "";

  const value = line.slice(name.length + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

const apiKey = process.env.OPENROUTER_API_KEY ?? localEnvValue("OPENROUTER_API_KEY");
if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing; run `npx @insforge/cli ai setup` first");

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey,
});

const completion = await openai.chat.completions.create({
  model,
  temperature: 0,
  max_tokens: 80,
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "gateway_smoke_test",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["ok"],
        properties: { ok: { type: "boolean" } },
      },
    },
  },
  messages: [{ role: "user", content: "Return ok=true." }],
});

const content = completion.choices[0]?.message?.content ?? "";
const parsed = JSON.parse(content);
if (parsed.ok !== true) throw new Error("The model did not return the expected structured response");

console.log(JSON.stringify({
  ok: true,
  model: completion.model,
  promptTokens: completion.usage?.prompt_tokens ?? null,
  completionTokens: completion.usage?.completion_tokens ?? null,
}));

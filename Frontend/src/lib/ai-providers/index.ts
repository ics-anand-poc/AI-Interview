import type { AIProvider } from "./types";
import { GeminiProvider } from "./gemini-provider";
import { OllamaProvider } from "./ollama-provider";
import { CopilotProvider } from "./copilot-provider";
import { GroqProvider } from "./groq-provider";
import { withAICache } from "./cache";

export type { AIProvider } from "./types";

// Default priority order for every AI call in the app (resume extraction,
// interview question generation, employee quiz generation, etc.):
// Copilot first, then Groq, then Gemini, then Ollama last. Only after all
// four fail does a caller fall back to its own non-LLM fallback (e.g. the
// preset employee question bank) — never before every provider is tried.
const SUPPORTED_PROVIDERS = ["copilot", "groq", "gemini", "ollama"] as const;
type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

const instances = new Map<SupportedProvider, AIProvider>();

function getProvider(name: SupportedProvider): AIProvider {
  let p = instances.get(name);
  if (p) return p;
  p = name === "groq" ? new GroqProvider()
    : name === "ollama" ? new OllamaProvider()
    : name === "copilot" ? new CopilotProvider()
    : new GeminiProvider();
  instances.set(name, p);
  return p;
}

function providerOrder(): SupportedProvider[] {
  // AI_PROVIDER, if explicitly set, is an admin override that jumps to the
  // front of the queue. Leave it unset to use the standard Copilot -> Groq ->
  // Gemini -> Ollama priority order.
  const raw = (process.env.AI_PROVIDER || "").trim().toLowerCase();
  const configured = (SUPPORTED_PROVIDERS as readonly string[]).includes(raw) ? (raw as SupportedProvider) : null;
  if (!configured) return [...SUPPORTED_PROVIDERS];
  return [configured, ...SUPPORTED_PROVIDERS.filter((p) => p !== configured)];
}

// Configured provider first, then the rest as fallback; throws only after all fail.
export async function generateAIText(prompt: string): Promise<string> {
  let lastErr: unknown;
  for (const name of providerOrder()) {
    try {
      return await withAICache(name, prompt, () => getProvider(name).generateText(prompt));
    } catch (err) {
      lastErr = err;
      console.warn(`AI provider "${name}" failed, trying next.`, err);
    }
  }
  throw lastErr;
}

/**
 * Extracts the first balanced JSON array/object from a model's raw text response,
 * tracking string literals so that `{`/`}`/`[`/`]` characters *inside* quoted values
 * (e.g. a generated coding-challenge question that itself contains a code sample with
 * braces) don't throw off the boundary detection the way a naive
 * `indexOf('[')` / `lastIndexOf(']')` pair does. Also strips ```json fences.
 *
 * If the JSON is truncated (the model ran out of output tokens mid-array/object —
 * a real, observed failure mode, not just malformed formatting), the brace/bracket
 * depth never returns to 0 and this returns the unbalanced tail as-is, so the
 * caller's JSON.parse fails fast with a clear SyntaxError instead of this function
 * silently guessing at a truncation point.
 */
function extractJson(text: string): string {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  const startIdx = stripped.search(/[[{]/);
  if (startIdx === -1) return stripped;

  const open = stripped[startIdx];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIdx; i < stripped.length; i++) {
    const ch = stripped[i];
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (ch === "\\") {
      escapeNext = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return stripped.slice(startIdx, i + 1);
    }
  }
  return stripped.slice(startIdx); // unbalanced — let JSON.parse surface the error
}

/**
 * Same provider fallback chain as generateAIText, but parses (and optionally
 * validates) each provider's response as JSON *before* deciding whether that
 * provider "succeeded" — a response that comes back 200 OK but isn't valid JSON
 * (truncated, wrapped in prose the model added despite instructions, or — as seen
 * with Groq's reasoning-capable models — chain-of-thought text leaking into the
 * content field ahead of the real answer) now correctly falls through to the next
 * provider instead of aborting the whole call.
 *
 * This fixes a real bug: previously, callers did
 *   JSON.parse(await generateAIText(prompt))
 * which only retried on network/HTTP failure. A 200-OK-but-malformed response from
 * whichever provider is tried first (Groq, by default here — AI_PROVIDER=groq)
 * threw past the fallback chain entirely, so interview question generation (and
 * overall-feedback synthesis) silently dropped to the static fallback question
 * bank even when a later provider in the chain would have returned good JSON.
 */
export async function generateAIJson<T = any>(
  prompt: string,
  validate?: (value: unknown) => value is T
): Promise<T> {
  let lastErr: unknown;
  for (const name of providerOrder()) {
    let raw: string;
    try {
      raw = await withAICache(name, prompt, () => getProvider(name).generateText(prompt));
    } catch (err) {
      lastErr = err;
      console.warn(`AI provider "${name}" failed (request error), trying next.`, err);
      continue;
    }
    try {
      const parsed = JSON.parse(extractJson(raw));
      if (validate && !validate(parsed)) {
        throw new Error(`Provider "${name}" returned JSON that failed structural validation.`);
      }
      return parsed as T;
    } catch (err) {
      lastErr = err;
      console.warn(`AI provider "${name}" returned unparseable/invalid JSON, trying next provider.`, err, "Raw response:", raw);
      continue;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`All AI providers failed: ${String(lastErr)}`);
}

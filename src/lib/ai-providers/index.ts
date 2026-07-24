import type { AIProvider } from "./types";
import { GeminiProvider } from "./gemini-provider";
import { OllamaProvider } from "./ollama-provider";
import { CopilotProvider } from "./copilot-provider";
import { GroqProvider } from "./groq-provider";
import { withAICache } from "./cache";

export type { AIProvider } from "./types";

const SUPPORTED_PROVIDERS = ["gemini", "ollama", "copilot", "groq"] as const;
type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

function resolveProviderName(): SupportedProvider {
  const configured = (process.env.AI_PROVIDER || "gemini").trim().toLowerCase();
  if ((SUPPORTED_PROVIDERS as readonly string[]).includes(configured)) {
    return configured as SupportedProvider;
  }
  console.warn(`Unknown AI_PROVIDER "${configured}" — falling back to "gemini".`);
  return "gemini";
}

let cachedProvider: AIProvider | null = null;
let cachedProviderName: SupportedProvider | null = null;

/**
 * Returns the currently configured LLM provider (singleton per provider name), based on
 * the AI_PROVIDER environment variable: "gemini" (default), "ollama", "copilot", or "groq".
 *
 * Every caller in the app should go through this factory rather than instantiating a
 * provider directly, so switching providers is a single env-var change with zero code edits.
 */
export function getAIProvider(): AIProvider {
  const name = resolveProviderName();
  if (cachedProvider && cachedProviderName === name) {
    return cachedProvider;
  }

  switch (name) {
    case "ollama":
      cachedProvider = new OllamaProvider();
      break;
    case "copilot":
      cachedProvider = new CopilotProvider();
      break;
    case "groq":
      cachedProvider = new GroqProvider();
      break;
    case "gemini":
    default:
      cachedProvider = new GeminiProvider();
      break;
  }
  cachedProviderName = name;
  return cachedProvider;
}

/**
 * Convenience helper: generate text from the currently configured provider, with
 * response caching + in-flight de-duplication applied automatically.
 */
export async function generateAIText(prompt: string): Promise<string> {
  const provider = getAIProvider();
  return withAICache(provider.name, prompt, () => provider.generateText(prompt));
}

import type { AIProvider } from "./types";

/**
 * Ollama provider — talks to a local or self-hosted Ollama server
 * (https://github.com/ollama/ollama) over its REST API.
 *
 * Configuration is read exclusively from environment variables (.env.local):
 *   OLLAMA_BASE_URL  - defaults to http://localhost:11434 if unset
 *   OLLAMA_MODEL     - required, e.g. "llama3.1", "mistral", "qwen2.5-coder"
 *
 * To activate this provider instead of Gemini, set AI_PROVIDER=ollama in .env.local.
 * No network call is made, and nothing about existing Gemini behavior changes,
 * unless that switch is flipped.
 */
export class OllamaProvider implements AIProvider {
  readonly name = "ollama";

  async generateText(prompt: string): Promise<string> {
    const baseUrl = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/+$/, "");
    const model = process.env.OLLAMA_MODEL;

    if (!model) {
      throw new Error(
        "OLLAMA_MODEL is not configured. Set OLLAMA_MODEL in .env.local (e.g. OLLAMA_MODEL=llama3.1)."
      );
    }

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, stream: false }),
      });
    } catch (networkErr: any) {
      throw new Error(
        `Could not reach Ollama at ${baseUrl}. Is it running? (${networkErr?.message || networkErr})`
      );
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Ollama request failed (${res.status}): ${errText || res.statusText}`);
    }

    const data = await res.json();
    return data?.response ?? "";
  }
}

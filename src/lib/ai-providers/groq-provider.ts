import type { AIProvider } from "./types";

/**
 * Groq provider — uses Groq's hosted inference API (OpenAI-compatible chat-completions
 * schema, but this talks to Groq's own endpoint via plain fetch, not the "openai" package).
 * Groq runs open models (Llama, Gemma, etc.) on custom hardware and is typically both
 * faster and substantially cheaper per token than Gemini/OpenAI-class hosted APIs, which
 * is why it's offered here as a cost-conscious option.
 *
 * All configuration is read exclusively from environment variables (.env.local):
 *   GROQ_API_KEY  - required
 *   GROQ_MODEL    - defaults to "llama-3.3-70b-versatile" if unset
 *   GROQ_API_BASE_URL - defaults to https://api.groq.com/openai/v1
 *
 * To activate this provider instead of Gemini, set AI_PROVIDER=groq in .env.local.
 */
export class GroqProvider implements AIProvider {
  readonly name = "groq";

  async generateText(prompt: string): Promise<string> {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is not configured. Set GROQ_API_KEY in .env.local.");
    }

    const baseUrl = (process.env.GROQ_API_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/+$/, "");
    const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
        }),
      });
    } catch (networkErr: any) {
      throw new Error(`Could not reach Groq API at ${baseUrl}. (${networkErr?.message || networkErr})`);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Groq request failed (${res.status}): ${errText || res.statusText}`);
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  }
}

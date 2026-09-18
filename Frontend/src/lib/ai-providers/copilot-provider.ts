import type { AIProvider } from "./types";

/**
 * GitHub Copilot provider.
 *
 * NOTE: Copilot's chat-completions endpoint is not a normal public API key product —
 * it requires a token issued through GitHub's own OAuth/device-flow for a Copilot-entitled
 * account, and the exact base URL/headers GitHub expects can change. This provider is wired
 * up so it is a one-line env change away from being usable (AI_PROVIDER=copilot), but you will
 * need to supply a valid COPILOT_API_KEY (and adjust COPILOT_API_BASE_URL / COPILOT_INTEGRATION_ID
 * if GitHub's requirements differ from the defaults below) before it will actually work.
 *
 * All configuration is read exclusively from environment variables (.env.local):
 *   COPILOT_API_KEY          - required, a valid Copilot chat token
 *   COPILOT_API_BASE_URL     - defaults to https://api.githubcopilot.com
 *   COPILOT_MODEL             - defaults to "gpt-4o"
 *   COPILOT_INTEGRATION_ID    - defaults to "vscode-chat" (GitHub requires this header)
 *
 * To activate this provider instead of Gemini, set AI_PROVIDER=copilot in .env.local.
 */
export class CopilotProvider implements AIProvider {
  readonly name = "copilot";

  async generateText(prompt: string): Promise<string> {
    const apiKey = process.env.COPILOT_API_KEY;
    if (!apiKey) {
      throw new Error("COPILOT_API_KEY is not configured. Set COPILOT_API_KEY in .env.local.");
    }

    const baseUrl = (process.env.COPILOT_API_BASE_URL || "https://api.githubcopilot.com").replace(/\/+$/, "");
    const model = process.env.COPILOT_MODEL || "gpt-4o";
    const integrationId = process.env.COPILOT_INTEGRATION_ID || "vscode-chat";

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "Copilot-Integration-Id": integrationId,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
        }),
      });
    } catch (networkErr: any) {
      throw new Error(`Could not reach Copilot API at ${baseUrl}. (${networkErr?.message || networkErr})`);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Copilot request failed (${res.status}): ${errText || res.statusText}`);
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? "";
  }
}
